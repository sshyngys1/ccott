//! Persistent settings: `settings.json` in the app data dir, `settings_get` / `settings_set`,
//! the `settings://changed` event and the side effects R1 executes itself (monitor, autostart,
//! hideInFullscreen, summonHotkey, fullscreenAllowlist). Everything else (theme, vibrancy, DND,
//! delays) is only stored: the UI applies it. Owner: R1. Contract: `docs/contracts.md` section 3.
//!
//! Locking: `data` is only held for a copy in/out, never across calls into the windowing layer
//! (main-thread round trips). Writers are serialized with `write_lock`, which only command /
//! worker threads take, never the main thread.

pub mod model;
pub mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub use model::Settings;

pub const CHANGED_EVENT: &str = "settings://changed";

pub struct SettingsState {
    data: Mutex<Settings>,
    path: PathBuf,
    /// Serializes `apply_patch` (merge + persist + side effects + emit).
    write_lock: Mutex<()>,
}

impl SettingsState {
    fn new(settings: Settings, path: PathBuf) -> Self {
        Self {
            data: Mutex::new(settings),
            path,
            write_lock: Mutex::new(()),
        }
    }

    pub fn get(&self) -> Settings {
        self.data.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn put(&self, settings: Settings) {
        *self.data.lock().unwrap_or_else(|e| e.into_inner()) = settings;
    }
}

/// Current settings (for other R1 modules).
pub fn current(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().get()
}

/// Loads the settings and syncs the OS autostart entry. Must run before `window::setup`, which
/// reads the monitor preference and the fullscreen switch from here.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    let path = dir.join(store::FILE_NAME);
    let (mut settings, missing) = store::load(&path);

    // The setting is the source of truth; if the OS entry cannot be changed, show the real state.
    settings.autostart = crate::autostart::sync(app.handle(), settings.autostart);

    if missing && let Err(e) = store::save(&path, &settings) {
        log::warn!("settings: cannot create {}: {e}", path.display());
    }
    log::debug!("settings loaded from {}: {settings:?}", path.display());
    app.manage(SettingsState::new(settings, path));
    Ok(())
}

#[tauri::command]
pub async fn settings_get(state: State<'_, SettingsState>) -> Result<Settings, String> {
    Ok(state.get())
}

/// Merges `patch` (a partial `Settings`, unknown fields ignored, delays clamped), persists,
/// applies the side effects and emits `settings://changed` with the full value.
/// Invalid fields reject the whole patch.
#[tauri::command]
pub async fn settings_set(app: AppHandle, patch: Value) -> Result<Settings, String> {
    tauri::async_runtime::spawn_blocking(move || apply_patch(&app, &patch))
        .await
        .map_err(|e| e.to_string())?
}

pub fn apply_patch(app: &AppHandle, patch: &Value) -> Result<Settings, String> {
    let state = app.state::<SettingsState>();
    let _writer = state.write_lock.lock().unwrap_or_else(|e| e.into_inner());

    let old = state.get();
    let mut new = old.clone();
    let rejected = new.merge_json(patch);
    if !rejected.is_empty() {
        if rejected.len() == 1
            && rejected[0] == "summonHotkey"
            && let Some(raw) = patch.get("summonHotkey").and_then(Value::as_str)
            && let Err(msg) = crate::hotkeys::parse_hotkey(raw)
        {
            return Err(msg);
        }
        return Err(format!("invalid settings fields: {}", rejected.join(", ")));
    }
    if new == old {
        return Ok(new);
    }

    // Global shortcut first: if the OS refuses (busy / invalid), reject the patch before saving
    // and leave the previous shortcut registered.
    if new.summon_hotkey != old.summon_hotkey {
        new.summon_hotkey = crate::hotkeys::apply(app, &new.summon_hotkey)?;
    }

    // Autostart: if the OS refuses, the stored value must show the real state.
    if new.autostart != old.autostart {
        if let Err(e) = crate::autostart::set_enabled(app, new.autostart) {
            log::warn!("autostart: cannot set {}: {e}", new.autostart);
        }
        new.autostart = crate::autostart::is_enabled(app).unwrap_or(old.autostart);
    }

    if let Err(e) = store::save(&state.path, &new) {
        // The settings stay valid for this session; only the persistence is lost.
        log::error!("settings: cannot write {}: {e}", state.path.display());
    }
    state.put(new.clone());

    if new.monitor != old.monitor {
        crate::window::set_monitor_pref(app, &new.monitor);
    }
    if new.hide_in_fullscreen != old.hide_in_fullscreen {
        crate::window::set_hide_in_fullscreen(app, new.hide_in_fullscreen);
    }
    if new.fullscreen_allowlist != old.fullscreen_allowlist {
        crate::window::set_fullscreen_allowlist(app);
    }
    if new.auto_hide_apps != old.auto_hide_apps {
        crate::window::set_auto_hide_apps(app);
    }
    if new.autostart != old.autostart {
        crate::tray::sync_autostart(app, new.autostart);
    }
    if new.language != old.language {
        crate::tray::sync_language(app);
    }

    if new != old {
        let _ = app.emit(CHANGED_EVENT, &new);
    }
    Ok(new)
}
