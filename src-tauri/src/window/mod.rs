//! Island window: positioning, Win32 styles, click-through, hover polling, vibrancy, fullscreen.
//! Owner: R1 (Rust-Shell). Contract: `docs/contracts.md` section 2 & 8.
//!
//! Debug-build environment switches (ignored in release builds):
//! - `ISLAND_TEST_ORIGIN=x,y` - physical window origin for testing beside an installed instance.
//! - `ISLAND_VIBRANCY=acrylic|mica` - apply the native backdrop at startup (bypasses the
//!   `NATIVE_BLUR_ENABLED` switch; the frontend normally goes through `window_set_vibrancy`).
//! - `ISLAND_NATIVE_BLUR=1` - let `window_set_vibrancy` apply native blur (off by default, see
//!   `vibrancy.rs`).
//! - `ISLAND_ACRYLIC_IMPL=backdrop` - Acrylic through `DWMWA_SYSTEMBACKDROP_TYPE` instead of the
//!   accent policy.
//! - `ISLAND_REGION=0` - never install the `SetWindowRgn` clip.
//! - `npm run tauri dev` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
//!   exposes the WebView over CDP (used by the spike to drive `island_set_shape`).

pub(crate) mod capture_overlay;
mod capture_visibility;
mod focus;
pub(crate) use capture_visibility::CaptureVisibility;
mod fullscreen;
mod hover;
mod monitor;
mod native;
mod shape;
mod styles;
mod types;
mod vibrancy;

use std::sync::atomic::{AtomicBool, AtomicIsize};
use std::sync::{Mutex, OnceLock, RwLock};
use std::thread::Thread;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Runtime, State, WebviewWindow, WindowEvent};

use hover::HoverSync;
use shape::RegionRect;
pub use types::{
    FullscreenApp, IslandMode, IslandShape, MonitorInfo, VibrancyMode, VibrancyResult,
};

/// The app handle for code that has no other way to reach it (window procedure, event hooks).
pub(crate) static APP: OnceLock<AppHandle> = OnceLock::new();

/// Managed state of the island window, shared by commands and the hover thread.
/// Locks are never held across calls into the windowing layer.
pub struct IslandState {
    pub(crate) capture_active: AtomicBool,
    /// Current visible shape (CSS px, relative to the window).
    pub(crate) shape: RwLock<IslandShape>,
    pub(crate) mode: RwLock<IslandMode>,
    /// Backdrop that is actually applied.
    pub(crate) vibrancy: Mutex<VibrancyMode>,
    /// Region currently installed with `SetWindowRgn` (`None` = no region).
    pub(crate) region: Mutex<Option<RegionRect>>,
    /// Cursor is inside the shape (written by the hover thread).
    pub(crate) inside: AtomicBool,
    /// When the current `inside` value is emitted again (also serializes hover emits).
    pub(crate) hover_sync: Mutex<HoverSync>,
    pub(crate) prewarm: Mutex<hover::PrewarmGate>,
    /// Set on exit / window destruction: the hover thread leaves its loop.
    pub(crate) stop: AtomicBool,
    /// Handle used to wake the hover thread when `stop` is set.
    pub(crate) hover_thread: Mutex<Option<Thread>>,
    /// `monitor::reposition` is running (guards against re-entrancy through `Resized`).
    pub(crate) repositioning: AtomicBool,
    /// Native handle of the island window (set once in `setup`; 0 before that). Looked up once
    /// because `WebviewWindow::hwnd` is a main-thread round trip.
    pub(crate) hwnd: AtomicIsize,
    /// `Settings::monitor`: a monitor id or `"primary"`.
    pub(crate) monitor_pref: RwLock<String>,
    /// The island is hidden because a fullscreen or auto-hide app is in the foreground (`fullscreen.rs`).
    pub(crate) fullscreen_hidden: AtomicBool,
    /// Foreground window currently matches `autoHideApps` (maximized or top-edge, not fullscreen).
    pub(crate) autohide_active: AtomicBool,
    /// Temporarily shown over a fullscreen or auto-hide app via `summonHotkey` until collapsed.
    pub(crate) summoned: AtomicBool,
    /// Temporarily shown over an auto-hide app via top-edge cursor dwell until collapsed / cursor leaves.
    pub(crate) dwell_revealed: AtomicBool,
    /// Top-edge 400 ms dwell state machine (`hover.rs`).
    pub(crate) dwell: Mutex<hover::TopEdgeDwell>,
    /// Thread id of the fullscreen watcher while it runs.
    pub(crate) fullscreen_thread: Mutex<Option<u32>>,
    /// Recently seen fullscreen apps (`fullscreen_seen.json`).
    pub(crate) fullscreen_seen: Mutex<fullscreen::SeenStore>,
    /// Recently seen maximized / top-edge apps (`maximized_seen.json`).
    pub(crate) maximized_seen: Mutex<fullscreen::SeenStore>,
}

