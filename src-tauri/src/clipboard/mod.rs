//! Clipboard history: listener, SQLite storage, paste-into-previous-window. Owner: R2 (Rust-System).
//!
//! * `win` — Win32 (listener thread, reading/writing the clipboard, foreground tracking, Ctrl+V).
//! * `store` — pure SQLite logic (dedupe, limits, ordering, search).
//! * `image` — DIB/PNG/thumbnail helpers.
//!
//! Capture runs on two background threads (listener → worker), so neither the UI thread nor the
//! clipboard message loop does decoding or database work.

mod image;
mod lifecycle;
mod store;
mod win;

use std::sync::{Mutex, mpsc};
use std::thread::JoinHandle;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{Db, now_ms};
use crate::system::worker::{WorkerApp, with_app};
use store::{ClipItem, ClipKind, MAX_TEXT_BYTES, NewClip};
use win::{Captured, Content, Raw};

/// Encoded PNGs above this size are not stored.
const MAX_PNG_BYTES: usize = 20 * 1024 * 1024;

/// New captures must go through the normal clipboard listener, unlike history re-pastes.
pub(crate) fn copy_capture(png: Vec<u8>) -> Result<(), String> {
    win::write_capture(&Content::Image(png))
}
pub(crate) fn copy_ocr(text: String) -> Result<(), String> {
    win::write_capture(&Content::Text(text))
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PasteMode {
    Paste,
    Copy,
}

/// Turns raw clipboard data into a storable entry; `None` = ignore this clipboard change.
fn build_clip(raw: Raw, source_app: String) -> Option<NewClip> {
    match raw {
        Raw::Text(text) => {
            if text.trim().is_empty() {
                return None;
            }
            if text.len() > MAX_TEXT_BYTES {
                log::debug!(
                    "clipboard: text of {} bytes skipped (too large)",
                    text.len()
                );
                return None;
            }
            let kind = store::classify_text(&text);
            let text = if kind == ClipKind::Link {
                text.trim().to_string()
            } else {
                text
            };
            Some(NewClip {
                kind,
                preview: store::make_preview(&text),
                text,
                source_app,
                image: None,
            })
        }
        Raw::Files(files) => {
            let text = files.join("\n");
            Some(NewClip {
                kind: ClipKind::Files,
                preview: store::make_preview(&text),
                text,
                source_app,
                image: None,
            })
        }
        Raw::Dib(dib) => {
            let img = image::dib_to_rgba(&dib)?;
            let preview = image::thumbnail_data_url(img.width, img.height, &img.pixels)?;
            let png = image::encode_png(img.width, img.height, img.pixels)?;
            image_clip(png, preview, source_app)
        }
        Raw::Png(png) => {
            let img = image::decode_png(&png)?;
            let preview = image::thumbnail_data_url(img.width, img.height, &img.pixels)?;
            image_clip(png, preview, source_app)
        }
    }
}

fn image_clip(png: Vec<u8>, preview: String, source_app: String) -> Option<NewClip> {
    if png.len() > MAX_PNG_BYTES {
        log::debug!(
            "clipboard: image of {} bytes skipped (too large)",
            png.len()
        );
        return None;
    }
    Some(NewClip {
        kind: ClipKind::Image,
        text: String::new(),
        preview,
        source_app,
        image: Some(png),
    })
}

/// Apps that use OLE (PowerShell, Office, browsers) touch the clipboard twice within a few ms for one
/// copy ("set" + "flush"). The second capture is stored (dedupe) but must not be announced again.
const ECHO_WINDOW_MS: i64 = 1500;

/// True when `id` was already announced less than [`ECHO_WINDOW_MS`] ago.
fn is_echo(last: Option<(i64, i64)>, id: i64, now: i64) -> bool {
    last.is_some_and(|(last_id, at)| last_id == id && now - at < ECHO_WINDOW_MS)
}

fn process(db: &Db, app: &WorkerApp, cap: Captured, last_announced: &mut Option<(i64, i64)>) {
    let Some(clip) = build_clip(cap.raw, cap.source_app) else {
        return;
    };
    let now = now_ms();
    let result = store::add(&db.lock(), &clip, now);
    match result {
        Ok((item, _is_new)) => {
            if !is_echo(*last_announced, item.id, now) {
                with_app(app, |app| app.emit("clipboard://added", &item));
            }
            *last_announced = Some((item.id, now));
            with_app(app, |app| app.emit("clipboard://changed", ()));
        }
        Err(e) => log::warn!("clipboard: cannot store entry: {e}"),
    }
}

struct ClipboardWorker {
    hwnd: isize,
    listener: Option<JoinHandle<()>>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for ClipboardWorker {
    fn drop(&mut self) {
        win::stop_listener(self.hwnd);
        if let Some(thread) = self.listener.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.worker.take() {
            let _ = thread.join();
        }
    }
}

struct ClipboardState {
    watcher: Mutex<lifecycle::Watcher<ClipboardWorker>>,
    app: WorkerApp,
}

impl ClipboardState {
    fn shutdown(&self) {
        self.watcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shutdown();
    }
}

fn start_worker(
    mut process: impl FnMut(Captured) + Send + 'static,
) -> Result<ClipboardWorker, Box<dyn std::error::Error>> {
    // The listener must never block behind image decoding/SQLite or discard a captured update.
    // Closing its sole sender lets the worker drain all accepted captures before join.
    let (tx, rx) = mpsc::channel::<Captured>();
    let worker = std::thread::Builder::new()
        .name("clipboard-worker".into())
        .spawn(move || {
            for cap in rx {
                process(cap);
            }
        })?;
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let listener = match std::thread::Builder::new()
        .name("clipboard-listener".into())
        .spawn(move || win::run_listener(tx, ready_tx))
    {
        Ok(listener) => listener,
        Err(error) => {
            let _ = worker.join();
            return Err(error.into());
        }
    };
    let hwnd = ready_rx.recv().unwrap_or(0);
    let running = ClipboardWorker {
        hwnd,
        listener: Some(listener),
        worker: Some(worker),
    };
    if hwnd == 0 {
        return Err("clipboard listener failed to start".into());
    }
    Ok(running)
}

fn start(
    app: &AppHandle,
    handle: WorkerApp,
) -> Result<ClipboardWorker, Box<dyn std::error::Error>> {
    let db = app.state::<Db>().inner().clone();
    let mut last_announced = None;
    start_worker(move |cap| process(&db, &handle, cap, &mut last_announced))
}

/// Requires settings and database setup. Saved disabled state creates no clipboard threads.
pub fn setup(app: &mut tauri::App, handle: WorkerApp) -> Result<(), Box<dyn std::error::Error>> {
    let mut watcher = lifecycle::Watcher::default();
    let enabled = !crate::settings::current(app.handle())
        .disabled_features
        .iter()
        .any(|id| id == "clipboard");
    watcher.set_enabled(enabled, || start(app.handle(), handle.clone()))?;
    app.manage(ClipboardState {
        watcher: Mutex::new(watcher),
        app: handle,
    });
    Ok(())
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<ClipboardState>()
        && let Err(error) = state
            .watcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_enabled(enabled, || start(app, state.app.clone()))
    {
        log::error!("clipboard: cannot start watcher: {error}");
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<ClipboardState>() {
        state.shutdown();
    }
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit("clipboard://changed", ());
}

#[tauri::command]
pub async fn clipboard_list(
    db: State<'_, Db>,
    query: String,
    limit: usize,
) -> Result<Vec<ClipItem>, String> {
    db.run(move |c| store::list(c, &query, limit).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn clipboard_paste(db: State<'_, Db>, id: i64, mode: PasteMode) -> Result<(), String> {
    let payload = db
        .run(move |c| store::payload(c, id).map_err(|e| e.to_string()))
        .await?
        .ok_or_else(|| format!("clipboard entry {id} not found"))?;
    let content = Content::from_stored(payload.kind, payload.text, payload.image)
        .ok_or("entry has no content")?;
    // Win32 clipboard + input injection: off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        win::set_clipboard(&content)?;
        match mode {
            PasteMode::Copy => Ok(()),
            PasteMode::Paste => win::paste_into_last_window(),
        }
    })
    .await
    .map_err(|e| format!("paste task failed: {e}"))?
}

#[tauri::command]
pub async fn clipboard_pin(
    app: AppHandle,
    db: State<'_, Db>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    db.run(move |c| store::set_pinned(c, id, pinned).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn clipboard_delete(app: AppHandle, db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.run(move |c| store::delete(c, id).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn clipboard_clear(
    app: AppHandle,
    db: State<'_, Db>,
    keep_pinned: bool,
) -> Result<(), String> {
    db.run(move |c| store::clear(c, keep_pinned).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn blocked_worker_delivers_all_captures_in_order_and_shutdown_joins_real_threads() {
        // These tests drive the real Windows clipboard; CI runners have no interactive desktop for it.
        if std::env::var_os("CI").is_some() {
            eprintln!("SKIPPED on CI: needs the interactive Windows clipboard");
            return;
        }
        let mut session = win::test_support::Session::new();
        let (delivered, received) = mpsc::channel();
        let (release, blocked) = mpsc::channel();
        let lifetime = std::sync::Arc::new(());
        let worker_lifetime = std::sync::Arc::downgrade(&lifetime);
        let running = start_worker(move |cap| {
            let _keep_alive = &lifetime;
            if let Raw::Text(text) = cap.raw {
                delivered.send(text.clone()).unwrap();
                if text == "blocked first" {
                    blocked.recv_timeout(Duration::from_secs(10)).unwrap();
                }
            }
        })
        .unwrap();
        let hwnd = running.hwnd;
        let mut watcher = lifecycle::Watcher::default();
        watcher
            .set_enabled(true, || Ok::<_, String>(running))
            .unwrap();
        let state = ClipboardState {
            watcher: Mutex::new(watcher),
            app: WorkerApp::new(),
        };

        copy_ocr("blocked first".into()).unwrap();
        session.flush_listener(hwnd);
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            "blocked first"
        );
        // The processing callback remains blocked while the real message loop captures these.
        for text in ["second", "third", "fourth", "last"] {
            copy_ocr(text.into()).unwrap();
            session.flush_listener(hwnd);
        }
        release.send(()).unwrap();
        state.shutdown();
        state.shutdown(); // explicit Exit cleanup is idempotent
        assert_eq!(
            received.iter().collect::<Vec<_>>(),
            ["second", "third", "fourth", "last"]
        );
        assert!(
            worker_lifetime.upgrade().is_none(),
            "worker closure and resources released"
        );
        assert!(
            !session.window_exists(hwnd),
            "real listener window destroyed before return"
        );
        session.restore().expect("restore desktop clipboard");
    }

    #[test]
    fn writes_work_with_history_disabled_at_start_and_after_toggle() {
        // These tests drive the real Windows clipboard; CI runners have no interactive desktop for it.
        if std::env::var_os("CI").is_some() {
            eprintln!("SKIPPED on CI: needs the interactive Windows clipboard");
            return;
        }
        let mut session = win::test_support::Session::new();
        let mut watcher = lifecycle::Watcher::<ClipboardWorker>::default();
        watcher
            .set_enabled(false, || panic!("saved off must not start threads"))
            .unwrap_or_else(|_: String| unreachable!());
        let png = image::encode_png(1, 1, vec![1, 2, 3, 255]).unwrap();
        for after_toggle in [false, true] {
            if after_toggle {
                watcher.set_enabled(true, || start_worker(|_| {})).unwrap();
                watcher.shutdown();
            }
            // OCR, QR and color picker share the text writer; screenshots share the PNG writer.
            for text in ["OCR text", "https://qr.example", "#123456"] {
                copy_ocr(text.into()).unwrap();
                assert!(matches!(session.read(), Some(Raw::Text(value)) if value == text));
            }
            copy_capture(png.clone()).unwrap();
            assert!(matches!(session.read(), Some(Raw::Png(value)) if value == png));
            win::set_clipboard(&Content::Text("manual copy".into())).unwrap();
            assert!(matches!(session.read(), Some(Raw::Text(value)) if value == "manual copy"));
            win::set_clipboard(&Content::Files(vec!["C:\\example.txt".into()])).unwrap();
            assert!(
                matches!(session.read(), Some(Raw::Files(value)) if value == ["C:\\example.txt"])
            );
        }
        session.restore().expect("restore desktop clipboard");
    }

    #[test]
    fn build_clip_classifies_and_filters() {
        let c = build_clip(
            Raw::Text("  https://example.com/x \n".into()),
            "a.exe".into(),
        )
        .unwrap();
        assert_eq!(c.kind, ClipKind::Link);
        assert_eq!(c.text, "https://example.com/x");
        assert_eq!(c.source_app, "a.exe");

        let t = build_clip(Raw::Text("hello\nworld".into()), String::new()).unwrap();
        assert_eq!(t.kind, ClipKind::Text);
        assert_eq!(t.preview, "hello world");

        assert!(build_clip(Raw::Text("   \n".into()), String::new()).is_none());
        assert!(build_clip(Raw::Text("x".repeat(MAX_TEXT_BYTES + 1)), String::new()).is_none());

        let f = build_clip(
            Raw::Files(vec!["C:\\a".into(), "C:\\b".into()]),
            String::new(),
        )
        .unwrap();
        assert_eq!((f.kind, f.text.as_str()), (ClipKind::Files, "C:\\a\nC:\\b"));
    }

    #[test]
    fn build_clip_handles_images() {
        let rgba: Vec<u8> = (0..4 * 4).flat_map(|_| [10u8, 20, 30, 255]).collect();
        let dib = image::rgba_to_dibv5(4, 4, &rgba);
        let c = build_clip(Raw::Dib(dib), String::new()).unwrap();
        assert_eq!(c.kind, ClipKind::Image);
        assert!(c.preview.starts_with("data:image/jpeg;base64,"));
        assert!(
            c.image
                .as_ref()
                .is_some_and(|p| p.starts_with(&[0x89, b'P']))
        );
        assert!(build_clip(Raw::Dib(vec![1, 2, 3]), String::new()).is_none());
    }

    #[test]
    fn echo_detection() {
        assert!(!is_echo(None, 1, 1000));
        assert!(is_echo(Some((1, 1000)), 1, 1010));
        assert!(!is_echo(Some((1, 1000)), 2, 1010), "different entry");
        assert!(
            !is_echo(Some((1, 1000)), 1, 1000 + ECHO_WINDOW_MS),
            "window elapsed"
        );
    }

    #[test]
    fn paste_mode_deserializes() {
        let m: PasteMode = serde_json::from_str("\"paste\"").unwrap();
        assert_eq!(m, PasteMode::Paste);
        let m: PasteMode = serde_json::from_str("\"copy\"").unwrap();
        assert_eq!(m, PasteMode::Copy);
    }
}
