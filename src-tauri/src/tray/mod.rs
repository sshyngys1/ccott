//! Tray icon: "Настройки" (asks the UI to open its settings), the "Автозапуск" check item (kept in
//! sync with `Settings::autostart`) and "Выход" (the borderless island has no other way to be
//! closed). Owner: R1 (Rust-Shell).

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const MENU_EXIT: &str = "exit";
const MENU_SETTINGS: &str = "settings";
const MENU_AUTOSTART: &str = "autostart";
/// Event the UI listens to in order to open its settings (contract section 3).
const OPEN_SETTINGS_EVENT: &str = "island://open-settings";

/// The "Автозапуск" item, kept so that settings changes made elsewhere can update its check mark.
struct AutostartItem(CheckMenuItem<Wry>);

/// Small-crop 32x32 icon for the system tray, with `default_window_icon()` as fallback.
const TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/32x32.png");

/// The embedded 32x32 tray icon, or `default_window_icon()` when decoding fails.
fn tray_icon(app: &tauri::App) -> Option<Image<'_>> {
    match Image::from_bytes(TRAY_ICON_PNG) {
        Ok(icon) => Some(icon),
        Err(e) => {
            log::warn!("cannot decode the embedded tray icon: {e}");
            app.default_window_icon().cloned()
        }
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // The "Exit" item is the only way to close the app: it is always part of the menu.
    let autostart_on = app
        .try_state::<crate::settings::SettingsState>()
        .is_some_and(|s| s.get().autostart);
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Настройки", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        "Автозапуск",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, MENU_EXIT, "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &autostart, &separator, &exit])?;
    app.manage(AutostartItem(autostart));

    let mut builder = TrayIconBuilder::with_id("island-tray")
        .tooltip("CCOTT")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_EXIT => app.exit(0),
            MENU_SETTINGS => {
                let _ = app.emit(OPEN_SETTINGS_EVENT, ());
            }
            MENU_AUTOSTART => toggle_autostart(app),
            _ => {}
        });
    if let Some(icon) = tray_icon(app) {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// The item was clicked (the menu already flipped its check mark): flip the setting on a worker
/// thread (it touches the registry and the disk), then show the state that really resulted.
fn toggle_autostart(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let wanted = !crate::settings::current(&app).autostart;
        if let Err(e) = crate::settings::apply_patch(&app, &json!({ "autostart": wanted })) {
            log::warn!("tray: cannot change autostart: {e}");
        }
        sync_autostart(&app, crate::settings::current(&app).autostart);
    });
}

/// Sets the check mark of the "Автозапуск" item (the setting changed elsewhere).
pub fn sync_autostart(app: &AppHandle, enabled: bool) {
    if let Some(item) = app.try_state::<AutostartItem>()
        && let Err(e) = item.0.set_checked(enabled)
    {
        log::warn!("tray: cannot update the autostart item: {e}");
    }
}
