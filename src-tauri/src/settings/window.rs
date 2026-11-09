//! Ordinary settings window. Creation is serialized off the UI thread (WebView2 requirement).
use super::model::{Settings, ThemeMode};
use tauri::{AppHandle, Manager, PhysicalPosition, Theme, WebviewUrl, WebviewWindowBuilder};

fn theme(settings: &Settings) -> Option<Theme> {
    match settings.theme {
        ThemeMode::Auto => None,
        ThemeMode::Light => Some(Theme::Light),
        ThemeMode::Dark => Some(Theme::Dark),
    }
}

fn title(settings: &Settings) -> String {
    format!("CCOTT — {}", crate::tray::labels(settings.language).0)
}

fn open_serialized(app: &AppHandle) -> tauri::Result<()> {
    static OPEN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = OPEN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(window) = app.get_webview_window("settings") {
        window.show()?;
        window.unminimize()?;
        return window.set_focus();
    }
    let settings = super::current(app);
    let monitor = app
        .get_webview_window("island")
        .and_then(|island| island.current_monitor().ok().flatten());
    let window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title(title(&settings))
            .inner_size(760.0, 680.0)
            .min_inner_size(640.0, 520.0)
            .decorations(true)
            .resizable(true)
            .skip_taskbar(false)
            .always_on_top(false)
            .focusable(true)
            .focused(true)
            .theme(theme(&settings))
            .visible(false)
            .build()?;
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let size = window.outer_size()?;
        window.set_position(PhysicalPosition::new(
            area.position.x + (area.size.width as i32 - size.width as i32) / 2,
            area.position.y + (area.size.height as i32 - size.height as i32) / 2,
        ))?;
    } else {
        window.center()?;
    }
    // No CloseRequested handler: Tauri destroys the window and releases its WebView.
    window.show()?;
    window.set_focus()
}

/// Tray callbacks must return to the Windows event loop before WebView2 creation can finish.
pub fn open(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = open_serialized(&handle) {
            log::error!("cannot open settings window: {error}");
        }
    });
}

pub fn sync(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("settings") {
            let settings = super::current(&handle);
            if let Err(error) = window.set_title(&title(&settings)) {
                log::warn!("settings title: {error}");
            }
            if let Err(error) = window.set_theme(theme(&settings)) {
                log::warn!("settings theme: {error}");
            }
        }
    });
}

#[tauri::command]
pub async fn settings_window_open(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_serialized(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
