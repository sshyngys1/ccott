//! §27. One cancellable polling worker, only while the enabled UI has a subscription.
mod bluetooth;
mod model;
mod native;
mod power;
mod watch;

use crate::system::worker::{WorkerApp, with_app};
use model::*;
use std::sync::{Arc, Mutex, atomic::Ordering};
use tauri::{AppHandle, Emitter, Listener, Manager, State};

pub struct ControlHandle {
    watch: watch::SharedWatch,
    worker_app: WorkerApp,
    // A driver may report On/Off but refuse SetStateAsync. Preserve that explicit failure for UI.
    refused: Arc<Mutex<[bool; 2]>>,
    operation: Arc<Mutex<()>>,
}
impl ControlHandle {
    fn reconcile(&self, watch: &mut watch::Watch) {
        let app = self.worker_app.clone();
        let refused = self.refused.clone();
        let operation = self.operation.clone();
        if let Err(error) = watch.reconcile(move |stop, wake| {
            let Ok(_apartment) = native::Apartment::new() else {
                return;
            };
            let cancelled = || stop.load(Ordering::Acquire) || app.strong_count() == 0;
            let mut previous = None;
            while !cancelled() && wake.recv_timeout(watch::INTERVAL).is_err() {
                // Never block join behind a command: retry next poll if a mutation is in progress.
                if let Ok(_guard) = operation.try_lock() {
                    let mut state = native::query(&cancelled);
                    apply_refused(&mut state, &refused);
                    if !cancelled() && previous.as_ref() != Some(&state) {
                        with_app(&app, |app| {
                            let _ = app.emit("control://changed", &state);
                        });
                        previous = Some(state);
                    }
                }
            }
        }) {
            log::error!("control: cannot start watcher: {error}");
        }
    }
}
fn apply_refused(state: &mut ControlState, refused: &Mutex<[bool; 2]>) {
    if let Ok(flags) = refused.lock() {
        if flags[0] {
            state.wifi.state = RadioValue::Unavailable;
        }
        if flags[1] {
            state.bluetooth.state = RadioValue::Unavailable;
        }
    }
}

#[derive(serde::Deserialize)]
struct Subscription {
    token: String,
    active: bool,
}

pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = ControlHandle {
        watch: Mutex::default(),
        worker_app,
        refused: Arc::new(Mutex::new([false; 2])),
        operation: Arc::new(Mutex::new(())),
    };
    let enabled = !crate::settings::current(app.handle())
        .disabled_features
        .iter()
        .any(|id| id == "control");
    if let Ok(mut watch) = handle.watch.lock() {
        watch.set_enabled(enabled);
    }
    app.manage(handle);
    // Private IPC lifecycle signal, emitted only by the island's typed listen wrapper.
    let weak = app.state::<ControlHandle>().worker_app.clone();
    app.listen("control://subscription", move |event| {
        if let Ok(subscription) = serde_json::from_str::<Subscription>(event.payload()) {
            if subscription.token.is_empty() || subscription.token.len() > 80 {
                return;
            }
            with_app(&weak, |app| {
                if let Some(handle) = app.try_state::<ControlHandle>()
                    && let Ok(mut watch) = handle.watch.lock()
                {
                    watch.subscribe(subscription.token, subscription.active);
                    handle.reconcile(&mut watch);
                }
            });
        }
    });
    let weak = app.state::<ControlHandle>().worker_app.clone();
    app.listen("settings://changed", move |_| {
        with_app(&weak, |app| {
            set_enabled(
                app,
                !crate::settings::current(app)
                    .disabled_features
                    .iter()
                    .any(|id| id == "control"),
            );
        });
    });
    Ok(())
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    if let Some(handle) = app.try_state::<ControlHandle>()
        && let Ok(mut watch) = handle.watch.lock()
    {
        watch.set_enabled(enabled);
        handle.reconcile(&mut watch);
        if !enabled && let Ok(mut refused) = handle.refused.lock() {
            *refused = [false; 2];
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<ControlHandle>()
        && let Ok(mut watch) = handle.watch.lock()
    {
        watch.close();
    }
}

enum Action {
    Get,
    Radio(RadioKind, bool),
    Dark(bool),
    Power(PowerMode),
}
async fn execute(
    app: AppHandle,
    handle: State<'_, ControlHandle>,
    action: Action,
) -> Result<ControlState, String> {
    if !handle.watch.lock().map_err(|e| e.to_string())?.enabled() {
        return Err("Control center is disabled".into());
    }
    let refused = handle.refused.clone();
    let operation = handle.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.lock().map_err(|e| e.to_string())?;
        let _apartment = native::Apartment::new().map_err(|e| e.to_string())?;
        let result = match action {
            Action::Get => Ok(()),
            Action::Radio(kind, on) => {
                let result = native::set_radio(kind, on);
                if let Ok(mut flags) = refused.lock() {
                    flags[usize::from(kind == RadioKind::Bluetooth)] = result.is_err();
                }
                result
            }
            Action::Dark(dark) => native::set_dark(dark),
            Action::Power(mode) => power::set(mode),
        };
        let mut state = native::query(&|| false);
        apply_refused(&mut state, &refused);
        let _ = app.emit("control://changed", &state);
        result.map(|()| state)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn control_get(
    app: AppHandle,
    handle: State<'_, ControlHandle>,
) -> Result<ControlState, String> {
    execute(app, handle, Action::Get).await
}
#[tauri::command]
pub async fn control_set_radio(
    app: AppHandle,
    handle: State<'_, ControlHandle>,
    kind: RadioKind,
    on: bool,
) -> Result<ControlState, String> {
    execute(app, handle, Action::Radio(kind, on)).await
}
#[tauri::command]
pub async fn control_set_dark_mode(
    app: AppHandle,
    handle: State<'_, ControlHandle>,
    dark: bool,
) -> Result<ControlState, String> {
    execute(app, handle, Action::Dark(dark)).await
}
#[tauri::command]
pub async fn control_set_power_mode(
    app: AppHandle,
    handle: State<'_, ControlHandle>,
    mode: PowerMode,
) -> Result<ControlState, String> {
    execute(app, handle, Action::Power(mode)).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsPage {
    Wifi,
    Bluetooth,
    Power,
    Colors,
}
#[tauri::command]
pub async fn control_open_settings(app: AppHandle, page: SettingsPage) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let uri = match page {
        SettingsPage::Wifi => "ms-settings:network-wifi",
        SettingsPage::Bluetooth => "ms-settings:bluetooth",
        SettingsPage::Power => "ms-settings:powersleep",
        SettingsPage::Colors => "ms-settings:colors",
    };
    app.opener()
        .open_url(uri, None::<&str>)
        .map_err(|e| format!("Cannot open Windows Settings: {e}"))
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("control-lifecycle").on_navigation(|webview, _| {
        // Reload/navigation destroys JS listeners even if pagehide cannot finish IPC.
        if webview.label() == "island"
            && let Some(handle) = webview.app_handle().try_state::<ControlHandle>()
            && let Ok(mut watch) = handle.watch.lock()
        { watch.clear_subscribers(); }
        true
    }).on_event(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) || matches!(event, tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "island") { shutdown(app); }
    }).build()
}
