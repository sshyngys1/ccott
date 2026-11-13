//! Auto-update via GitHub Releases (`tauri-plugin-updater`).
//! Owner: R1 (Rust-Shell). Contract: `docs/contracts.md` section 9.
//!
//! Schedule: first check ~30 s after startup, then every 6 hours.
//! Offline or missing release (HTTP 404 → `Error::ReleaseNotFound`) is logged at `info` level
//! and treated as "no update available" (`Ok(None)`).

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Config, Error as UpdaterError, Update, Updater, UpdaterExt};

pub const AVAILABLE_EVENT: &str = "updater://available";
pub const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(30);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

#[derive(Default)]
pub struct UpdaterManagedState {
    pending_update: Mutex<Option<Update>>,
    notified_version: Mutex<Option<String>>,
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R, Config> {
    tauri_plugin_updater::Builder::new().build()
}

/// Returns the wait duration before check iteration `step` (0 = initial check after startup,
/// 1+ = periodic check every 6 hours).
pub const fn schedule_delay_for_step(step: u64) -> Duration {
    if step == 0 {
        INITIAL_CHECK_DELAY
    } else {
        CHECK_INTERVAL
    }
}

/// Network absence or an unpublished release (404 → `ReleaseNotFound`) must not surface as a UI
/// error: log at `info` and return `Ok(None)`.
pub fn is_silent_check_error(err: &UpdaterError) -> bool {
    matches!(
        err,
        UpdaterError::ReleaseNotFound
            | UpdaterError::Reqwest(_)
            | UpdaterError::Network(_)
            | UpdaterError::TargetNotFound(_)
            | UpdaterError::TargetsNotFound(_)
    )
}

pub fn extract_pub_date(raw_json: &Value) -> Option<String> {
    raw_json
        .get("pub_date")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn update_info_from_update(update: &Update) -> UpdateInfo {
    let date = extract_pub_date(&update.raw_json).or_else(|| update.date.map(|d| d.to_string()));
    UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date,
    }
}

/// Classifies a check outcome and decides whether `updater://available` should be emitted
/// (at most once per discovered version).
pub fn handle_check_outcome(
    outcome: Result<Option<UpdateInfo>, UpdaterError>,
    notified_version: &mut Option<String>,
) -> Result<(Option<UpdateInfo>, bool), String> {
    match outcome {
        Ok(Some(info)) => {
            let should_emit = notified_version.as_deref() != Some(info.version.as_str());
            if should_emit {
                *notified_version = Some(info.version.clone());
            }
            log::info!("updater: update v{} is available", info.version);
            Ok((Some(info), should_emit))
        }
        Ok(None) => {
            log::info!("updater: no new version available");
            Ok((None, false))
        }
        Err(err) if is_silent_check_error(&err) => {
            log::info!("updater: check skipped (offline or release not found): {err}");
            Ok((None, false))
        }
        Err(err) => {
            log::warn!("updater: check failed: {err}");
            Err(err.to_string())
        }
    }
}

fn build_updater(app: &AppHandle) -> Result<Updater, UpdaterError> {
    let mut builder = app.updater_builder().timeout(REQUEST_TIMEOUT);
    if let Ok(endpoint) = std::env::var("CCOTT_UPDATER_ENDPOINT") {
        let trimmed = endpoint.trim();
        if !trimmed.is_empty() {
            let url: tauri::Url = trimmed.parse()?;
            log::info!("updater: using override endpoint {url}");
            builder = builder.endpoints(vec![url])?;
        }
    }
    builder.build()
}

async fn check_and_store(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = match build_updater(app) {
        Ok(u) => u,
        Err(err) if is_silent_check_error(&err) => {
            log::info!("updater: builder skipped: {err}");
            return Ok(None);
        }
        Err(err) => {
            log::warn!("updater: cannot build updater: {err}");
            return Err(err.to_string());
        }
    };

    let raw_result = updater.check().await;
    let state = app.state::<UpdaterManagedState>();

    let mapped = match raw_result {
        Ok(Some(update)) => {
            let info = update_info_from_update(&update);
            *state
                .pending_update
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(update);
            Ok(Some(info))
        }
        Ok(None) => {
            *state
                .pending_update
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = None;
            Ok(None)
        }
        Err(err) => Err(err),
    };

    let (info, should_emit) = {
        let mut notified = state
            .notified_version
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        handle_check_outcome(mapped, &mut notified)?
    };

    if should_emit && let Some(ref update_info) = info {
        let _ = app.emit(AVAILABLE_EVENT, update_info);
    }

    Ok(info)
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(UpdaterManagedState::default());
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut step = 0_u64;
        loop {
            let delay = schedule_delay_for_step(step);
            step = step.saturating_add(1);
            std::thread::sleep(delay);
            if let Err(err) = check_and_store(&handle).await {
                log::info!("updater: scheduled check finished with message: {err}");
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    check_and_store(&app).await
}

#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let cached = app
        .state::<UpdaterManagedState>()
        .pending_update
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    let update = match cached {
        Some(u) => u,
        None => {
            let updater = build_updater(&app).map_err(|e| e.to_string())?;
            updater
                .check()
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Обновление не найдено".to_string())?
        }
    };

    log::info!("updater: downloading and installing v{}", update.version);
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| {
            log::error!("updater: install failed: {e}");
            e.to_string()
        })?;

    // On Windows `download_and_install` spawns the passive installer with restart arguments and
    // exits the process; `restart()` is a fallback if execution ever returns.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use tauri_plugin_updater::RemoteRelease;

    fn evaluate_release_manifest(
        raw_json: &Value,
        current_version: &str,
        target: &str,
    ) -> Result<Option<UpdateInfo>, UpdaterError> {
        let release: RemoteRelease = serde_json::from_value(raw_json.clone())?;
        let current_clean = current_version.trim_start_matches('v');
        let remote_clean = release.version.to_string();
        if remote_clean.as_str() <= current_clean {
            return Ok(None);
        }
        let _url = release.download_url(target)?;
        let _sig = release.signature(target)?;
        Ok(Some(UpdateInfo {
            version: remote_clean,
            notes: release.notes.unwrap_or_default(),
            date: extract_pub_date(raw_json).or_else(|| release.pub_date.map(|d| d.to_string())),
        }))
    }

    #[test]
    fn schedule_delays_match_spec_30s_then_6h() {
        assert_eq!(schedule_delay_for_step(0), Duration::from_secs(30));
        assert_eq!(schedule_delay_for_step(1), Duration::from_secs(6 * 60 * 60));
        assert_eq!(schedule_delay_for_step(2), Duration::from_secs(6 * 60 * 60));
        assert_eq!(
            schedule_delay_for_step(100),
            Duration::from_secs(6 * 60 * 60)
        );
    }

    #[test]
    fn silent_errors_return_none_and_do_not_fail_ui() {
        let mut notified = None;
        let (info, emit) =
            handle_check_outcome(Err(UpdaterError::ReleaseNotFound), &mut notified).unwrap();
        assert!(info.is_none());
        assert!(!emit);

        let (info, emit) = handle_check_outcome(
            Err(UpdaterError::Network("offline".to_string())),
            &mut notified,
        )
        .unwrap();
        assert!(info.is_none());
        assert!(!emit);

        let (info, emit) = handle_check_outcome(
            Err(UpdaterError::TargetsNotFound(vec![
                "windows-x86_64".to_string(),
            ])),
            &mut notified,
        )
        .unwrap();
        assert!(info.is_none());
        assert!(!emit);

        // Non-network configuration errors still surface as Err.
        let err = handle_check_outcome(Err(UpdaterError::EmptyEndpoints), &mut notified);
        assert!(err.is_err());
    }

    #[test]
    fn available_event_emitted_once_per_version() {
        let mut notified = None;
        let sample = UpdateInfo {
            version: "0.1.1".to_string(),
            notes: "Исправления и улучшения".to_string(),
            date: Some("2026-10-27T12:00:00Z".to_string()),
        };

        let (res1, emit1) = handle_check_outcome(Ok(Some(sample.clone())), &mut notified).unwrap();
        assert_eq!(res1.as_ref(), Some(&sample));
        assert!(emit1);
        assert_eq!(notified.as_deref(), Some("0.1.1"));

        // Second check finding the same version does not re-emit `updater://available`.
        let (res2, emit2) = handle_check_outcome(Ok(Some(sample.clone())), &mut notified).unwrap();
        assert_eq!(res2.as_ref(), Some(&sample));
        assert!(!emit2);

        // Newer version emits again.
        let newer = UpdateInfo {
            version: "0.2.0".to_string(),
            notes: "v0.2".to_string(),
            date: None,
        };
        let (res3, emit3) = handle_check_outcome(Ok(Some(newer.clone())), &mut notified).unwrap();
        assert_eq!(res3.as_ref(), Some(&newer));
        assert!(emit3);
        assert_eq!(notified.as_deref(), Some("0.2.0"));
    }

    #[test]
    fn evaluate_manifest_parses_latest_json_and_compares_versions() {
        let manifest = json!({
            "version": "0.1.1",
            "notes": "Тестовый релиз 0.1.1",
            "pub_date": "2026-10-27T12:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
                    "url": "https://github.com/sshyngys1/ccott/releases/download/v0.1.1/CCOTT_0.1.1_x64-setup.exe"
                }
            }
        });