impl Default for IslandState {
    fn default() -> Self {
        Self {
            capture_active: AtomicBool::new(false),
            shape: RwLock::new(IslandShape::DEFAULT_PILL),
            mode: RwLock::new(IslandMode::Collapsed),
            vibrancy: Mutex::new(VibrancyMode::None),
            region: Mutex::new(None),
            inside: AtomicBool::new(false),
            hover_sync: Mutex::new(HoverSync::new()),
            prewarm: Mutex::new(hover::PrewarmGate::default()),
            stop: AtomicBool::new(false),
            hover_thread: Mutex::new(None),
            repositioning: AtomicBool::new(false),
            hwnd: AtomicIsize::new(0),
            monitor_pref: RwLock::new("primary".to_string()),
            fullscreen_hidden: AtomicBool::new(false),
            autohide_active: AtomicBool::new(false),
            summoned: AtomicBool::new(false),
            dwell_revealed: AtomicBool::new(false),
            dwell: Mutex::new(hover::TopEdgeDwell::new()),
            fullscreen_thread: Mutex::new(None),
            fullscreen_seen: Mutex::new(fullscreen::SeenStore::default()),
            maximized_seen: Mutex::new(fullscreen::SeenStore::default()),
        }
    }
}

/// Plugin with the app-wide hooks of the island window (registered in `lib.rs`, plugins: R1):
/// page loads of the island WebView and the end of the event loop.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("island-window")
        .on_page_load(|webview, payload| {
            if webview.label() != "island" {
                return;
            }
            log::debug!("island page {:?}: {}", payload.event(), payload.url());
            // Both phases: listeners of the previous page are gone from `Started` on, and the new
            // page registers its own some time before `Finished`.
            if matches!(
                payload.event(),
                PageLoadEvent::Started | PageLoadEvent::Finished
            ) && let Some(state) = webview.app_handle().try_state::<IslandState>()
            {
                hover::page_loaded(&state);
            }
        })
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(wry_app) = APP.get() {
                    crate::hotkeys::on_exit(wry_app);
                    fullscreen::stop(wry_app);
                }
                if let Some(state) = app.try_state::<IslandState>() {
                    hover::stop(&state);
                }
            }
        })
        .build()
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let _ = APP.set(app.handle().clone());
    app.manage(IslandState::default());

    if let Ok(dir) = app.path().app_data_dir() {
        let state = app.state::<IslandState>();
        fullscreen::init_seen_store(&state, dir.join(fullscreen::SEEN_FILE_NAME));
        fullscreen::init_maximized_seen_store(
            &state,
            dir.join(fullscreen::MAXIMIZED_SEEN_FILE_NAME),
        );
    }

    // Settings are loaded before this runs (see `settings::setup`): start on the chosen monitor.
    let settings = app
        .try_state::<crate::settings::SettingsState>()
        .map(|s| s.get());
    if let Some(s) = &settings {
        *app.state::<IslandState>()
            .monitor_pref
            .write()
            .unwrap_or_else(|e| e.into_inner()) = s.monitor.clone();
    }

    let window = app
        .get_webview_window("island")
        .ok_or("window `island` is not configured")?;
    let hwnd = styles::hwnd_of(&window)?;
    app.state::<IslandState>()
        .hwnd
        .store(hwnd.0 as isize, std::sync::atomic::Ordering::Relaxed);

    // Styles first, so the window can never activate; they stay in force for the window's whole
    // life (see `styles`). Click-through until the cursor is on the shape (hover thread flips it).
    styles::install(hwnd)?;
    window.set_ignore_cursor_events(true)?;

    monitor::reposition(&window, &app.state::<IslandState>())?;
    window.show()?;
    styles::ensure_topmost(hwnd)?;

    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("ISLAND_VIBRANCY") {
        let mode = match v.as_str() {
            "acrylic" => VibrancyMode::Acrylic,
            "mica" => VibrancyMode::Mica,
            _ => VibrancyMode::None,
        };
        let state = app.state::<IslandState>();
        let result = vibrancy::apply_forced(&window, &state, mode);
        log::debug!("ISLAND_VIBRANCY={v}: {result:?}");
    }

    // DPI / resolution changes: recompute the position. `reposition` is idempotent (±1 px
    // tolerance, re-entrancy guard), so our own `set_size` / `set_position` cannot start a loop.
    let w = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            let state = w.state::<IslandState>();
            if let Err(e) = monitor::reposition(&w, &state) {
                log::warn!("repositioning the island failed: {e}");
            }
            vibrancy::sync_region(&w, &state);
        }
        WindowEvent::Destroyed => {
            crate::hotkeys::on_exit(w.app_handle());
            hover::stop(&w.state::<IslandState>());
        }
        _ => {}
    });

    hover::spawn(app.handle(), &window);
    fullscreen::set_enabled(app.handle(), true);
    Ok(())
}

