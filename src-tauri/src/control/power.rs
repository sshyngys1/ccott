use super::model::PowerMode;
use windows::{
    Win32::{
        Foundation::{FreeLibrary, HMODULE},
        System::LibraryLoader::{GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW},
    },
    core::{GUID, s, w},
};

// These exports are absent on some Windows versions/hardware. Resolve at runtime so the app still starts.
struct Api {
    library: HMODULE,
    get: unsafe extern "system" fn(*mut GUID) -> u32,
    set: unsafe extern "system" fn(GUID) -> u32,
}
impl Api {
    fn load() -> Option<Self> {
        // SAFETY: loads the system DLL, resolves exact export ABIs, and retains it until function calls finish.
        unsafe {
            let library =
                LoadLibraryExW(w!("powrprof.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32).ok()?;
            let get = GetProcAddress(library, s!("PowerGetEffectiveOverlayScheme"));
            let set = GetProcAddress(library, s!("PowerSetActiveOverlayScheme"));
            match (get, set) {
                (Some(get), Some(set)) => Some(Self {
                    library,
                    get: std::mem::transmute::<
                        unsafe extern "system" fn() -> isize,
                        unsafe extern "system" fn(*mut GUID) -> u32,
                    >(get),
                    set: std::mem::transmute::<
                        unsafe extern "system" fn() -> isize,
                        unsafe extern "system" fn(GUID) -> u32,
                    >(set),
                }),
                _ => {
                    let _ = FreeLibrary(library);
                    None
                }
            }
        }
    }
}
impl Drop for Api {
    fn drop(&mut self) {
        // SAFETY: balances LoadLibrary after no function pointer can be used again.
        unsafe {
            let _ = FreeLibrary(self.library);
        }
    }
}
pub fn get() -> Option<PowerMode> {
    let api = Api::load()?;
    let mut guid = GUID::zeroed();
    // SAFETY: valid GUID output and live library with matching system ABI.
    if unsafe { (api.get)(&mut guid) } == 0 {
        PowerMode::from_guid(guid)
    } else {
        None
    }
}
pub fn set(mode: PowerMode) -> Result<(), String> {
    let api = Api::load().ok_or("Power mode is unavailable on this PC")?;
    // SAFETY: live library, matching system ABI, one of Windows' three supported overlay GUIDs.
    let code = unsafe { (api.set)(mode.guid()) };
    if code == 0 {
        Ok(())
    } else {
        Err(format!(
            "Windows refused the power mode change (error {code})"
        ))
    }
}
