use super::model::*;
use windows::{
    Devices::Radios::{Radio, RadioAccessStatus, RadioKind as Kind, RadioState as Value},
    Win32::{
        Foundation::*,
        NetworkManagement::WiFi::*,
        System::{Registry::*, WinRT::*},
        UI::WindowsAndMessaging::*,
    },
    core::{PCWSTR, w},
};

// Bounded and cancellable: disabling the feature never waits for a hung WinRT driver.
macro_rules! wait {
    ($operation:expr, $cancelled:expr) => {{
        (|| {
            let op = $operation?;
            let started = std::time::Instant::now();
            loop {
                if ($cancelled)() || started.elapsed() >= std::time::Duration::from_secs(2) {
                    let _ = op.Cancel();
                    break Err(windows::core::Error::new(
                        windows::core::HRESULT(0x800704C7u32 as i32),
                        "Control operation cancelled or timed out",
                    ));
                }
                if op.Status()?.0 != 0 {
                    break op.GetResults();
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        })()
    }};
}
pub(super) use wait;

pub struct Apartment;
impl Apartment {
    pub fn new() -> windows::core::Result<Self> {
        // SAFETY: MTA is initialized and balanced on this worker thread only.
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: balances successful initialization on the same thread.
        unsafe {
            RoUninitialize();
        }
    }
}

pub fn query(cancelled: &dyn Fn() -> bool) -> ControlState {
    let (wifi, bluetooth) =
        radios(cancelled).unwrap_or((RadioValue::Unavailable, RadioValue::Unavailable));
    ControlState {
        wifi: RadioState {
            kind: RadioKind::Wifi,
            state: wifi,
        },
        bluetooth: RadioState {
            kind: RadioKind::Bluetooth,
            state: bluetooth,
        },
        wifi_info: wifi_info(),
        bt_devices: super::bluetooth::devices(cancelled).unwrap_or_default(),
        dark_mode: read_theme(HKEY_CURRENT_USER, THEME_PATH),
        power_mode: super::power::get(),
    }
}

fn radios(cancelled: &dyn Fn() -> bool) -> windows::core::Result<(RadioValue, RadioValue)> {
    let mut result = (RadioValue::Unavailable, RadioValue::Unavailable);
    // Enumeration is read-only. Request consent only in the explicit user toggle below.
    for radio in wait!(Radio::GetRadiosAsync(), cancelled)? {
        let target = match radio.Kind().ok() {
            Some(Kind::WiFi) => &mut result.0,
            Some(Kind::Bluetooth) => &mut result.1,
            _ => continue,
        };
        let state = match radio.State().ok() {
            Some(Value::On) => RadioValue::On,
            Some(Value::Off) => RadioValue::Off,
            _ => RadioValue::Unavailable,
        };
        *target = merge_radio(*target, state);
    }
    Ok(result)
}

// An active adapter wins; otherwise a usable Off adapter wins over a disabled one.
fn merge_radio(a: RadioValue, b: RadioValue) -> RadioValue {
    if a == RadioValue::On || b == RadioValue::On {
        RadioValue::On
    } else if a == RadioValue::Off || b == RadioValue::Off {
        RadioValue::Off
    } else {
        RadioValue::Unavailable
    }
}

fn apply_radios<T>(
    radios: impl IntoIterator<Item = T>,
    mut apply: impl FnMut(T) -> windows::core::Result<()>,
) -> windows::core::Result<()> {
    let mut success = false;
    let mut error =
        windows::core::Error::from_hresult(windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0));
    // Try every matching adapter. A disabled USB/virtual adapter cannot prevent the
    // usable adapter from switching; Off still needs to reach all usable adapters.
    for radio in radios {
        match apply(radio) {
            Ok(()) => success = true,
            Err(e) => error = e,
        }
    }
    if success { Ok(()) } else { Err(error) }
}

pub fn set_radio(kind: RadioKind, on: bool) -> Result<(), String> {
    let apply = || -> windows::core::Result<()> {
        if wait!(Radio::RequestAccessAsync(), || false)? != RadioAccessStatus::Allowed {
            return Err(windows::core::Error::new(
                E_ACCESSDENIED,
                "Windows or policy denied radio access",
            ));
        }
        let target = match kind {
            RadioKind::Wifi => Kind::WiFi,
            RadioKind::Bluetooth => Kind::Bluetooth,
        };
        let radios = wait!(Radio::GetRadiosAsync(), || false)?;
        apply_radios(
            radios
                .into_iter()
                .filter(|radio| radio.Kind().ok() == Some(target)),
            |radio| {
                let value = if on { Value::On } else { Value::Off };
                if wait!(radio.SetStateAsync(value), || false)? != RadioAccessStatus::Allowed
                    || radio.State()? == Value::Disabled
                {
                    return Err(windows::core::Error::new(
                        E_ACCESSDENIED,
                        "The radio driver or Windows policy refused the change",
                    ));
                }
                Ok(())
            },
        )
    };
    apply().map_err(|error| format!("Cannot change {kind:?}: {error}. Open Windows Settings to check the adapter and permissions."))
}

fn wifi_info() -> WifiInfo {
    // SAFETY: all Wlan buffers are owned by WlanApi, read only within returned sizes, freed exactly once;
    // the client handle stays valid until all queries and buffer reads have completed.
    unsafe {
        let mut handle = HANDLE::default();
        let mut version = 0;
        if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
            return WifiInfo::default();
        }
        let mut interfaces = std::ptr::null_mut();
        let mut info = WifiInfo::default();
        if WlanEnumInterfaces(handle, None, &mut interfaces) == 0 && !interfaces.is_null() {
            // The trailing array can contain zero entries: avoid borrowing the struct's
            // nominal one-entry array when WlanApi returned only the list header.
            let count = (*interfaces).dwNumberOfItems as usize;
            let first =
                std::ptr::addr_of!((*interfaces).InterfaceInfo).cast::<WLAN_INTERFACE_INFO>();
            let items = std::slice::from_raw_parts(first, count);
            for item in items {
                if item.isState != wlan_interface_state_connected {
                    continue;
                }
                // Newer Windows can hide SSID/signal behind location consent while enumeration
                // still reports a connected interface. Preserve that known connection state.
                info.connected = true;
                let mut data = std::ptr::null_mut();
                let mut size = 0;
                if WlanQueryInterface(
                    handle,
                    &item.InterfaceGuid,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut size,
                    &mut data,
                    None,
                ) == 0
                {
                    if !data.is_null()
                        && size as usize >= std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>()
                    {
                        let connection = &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>();
                        let attrs = &connection.wlanAssociationAttributes;
                        let ssid = &attrs.dot11Ssid;
                        let len = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
                        info = WifiInfo {
                            connected: true,
                            ssid: Some(String::from_utf8_lossy(&ssid.ucSSID[..len]).into_owned()),
                            signal: Some(attrs.wlanSignalQuality.min(100)),
                        };
                    }
                    if !data.is_null() {
                        WlanFreeMemory(data);
                    }
                }
                if info.connected {
                    break;
                }
            }
            WlanFreeMemory(interfaces.cast());
        }
        let _ = WlanCloseHandle(handle, None);
        info
    }
}

