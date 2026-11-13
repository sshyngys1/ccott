//! Switching the default output device through the undocumented `IPolicyConfig` COM interface.
//!
//! Windows has no public API for this; the interface below (IID `F8679F50-…`, class `870AF99C-…`) has
//! kept the same vtable since Windows Vista and is what Sound settings itself and tools such as
//! SoundSwitch/EarTrumpet use. Only `SetDefaultEndpoint` is called; every other slot exists solely to
//! keep the vtable layout right. Any failure is returned as an `Err` — nothing here can crash the app.

#![allow(non_snake_case, dead_code)] // COM method names mirror the Windows SDK

use std::ffi::c_void;

use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{ERole, eConsole, eMultimedia};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::core::{BOOL, GUID, HRESULT, PCWSTR};

// Slots we never call are declared with opaque pointers.
#[windows::core::interface("F8679F50-850A-41CF-9C72-430F290290C8")]
unsafe trait IPolicyConfig: windows::core::IUnknown {
    fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, device: PCWSTR, default: BOOL, format: *mut *mut c_void) -> HRESULT;
    fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
    fn SetDeviceFormat(
        &self,
        device: PCWSTR,
        endpoint_format: *mut c_void,
        mix_format: *mut c_void,
    ) -> HRESULT;
    fn GetProcessingPeriod(
        &self,
        device: PCWSTR,
        default: BOOL,
        default_period: *mut i64,
        min_period: *mut i64,
    ) -> HRESULT;
    fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
    fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(
        &self,
        device: PCWSTR,
        store: BOOL,
        key: *const PROPERTYKEY,
        value: *mut c_void,
    ) -> HRESULT;
    fn SetPropertyValue(
        &self,
        device: PCWSTR,
        store: BOOL,
        key: *const PROPERTYKEY,
        value: *mut c_void,
    ) -> HRESULT;
    fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, device: PCWSTR, visible: BOOL) -> HRESULT;
}

/// CLSID_PolicyConfigClient
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// Makes `id` the Console/Multimedia output; preserves the separate Communications device.
/// Must run on a COM-initialised thread.
pub fn set_default_endpoint(id: &str) -> Result<(), String> {
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: COM activation + calls with a valid NUL-terminated id that outlives the calls.
    unsafe {
        let policy: IPolicyConfig = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
            .map_err(|e| format!("IPolicyConfig is not available: {e}"))?;
        for role in [eConsole, eMultimedia] {
            policy
                .SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role)
                .ok()
                .map_err(|e| format!("SetDefaultEndpoint failed: {e}"))?;
        }
    }
    Ok(())
}
