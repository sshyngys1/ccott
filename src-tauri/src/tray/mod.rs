//! Tray icon: "Настройки" (asks the UI to open its settings), the "Автозапуск" check item (kept in
//! sync with `Settings::autostart`) and "Выход" (the borderless island has no other way to be
//! closed). Owner: R1 (Rust-Shell).

use crate::settings::model::LanguageMode;
use serde_json::json;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use windows::Win32::Globalization::GetUserDefaultUILanguage;

const MENU_EXIT: &str = "exit";
const MENU_SETTINGS: &str = "settings";
const MENU_AUTOSTART: &str = "autostart";
/// Event the UI listens to in order to open its settings (contract section 3).
const OPEN_SETTINGS_EVENT: &str = "island://open-settings";

/// Retained handles let settings changes update both labels and the autostart check mark.
struct TrayItems {
    settings: MenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    exit: MenuItem<Wry>,
}

fn is_russian(mode: LanguageMode, windows_language: u16) -> bool {
    match mode {
        LanguageMode::Ru => true,
        LanguageMode::En => false,
        LanguageMode::Auto => windows_language & 0x03ff == 0x19,
    }
}

fn labels(mode: LanguageMode) -> (&'static str, &'static str, &'static str) {
    // SAFETY: queries the current user's display language; it takes no pointers or handles.
    let system = unsafe { GetUserDefaultUILanguage() };
    if is_russian(mode, system) {
        ("Настройки", "Автозапуск", "Выход")
    } else {
        ("Settings", "Start with Windows", "Exit")
    }
}

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
    let text = labels(crate::settings::current(app.handle()).language);
    // The "Exit" item is the only way to close the app: it is always part of the menu.
    let autostart_on = app
        .try_state::<crate::settings::SettingsState>()
        .is_some_and(|s| s.get().autostart);
    let settings = MenuItem::with_id(app, MENU_SETTINGS, text.0, true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        text.1,
        true,
        autostart_on,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, MENU_EXIT, text.2, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &autostart, &separator, &exit])?;
    app.manage(TrayItems {
        settings,
        autostart,
        exit,
    });

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
    if let Some(item) = app.try_state::<TrayItems>()
        && let Err(e) = item.autostart.set_checked(enabled)
    {
        log::warn!("tray: cannot update the autostart item: {e}");
    }
}

pub fn sync_language(app: &AppHandle) {
    let text = labels(crate::settings::current(app).language);
    if let Some(items) = app.try_state::<TrayItems>() {
        for result in [
            items.settings.set_text(text.0),
            items.autostart.set_text(text.1),
            items.exit.set_text(text.2),
        ] {
            if let Err(error) = result {
                log::warn!("tray language update failed: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_languages_override_windows_and_auto_uses_primary_language_id() {
        assert!(is_russian(LanguageMode::Ru, 0x0409));
        assert!(!is_russian(LanguageMode::En, 0x0419));
        assert!(is_russian(LanguageMode::Auto, 0x0419));
        assert!(is_russian(LanguageMode::Auto, 0x0819));
        assert!(!is_russian(LanguageMode::Auto, 0x0409));
        assert!(!is_russian(LanguageMode::Auto, 0x0407));
    }
}
