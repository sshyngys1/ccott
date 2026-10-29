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
    stop: Arc<Control>,
    thread: Mutex<Option<JoinHandle<()>>>,
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
    let initial_battery = battery::query_system_power_status();
    let cached_battery = Arc::new(RwLock::new(initial_battery.clone()));
    let stop = Arc::new(Control::default());

    let cached_for_worker = cached_battery.clone();
    let stop_for_worker = stop.clone();
    let thread = std::thread::Builder::new()
        .name("system-battery-poll".into())
        .spawn(move || {
            run_battery_poll(worker_app, cached_for_worker, stop_for_worker);
        })?;
    app.manage(SystemHandle {
        cached_battery,
        stop,
        thread: Mutex::new(Some(thread)),
    });

    Ok(())
}

impl SystemHandle {
    pub fn shutdown(&self) {
        self.stop.stop();
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<SystemHandle>() {
        handle.shutdown();
    }
}
fn run_battery_poll(app: WorkerApp, cached: Arc<RwLock<BatteryState>>, stop: Arc<Control>) {
    while !stop.stopped() && app.strong_count() > 0 {
        stop.wait(POLL_INTERVAL);
        if stop.stopped() {
            break;
        }
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
