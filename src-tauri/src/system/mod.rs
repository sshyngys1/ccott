//! System power and battery information. Owner: R2 (Rust-System).
//! Contract: `docs/contracts.md` §16.

pub mod battery;
pub mod worker;

use std::sync::Mutex;
use std::sync::{Arc, RwLock};
use std::thread::JoinHandle;
use std::time::Duration;
use worker::{Control, WorkerApp, with_app};

use tauri::{AppHandle, Emitter, Manager, State};

pub use battery::BatteryState;

const POLL_INTERVAL: Duration = Duration::from_secs(5);

pub struct SystemHandle {
    cached_battery: Arc<RwLock<BatteryState>>,
    worker_app: WorkerApp,
    thread: Mutex<Option<(Arc<Control>, JoinHandle<()>)>>,
}

impl Drop for SystemHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    let enabled = !crate::settings::current(app.handle())
        .disabled_features
        .iter()
        .any(|id| id == "battery");
    let initial_battery = if enabled {
        battery::query_system_power_status()
    } else {
        BatteryState::default()
    };
    let handle = SystemHandle {
        cached_battery: Arc::new(RwLock::new(initial_battery)),
        worker_app,
        thread: Mutex::new(None),
    };
    handle.set_enabled(enabled)?;
    app.manage(handle);

    Ok(())
}

impl SystemHandle {
    fn set_enabled(&self, enabled: bool) -> std::io::Result<()> {
        let mut thread = self.thread.lock().unwrap();
        if !enabled {
            if let Some((stop, worker)) = thread.take() {
                stop.stop();
                let _ = worker.join();
            }
        } else if thread.is_none() {
            let stop = Arc::new(Control::default());
            let stop_for_worker = stop.clone();
            let cached = self.cached_battery.clone();
            let app = self.worker_app.clone();
            let worker = std::thread::Builder::new()
                .name("system-battery-poll".into())
                .spawn(move || run_battery_poll(app, cached, stop_for_worker))?;
            *thread = Some((stop, worker));
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let _ = self.set_enabled(false);
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<SystemHandle>() {
        handle.shutdown();
    }
}
fn run_battery_poll(app: WorkerApp, cached: Arc<RwLock<BatteryState>>, stop: Arc<Control>) {
    while !stop.stopped() && app.strong_count() > 0 {
        let fresh = battery::query_system_power_status();
        let changed = {
            let mut previous = cached.write().unwrap();
            if *previous == fresh {
                false
            } else {
                *previous = fresh.clone();
                true
            }
        };
        if changed {
            with_app(&app, |app| {
                let _ = app.emit("system://battery", &fresh);
            });
        }
        stop.wait(POLL_INTERVAL);
    }
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    if let Some(handle) = app.try_state::<SystemHandle>()
        && let Err(error) = handle.set_enabled(enabled)
    {
        log::error!("battery: cannot start polling: {error}");
    }
}

// ───────────────────────────── commands ─────────────────────────────

#[tauri::command]
pub async fn system_get_battery(handle: State<'_, SystemHandle>) -> Result<BatteryState, String> {
    let guard = handle
        .cached_battery
        .read()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    Ok(guard.clone())
}
