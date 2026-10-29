// Owner: Orchestrator. Agents add lines ONLY inside their own marked section.

// ── modules: R1 (Rust-Shell) ──
mod autostart;
mod hotkeys;
mod settings;
mod tray;
mod updater;
mod window;
// ── modules: R2 (Rust-System) ──
mod audio;
mod capture;
mod clipboard;
mod db;
mod dock;
mod media;
mod notes;
mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // R2: the run loop owns this anchor; managed workers retain only Weak references to it.
    let worker_anchor = std::sync::Arc::new(std::sync::OnceLock::new());
    let worker_app = std::sync::Arc::downgrade(&worker_anchor);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        // ── plugins: R1 ──
        .plugin(autostart::plugin())
        .plugin(hotkeys::plugin())
        .plugin(updater::plugin())
        .plugin(window::plugin())
        // ── plugins: R2 ──
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("system-shutdown")
                .on_event(|app, event| {
                    if matches!(event, tauri::RunEvent::Exit) {
                        audio::shutdown(app);
                        system::shutdown(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // ── setup: R1 ──
            settings::setup(app)?; // before the window: it reads the monitor / fullscreen settings
            window::setup(app)?;
            hotkeys::setup(app)?;
            tray::setup(app)?;
            updater::setup(app)?;
            // ── setup: R2 ──
            if let Some(anchor) = worker_app.upgrade() {
                let _ = anchor.set(app.handle().clone());
            }
            db::setup(app)?;
            audio::setup(app, worker_app.clone())?;
            clipboard::setup(app)?;
            media::setup(app)?;
            system::setup(app, worker_app.clone())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── commands: R1 ──
            window::island_set_shape,
            window::island_set_mode,
            window::window_set_vibrancy,
            window::window_list_monitors,
            window::island_set_keyboard_focus,
            window::window_recent_fullscreen_apps,
            window::window_recent_maximized_apps,
            settings::settings_get,
            settings::settings_set,
            updater::updater_check,
            updater::updater_install,
            // ── commands: R2 ──
            dock::dock_list,
            dock::dock_add,
            dock::dock_remove,
            dock::dock_reorder,
            dock::dock_open,
            dock::dock_start_drag,
            capture::capture_start,
            capture::capture_pick_color,
            capture::capture_open_folder,
            capture::capture_ocr_languages,
            audio::audio_get_state,
            audio::audio_set_volume,
            audio::audio_set_muted,
            audio::audio_list_devices,
            audio::audio_set_device,
            audio::audio_visualizer_set_enabled,
            clipboard::clipboard_list,
            clipboard::clipboard_paste,
            clipboard::clipboard_pin,
            clipboard::clipboard_delete,
            clipboard::clipboard_clear,
            media::media_get_state,
            media::media_action,
            media::media_seek,
            notes::notes_list,
            notes::notes_save,
            notes::notes_delete,
            system::system_get_battery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    drop(worker_anchor);
}
