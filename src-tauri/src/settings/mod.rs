//! Persistent settings: `settings.json` in the app data dir, `settings_get` / `settings_set`,
//! the `settings://changed` event and the side effects R1 executes itself (monitor, autostart,
//! hideInFullscreen, summonHotkey, fullscreenAllowlist, liteMode/vibrancy). Everything else (theme, DND,
//! delays) is only stored: the UI applies it. Owner: R1. Contract: `docs/contracts.md` section 3.
//!
//! Locking: `data` is only held for a copy in/out, never across calls into the windowing layer
//! (main-thread round trips). Writers are serialized with `write_lock`, which only command /
//! worker threads take, never the main thread.

#[cfg(test)]
mod lyrics_tests;
pub mod model;
pub mod store;
#[cfg(test)]
mod weather_tests;
pub mod window;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub use model::Settings;

pub const CHANGED_EVENT: &str = "settings://changed";
pub const SESSION_ONLY_ERROR: &str = "Could not save — active until restart";

pub struct SettingsState {
    data: Mutex<Settings>,
    path: PathBuf,
    /// Serializes `apply_patch` (merge + persist + side effects + emit).
    write_lock: Mutex<()>,
    pending_save: AtomicBool,
}

impl SettingsState {
    fn new(settings: Settings, path: PathBuf) -> Self {
        Self {
            data: Mutex::new(settings),
            path,
            write_lock: Mutex::new(()),
            pending_save: AtomicBool::new(false),
        }
    }

    pub fn get(&self) -> Settings {
        self.data.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn put(&self, settings: Settings) {
        *self.data.lock().unwrap_or_else(|e| e.into_inner()) = settings;
    }

    fn persist(&self, settings: &Settings) -> std::io::Result<()> {
        let result = store::save(&self.path, settings);
        self.pending_save.store(result.is_err(), Ordering::Release);
        result
    }

    fn save_startup_command(&self, command: &str) -> std::io::Result<Settings> {
        let mut settings = self.get();
        settings.command_hotkey = command.into();
        let saved = self.persist(&settings);
        // Registration remains effective in this session even when persistence failed.
        self.put(settings.clone());
        saved.map(|()| settings)
    }

    fn retry_pending_save(&self) -> Result<(), String> {
        if self.pending_save.load(Ordering::Acquire) {
            self.persist(&self.get()).map_err(|error| {
                log::error!("settings: cannot persist session settings: {error}");
                SESSION_ONLY_ERROR.to_owned()
            })?;
        }
        Ok(())
    }
}

/// Current settings (for other R1 modules).
pub fn current(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().get()
}

/// Called once during hotkey setup, before command writers can run.
pub fn save_startup_command(app: &AppHandle, command: &str) -> std::io::Result<()> {
    let state = app.state::<SettingsState>();
    let result = state.save_startup_command(command);
    // This event describes effective settings, not a claim that disk persistence succeeded.
    let _ = app.emit(CHANGED_EVENT, state.get());
    result.map(|_| ())
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
            && (rejected[0] == "summonHotkey" || rejected[0] == "commandHotkey")
            && let Some(raw) = patch.get(&rejected[0]).and_then(Value::as_str)
            && let Err(msg) = crate::hotkeys::parse_hotkey(raw)
        {
            return Err(msg);
        }
        return Err(format!("invalid settings fields: {}", rejected.join(", ")));
    }
    if new == old {
        state.retry_pending_save()?;
        return Ok(new);
    }

    // Global shortcut first: if the OS refuses (busy / invalid), reject the patch before saving
    // and leave the previous shortcut registered.
    if new.summon_hotkey != old.summon_hotkey || new.command_hotkey != old.command_hotkey {
        let (summon, command) =
            crate::hotkeys::apply_pair(app, &new.summon_hotkey, &new.command_hotkey)?;
        new.summon_hotkey = summon;
        new.command_hotkey = command;
    }