        // Same or newer local version -> None.
        assert_eq!(
            evaluate_release_manifest(&manifest, "0.1.1", "windows-x86_64").unwrap(),
            None
        );
        assert_eq!(
            evaluate_release_manifest(&manifest, "0.2.0", "windows-x86_64").unwrap(),
            None
        );

        // Older local version -> Some(UpdateInfo).
        let info = evaluate_release_manifest(&manifest, "0.1.0", "windows-x86_64")
            .unwrap()
            .expect("update should be detected");
        assert_eq!(
            info,
            UpdateInfo {
                version: "0.1.1".to_string(),
                notes: "Тестовый релиз 0.1.1".to_string(),
                date: Some("2026-10-27T12:00:00Z".to_string()),
            }
        );

        // Missing target -> TargetNotFound (which is classified as silent).
        let err = evaluate_release_manifest(&manifest, "0.1.0", "darwin-aarch64").unwrap_err();
        assert!(is_silent_check_error(&err));
    }

    #[test]
    fn local_http_endpoint_404_and_200_manifest_roundtrip() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let addr = listener.local_addr().unwrap();

        let server = std::thread::spawn(move || {
            // Request 1: 404 Not Found (no release published yet)
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0_u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
            // Request 2: 200 OK with latest.json for v0.1.1
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0_u8; 1024];
                let _ = stream.read(&mut buf);
                let body = serde_json::to_string(&json!({
                    "version": "0.1.1",
                    "notes": "Локальная проверка обновления",
                    "pub_date": "2026-10-27T12:00:00Z",
                    "platforms": {
                        "windows-x86_64": {
                            "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
                            "url": format!("http://{addr}/CCOTT_0.1.1_x64-setup.exe")
                        }
                    }
                }))
                .unwrap();
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });

        let fetch_and_check = || -> Result<Option<UpdateInfo>, UpdaterError> {
            use std::net::TcpStream;
            let mut stream =
                TcpStream::connect(addr).map_err(|e| UpdaterError::Network(e.to_string()))?;
            let req =
                format!("GET /latest.json HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
            stream
                .write_all(req.as_bytes())
                .map_err(|e| UpdaterError::Network(e.to_string()))?;
            let mut raw = String::new();
            stream
                .read_to_string(&mut raw)
                .map_err(|e| UpdaterError::Network(e.to_string()))?;
            let (head, body) = raw
                .split_once("\r\n\r\n")
                .ok_or(UpdaterError::ReleaseNotFound)?;
            if !head.starts_with("HTTP/1.1 200") {
                return Err(UpdaterError::ReleaseNotFound);
            }
            let val: Value = serde_json::from_str(body)?;
            evaluate_release_manifest(&val, "0.1.0", "windows-x86_64")
        };

        let mut notified = None;
        // 1) 404 -> ReleaseNotFound -> handle_check_outcome returns Ok((None, false))
        let outcome1 = fetch_and_check();
        assert!(matches!(outcome1, Err(UpdaterError::ReleaseNotFound)));
        let (info1, emit1) = handle_check_outcome(outcome1, &mut notified).unwrap();
        assert!(info1.is_none());
        assert!(!emit1);

        // 2) 200 OK with v0.1.1 -> handle_check_outcome returns Ok((Some(info), true))
        let outcome2 = fetch_and_check();
        let (info2, emit2) = handle_check_outcome(outcome2, &mut notified).unwrap();
        assert!(emit2);
        assert_eq!(
            info2,
            Some(UpdateInfo {
                version: "0.1.1".to_string(),
                notes: "Локальная проверка обновления".to_string(),
                date: Some("2026-10-27T12:00:00Z".to_string()),
            })
        );

        server.join().unwrap();
    }

    #[test]
    fn tauri_conf_has_updater_artifacts_pubkey_endpoint_and_passive_mode() {
        let conf: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("valid tauri.conf.json");

        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], json!(true));
        let updater = &conf["plugins"]["updater"];
        assert_eq!(
            updater["endpoints"],
            json!(["https://github.com/sshyngys1/ccott/releases/latest/download/latest.json"])
        );
        assert_eq!(updater["windows"]["installMode"], json!("passive"));

        let pubkey = updater["pubkey"].as_str().expect("pubkey string");
        assert!(!pubkey.trim().is_empty());
        // Decode base64 public key and ensure it is the PUBLIC key, never a secret key.
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(pubkey.trim())
            .expect("pubkey is valid base64");
        let text = String::from_utf8(decoded).expect("pubkey is utf-8");
        assert!(text.contains("minisign public key"));
        assert!(!text.contains("secret key"));
    }
}