const THEME_PATH: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
pub(super) fn read_theme(root: HKEY, path: PCWSTR) -> bool {
    let mut light = 1u32;
    let mut size = 4;
    // SAFETY: valid DWORD buffer and NUL-terminated registry path/name; read-only access.
    let present = unsafe {
        RegGetValueW(
            root,
            path,
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut light as *mut u32).cast()),
            Some(&mut size),
        )
        .is_ok()
    };
    theme_is_dark(present.then_some(light))
}

fn theme_is_dark(light: Option<u32>) -> bool {
    light == Some(0)
}

pub fn set_dark(dark: bool) -> Result<(), String> {
    let mut key = HKEY::default();
    // SAFETY: existing HKCU key is opened with minimum access and closed on all paths below.
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            THEME_PATH,
            None,
            KEY_QUERY_VALUE | KEY_SET_VALUE,
            &mut key,
        )
        .ok()
    }
    .map_err(|e| format!("Cannot open Windows theme settings: {e}"))?;
    let value = u32::from(!dark).to_le_bytes();
    // SAFETY: the key is valid, buffers contain DWORD data, and the broadcast string remains live
    // throughout the synchronous, timeout-bounded SendMessageTimeout call.
    let result = unsafe {
        let first =
            RegSetValueExW(key, w!("AppsUseLightTheme"), None, REG_DWORD, Some(&value)).ok();
        let second = if first.is_ok() {
            RegSetValueExW(
                key,
                w!("SystemUsesLightTheme"),
                None,
                REG_DWORD,
                Some(&value),
            )
            .ok()
        } else {
            Ok(())
        };
        let _ = RegCloseKey(key);
        // Broadcast even after a partial write so Windows reflects the actual stored state.
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(w!("ImmersiveColorSet").as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            1000,
            None,
        );
        first.and(second)
    };
    result.map_err(|e| format!("Cannot change Windows theme: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::HSTRING;
    #[test]
    fn multiple_radios_merge_independently_of_order() {
        use RadioValue::*;
        for (a, b, expected) in [
            (On, Off, On),
            (Off, Unavailable, Off),
            (On, Unavailable, On),
            (Unavailable, Unavailable, Unavailable),
        ] {
            assert_eq!(merge_radio(a, b), expected);
            assert_eq!(merge_radio(b, a), expected);
        }
    }
    #[test]
    fn toggle_tries_all_adapters_despite_a_failure() {
        let mut seen = Vec::new();
        assert!(
            apply_radios([false, true, false, true], |ok| {
                seen.push(ok);
                if ok {
                    Ok(())
                } else {
                    Err(windows::core::Error::from_hresult(E_ACCESSDENIED))
                }
            })
            .is_ok()
        );
        assert_eq!(seen, [false, true, false, true]);
        assert!(
            apply_radios([false, false], |_| Err(windows::core::Error::from_hresult(
                E_ACCESSDENIED
            )))
            .is_err()
        );
        assert!(apply_radios([] as [bool; 0], |_| Ok(())).is_err());
    }
    #[test]
    fn missing_invalid_and_light_theme_are_not_dark() {
        assert!(theme_is_dark(Some(0)));
        assert!(!theme_is_dark(Some(1)));
        assert!(!theme_is_dark(Some(2)));
        assert!(!theme_is_dark(None));
    }
    #[test]
    fn theme_reads_only_a_temporary_hkcu_key() {
        let path = HSTRING::from(format!(
            "Software\\CCOTT-Control-Test-{}",
            std::process::id()
        ));
        let mut key = HKEY::default();
        // SAFETY: this isolated test key never touches the user's Personalize settings; it is removed below.
        unsafe {
            let created = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &path,
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                None,
                &mut key,
                None,
            );
            if created == ERROR_ACCESS_DENIED {
                eprintln!(
                    "SKIPPED temporary HKCU integration check: sandbox denied registry creation; pure theme parsing is tested separately"
                );
                return;
            }
            created.ok().unwrap();
            assert!(!read_theme(key, PCWSTR::null()));
            RegSetValueExW(
                key,
                w!("AppsUseLightTheme"),
                None,
                REG_DWORD,
                Some(&0u32.to_le_bytes()),
            )
            .ok()
            .unwrap();
            assert!(read_theme(key, PCWSTR::null()));
            RegSetValueExW(
                key,
                w!("AppsUseLightTheme"),
                None,
                REG_DWORD,
                Some(&1u32.to_le_bytes()),
            )
            .ok()
            .unwrap();
            assert!(!read_theme(key, PCWSTR::null()));
            RegCloseKey(key).ok().unwrap();
            RegDeleteKeyW(HKEY_CURRENT_USER, &path).ok().unwrap();
        }
    }
}