    // Autostart: if the OS refuses, the stored value must show the real state.
    if new.autostart != old.autostart {
        if let Err(e) = crate::autostart::set_enabled(app, new.autostart) {
            log::warn!("autostart: cannot set {}: {e}", new.autostart);
        }
        new.autostart = crate::autostart::is_enabled(app).unwrap_or(old.autostart);
    }

    let saved = state.persist(&new);
    if let Err(e) = &saved {
        // The settings stay valid for this session; only the persistence is lost.
        log::error!("settings: cannot write {}: {e}", state.path.display());
    }
    state.put(new.clone());

    if new.downloads_monitor != old.downloads_monitor {
        crate::downloads::set_enabled(app, new.downloads_monitor);
    }
    if new.disabled_features != old.disabled_features {
        crate::clipboard::set_enabled(
            app,
            !new.disabled_features.iter().any(|id| id == "clipboard"),
        );
        crate::system::set_enabled(app, !new.disabled_features.iter().any(|id| id == "battery"));
    }
    if new.weather_location != old.weather_location
        || new.disabled_features != old.disabled_features
    {
        crate::weather::configure(app);
    }
    if new.theme != old.theme || new.language != old.language {
        window::sync(app);
    }

    if new.lite_mode != old.lite_mode || new.vibrancy != old.vibrancy {
        crate::window::sync_vibrancy(app);
    }

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
    if new.summon_hotkey != old.summon_hotkey || new.command_hotkey != old.command_hotkey {
        crate::hotkeys::emit_status(app);
    }
    saved.map_err(|_| SESSION_ONLY_ERROR.to_owned())?;
    Ok(new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_startup_save_reports_session_only_preserves_disk_and_can_retry() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "hotkey-fallback-readonly-{}.json",
                std::process::id()
            ));
        let original = Settings::default();
        store::save(&path, &original).unwrap();
        let disk_before = std::fs::read(&path).unwrap();
        let writable = std::fs::metadata(&path).unwrap().permissions();
        let mut readonly = writable.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&path, readonly).unwrap();

        let state = SettingsState::new(original.clone(), path.clone());
        let result = state.save_startup_command(crate::hotkeys::COMMAND_HOTKEY_FALLBACKS[0]);
        let published_settings = state.get();
        let published_retry = state.retry_pending_save();
        let disk_after = std::fs::read(&path).unwrap();
        let next_start = store::load(&path);
        // Restore permissions before assertions, including when the test fails.
        std::fs::set_permissions(&path, writable).unwrap();

        assert!(result.is_err());
        assert_eq!(published_settings.command_hotkey, "Ctrl+Shift+Space");
        assert_eq!(published_retry, Err(SESSION_ONLY_ERROR.to_owned()));
        assert_eq!(disk_after, disk_before);
        assert_eq!(next_start, (original, false));
        assert!(state.pending_save.load(Ordering::Acquire));

        // Restoring write access allows an unchanged settings_set to retry the pending save.
        state.retry_pending_save().unwrap();
        assert!(!state.pending_save.load(Ordering::Acquire));
        assert_eq!(store::load(&path), (published_settings, false));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn startup_fallback_is_saved_reloaded_and_preserves_other_settings() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("hotkey-fallback-test-{}.json", std::process::id()));
        let original = Settings {
            do_not_disturb: true,
            summon_hotkey: "Ctrl+Shift+I".into(),
            ..Settings::default()
        };
        let state = SettingsState::new(original.clone(), path.clone());
        let fallback = state
            .save_startup_command(crate::hotkeys::COMMAND_HOTKEY_FALLBACKS[0])
            .unwrap();
        assert_eq!(state.get(), fallback);
        assert_eq!(store::load(&path), (fallback.clone(), false));
        assert_eq!(fallback.command_hotkey, "Ctrl+Shift+Space");
        assert_eq!(
            Settings {
                command_hotkey: original.command_hotkey.clone(),
                ..fallback
            },
            original
        );
        std::fs::remove_file(path).unwrap();
    }
}
