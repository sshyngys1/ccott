mod hooks;
#[path = "hook/model.rs"]
mod model;
mod native;
#[cfg(test)]
#[path = "hook/pipe_sender.rs"]
mod pipe_sender;
#[cfg(test)]
#[path = "hook/sender.rs"]
mod sender;

use crate::system::worker::{WorkerApp, with_app};
use model::{Session, Sessions, Tool};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager, State};

pub struct Agents {
    sessions: Arc<Mutex<Sessions>>,
    server: Mutex<Option<native::Server>>,
    app: WorkerApp,
    config_lock: Arc<Mutex<()>>,
}
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn enabled(app: &AppHandle) -> bool {
    !crate::settings::current(app)
        .disabled_features
        .iter()
        .any(|id| id == "agents")
}
impl Agents {
    fn set_enabled(&self, enabled: bool) {
        let mut server = self.server.lock().unwrap();
        if enabled && server.is_some() {
            return;
        }
        let _ = native::set_enabled(&mut server, false, native::PIPE_NAME, |_| false);
        self.sessions.lock().unwrap().0 = Vec::new();
        with_app(&self.app, |app| {
            let _ = app.emit("agents://changed", Vec::<Session>::new());
        });
        if !enabled {
            return;
        }
        let (sessions, app) = (self.sessions.clone(), self.app.clone());
        if let Err(error) = native::set_enabled(&mut server, true, native::PIPE_NAME, move |line| {
            let mut sessions = sessions.lock().unwrap();
            let now = now_ms();
            let changed = sessions.prune(now) | line.is_some_and(|line| sessions.accept(line, now));
            if changed {
                with_app(&app, |app| {
                    let _ = app.emit("agents://changed", &sessions.0);
                });
            }
            !sessions.0.is_empty()
        }) {
            log::warn!("agents pipe: {error}");
        }
    }
}
pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Agents {
        sessions: Arc::default(),
        server: Mutex::default(),
        app: worker_app.clone(),
        config_lock: Arc::default(),
    });
    app.state::<Agents>().set_enabled(enabled(app.handle()));
    app.listen("settings://changed", move |_| {
        with_app(&worker_app, |app| {
            if let Some(state) = app.try_state::<Agents>() {
                state.set_enabled(enabled(app));
            }
        });
    });
    Ok(())
}
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<Agents>() {
        state.set_enabled(false);
    }
}
#[tauri::command]
pub fn agents_list(state: State<'_, Agents>) -> Vec<Session> {
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.prune(now_ms()) {
        with_app(&state.app, |app| {
            let _ = app.emit("agents://changed", &sessions.0);
        });
    }
    sessions.0.clone()
}
#[tauri::command]
pub fn agents_dismiss(app: AppHandle, state: State<'_, Agents>, id: String) {
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.dismiss(&id) {
        let _ = app.emit("agents://changed", &sessions.0);
    }
}
#[tauri::command]
pub async fn agents_hooks_status(state: State<'_, Agents>) -> Result<hooks::HooksStatus, String> {
    let lock = state.config_lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        Ok(hooks::Config::current()?.status())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn agents_set_hooks(
    state: State<'_, Agents>,
    tool: Tool,
    installed: bool,
) -> Result<hooks::HooksStatus, String> {
    let lock = state.config_lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        hooks::Config::current()?.set(tool, installed)
    })
    .await
    .map_err(|e| e.to_string())?
}