/// `Settings::monitor` changed: remember the preference and move the island there (the primary
/// monitor when the chosen one is not connected; the preference is kept, so the island returns
/// when the monitor does). Called from `settings_set`.
pub fn set_monitor_pref(app: &AppHandle, pref: &str) {
    let state = app.state::<IslandState>();
    *state
        .monitor_pref
        .write()
        .unwrap_or_else(|e| e.into_inner()) = pref.to_string();
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    match monitor::reposition(&window, &state) {
        Ok(moved) => log::debug!("island monitor = {pref:?}, moved: {moved}"),
        Err(e) => log::warn!("moving the island to {pref:?} failed: {e}"),
    }
    fullscreen::recheck(app);
}

/// `Settings::hideInFullscreen` changed: start or stop the watcher (showing the island again if
/// it was hidden).
pub fn set_hide_in_fullscreen(app: &AppHandle, enabled: bool) {
    fullscreen::set_enabled(app, enabled);
}

/// `Settings::fullscreenAllowlist` changed: re-evaluate the current foreground window immediately.
pub fn set_fullscreen_allowlist(app: &AppHandle) {
    fullscreen::recheck(app);
}

/// `Settings::autoHideApps` changed: re-evaluate the current foreground window immediately.
pub fn set_auto_hide_apps(app: &AppHandle) {
    fullscreen::recheck(app);
}

/// Called by the global shortcut plugin when `summonHotkey` is pressed.
pub fn summon_for_runtime<R: Runtime>(_app: &AppHandle<R>) {
    if let Some(app) = APP.get() {
        fullscreen::summon(app);
    }
}

/// Called by the global shortcut plugin when temporary `Escape` is pressed.
pub fn collapse_summoned_for_runtime<R: Runtime>(_app: &AppHandle<R>) {
    if let Some(app) = APP.get() {
        fullscreen::collapse_summoned(app);
    }
}

/// The UI reports the visible island shape (CSS px, relative to the window). Called at most once
/// per animation frame.
#[tauri::command]
pub fn island_set_shape(
    window: WebviewWindow,
    state: State<'_, IslandState>,
    shape: IslandShape,
) -> Result<(), String> {
    if !shape.is_valid() {
        return Err(format!("invalid island shape: {shape:?}"));
    }
    *state.shape.write().unwrap_or_else(|e| e.into_inner()) = shape;
    vibrancy::sync_region(&window, &state);
    // The first call after a page load tells the UI where the cursor is (see `hover::HoverSync`).
    hover::resync_on_shape(window.app_handle(), &state);
    Ok(())
}

/// The UI reports collapsed/expanded (the hover thread polls less often while collapsed).
/// Also re-emits the current `island://hover` state, in case the UI missed it.
#[tauri::command]
pub fn island_set_mode(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, IslandState>,
    mode: IslandMode,
) -> Result<(), String> {
    *state.mode.write().unwrap_or_else(|e| e.into_inner()) = mode;
    if matches!(mode, IslandMode::Expanded) {
        styles::ensure_topmost(styles::hwnd_of(&window)?)?;
    } else {
        state
            .summoned
            .store(false, std::sync::atomic::Ordering::Release);
        hover::on_collapsed(&state);
        crate::hotkeys::on_collapsed(&app);
        fullscreen::recheck(&app);
    }
    hover::resync_on_mode(&app, &state);
    Ok(())
}

/// Apply a native backdrop. Never fails: on error `applied` is `none` and `error` has the text.
#[tauri::command]
pub fn window_set_vibrancy(
    window: WebviewWindow,
    state: State<'_, IslandState>,
    mode: VibrancyMode,
) -> VibrancyResult {
    vibrancy::apply(&window, &state, mode)
}

/// The UI needs (`active`) or no longer needs the keyboard (contract section 3a). Idempotent.
/// Blocking Win32 work (foreground handover), hence a worker thread.
#[tauri::command]
pub async fn island_set_keyboard_focus(app: AppHandle, active: bool) -> Result<(), String> {
    let request = focus::request(active);
    tauri::async_runtime::spawn_blocking(move || focus::set_active(&app, request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn window_list_monitors(window: WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    monitor::list(&window)
}

#[tauri::command]
pub fn window_recent_fullscreen_apps(state: State<'_, IslandState>) -> Vec<FullscreenApp> {
    fullscreen::recent_apps(&state)
}

#[tauri::command]
pub fn window_recent_maximized_apps(state: State<'_, IslandState>) -> Vec<FullscreenApp> {
    fullscreen::recent_maximized_apps(&state)
}
