//! Launch at login through `tauri-plugin-autostart` (HKCU `Run` key on Windows).
//! Owner: R1. The UI never calls the plugin directly: it goes through `settings_set`.

use std::iter::once;

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, RegCloseKey, RegDeleteValueW, RegOpenKeyExW,
};
use windows::core::PCWSTR;

/// Previous `productName` value before the CCOTT rebrand; cleaned up on autostart sync so upgrades
/// do not leave an orphaned `island-win` startup entry in `HKCU\...\Run`.
const LEGACY_APP_NAME: &str = "island-win";
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
const STARTUP_APPROVED_KEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_autostart::Builder::new().build()
}

fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(once(0)).collect()
}

/// Deletes `value_name` under `root\subkey` if present. Missing key/value is treated as success.
fn delete_reg_value(root: HKEY, subkey: &str, value_name: &str) -> Result<(), String> {
    let subkey_w = wide_null(subkey);
    let value_w = wide_null(value_name);
    let mut hkey = HKEY::default();
    // SAFETY: `subkey_w` is NUL-terminated and lives for the call; `hkey` receives the opened key.
    let open_status = unsafe {
        RegOpenKeyExW(
            root,
            PCWSTR(subkey_w.as_ptr()),
            Some(0),
            KEY_SET_VALUE,
            &mut hkey,
        )
    };
    if open_status == ERROR_FILE_NOT_FOUND || open_status == ERROR_PATH_NOT_FOUND {
        return Ok(());
    }
    if open_status != ERROR_SUCCESS {
        return Err(format!("RegOpenKeyExW({subkey}) failed: {}", open_status.0));
    }
    // SAFETY: `hkey` is a valid open registry key handle and `value_w` is NUL-terminated.
    let del_status = unsafe { RegDeleteValueW(hkey, PCWSTR(value_w.as_ptr())) };
    // SAFETY: `hkey` was opened by `RegOpenKeyExW` above and is not used afterwards.
    let _ = unsafe { RegCloseKey(hkey) };
    if del_status == ERROR_SUCCESS || del_status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!(
            "RegDeleteValueW({subkey}\\{value_name}) failed: {}",
            del_status.0
        ))
    }
}

fn remove_legacy_run_entry() {
    for subkey in [RUN_KEY, STARTUP_APPROVED_KEY] {
        if let Err(e) = delete_reg_value(HKEY_CURRENT_USER, subkey, LEGACY_APP_NAME) {
            log::warn!("autostart: cannot remove legacy {LEGACY_APP_NAME} in {subkey}: {e}");
        }
    }
}

/// The real OS state.
pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    remove_legacy_run_entry();
    let launcher = app.autolaunch();
    let res = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|e| e.to_string());
    if !enabled {
        let app_name = &app.package_info().name;
        if let Err(e) = delete_reg_value(HKEY_CURRENT_USER, STARTUP_APPROVED_KEY, app_name) {
            log::warn!("autostart: cannot remove {app_name} in {STARTUP_APPROVED_KEY}: {e}");
        }
    }
    res
}

/// Makes the OS state equal to `wanted` (the setting is the source of truth). Returns the state
/// the OS ended up in.
pub fn sync<R: Runtime>(app: &AppHandle<R>, wanted: bool) -> bool {
    remove_legacy_run_entry();
    match is_enabled(app) {
        Ok(current) if current == wanted => current,
        Ok(current) => match set_enabled(app, wanted) {
            Ok(()) => wanted,
            Err(e) => {
                log::warn!("autostart: cannot set {wanted}: {e}");
                current
            }
        },
        Err(e) => {
            log::warn!("autostart: cannot read the state: {e}");
            wanted
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Registry::{
        REG_SZ, RegCreateKeyW, RegDeleteTreeW, RegQueryValueExW, RegSetValueExW,
    };

    #[test]
    fn delete_reg_value_removes_legacy_value_in_temp_key() {
        let subkey = format!(
            r"Software\Classes\Local Settings\Software\ccott-autostart-test-{}",
            std::process::id()
        );
        let subkey_w = wide_null(&subkey);
        let value_w = wide_null(LEGACY_APP_NAME);
        let data_w = wide_null(r"C:\fake\island-win.exe");

        let mut hkey = HKEY::default();
        // SAFETY: creating a process-local temporary test key under HKCU.
        let status =
            unsafe { RegCreateKeyW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr()), &mut hkey) };
        assert_eq!(status, ERROR_SUCCESS);

        // SAFETY: writing a test string value to the opened temporary key.
        let bytes =
            unsafe { std::slice::from_raw_parts(data_w.as_ptr() as *const u8, data_w.len() * 2) };
        // SAFETY: `hkey` is valid and `bytes` points to valid UTF-16 bytes.
        let set_status =
            unsafe { RegSetValueExW(hkey, PCWSTR(value_w.as_ptr()), Some(0), REG_SZ, Some(bytes)) };
        assert_eq!(set_status, ERROR_SUCCESS);

        delete_reg_value(HKEY_CURRENT_USER, &subkey, LEGACY_APP_NAME).unwrap();
        // Second call when already absent must also succeed.
        delete_reg_value(HKEY_CURRENT_USER, &subkey, LEGACY_APP_NAME).unwrap();

        // SAFETY: querying the deleted value to verify it was removed.
        let query_status =
            unsafe { RegQueryValueExW(hkey, PCWSTR(value_w.as_ptr()), None, None, None, None) };
        assert_eq!(query_status, ERROR_FILE_NOT_FOUND);

        // SAFETY: closing and deleting the temporary test key.
        let _ = unsafe { RegCloseKey(hkey) };
        let _ = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr())) };
    }

    #[test]
    fn installer_hooks_clean_run_and_startup_approved_for_current_and_legacy_names() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("valid tauri.conf.json");
        let product_name = conf["productName"].as_str().expect("productName string");
        assert_eq!(product_name, "CCOTT");
        assert_eq!(
            conf["bundle"]["windows"]["nsis"]["installerHooks"].as_str(),
            Some("installer/nsis-hooks.nsh")
        );
        assert_eq!(
            conf["bundle"]["windows"]["wix"]["fragmentPaths"][0].as_str(),
            Some("installer/wix-autostart-cleanup.wxs")
        );

        let nsis_hooks = include_str!("../../installer/nsis-hooks.nsh");
        assert!(nsis_hooks.contains("NSIS_HOOK_POSTUNINSTALL"));
        assert!(nsis_hooks.contains(r#"Software\Microsoft\Windows\CurrentVersion\Run"#));
        assert!(
            nsis_hooks.contains(
                r#"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"#
            )
        );
        assert!(nsis_hooks.contains("${PRODUCTNAME}"));
        assert!(nsis_hooks.contains(LEGACY_APP_NAME));
        assert!(!nsis_hooks.contains(r"dev.islandwin.app\"));

        let wix_fragment = include_str!("../../installer/wix-autostart-cleanup.wxs");
        assert!(wix_fragment.contains(product_name));
        assert!(wix_fragment.contains(LEGACY_APP_NAME));
        assert!(wix_fragment.contains(r"Software\Microsoft\Windows\CurrentVersion\Run"));
        assert!(
            wix_fragment.contains(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
            )
        );
    }
}
