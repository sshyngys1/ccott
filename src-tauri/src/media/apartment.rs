//! Balanced COM lifetime for each media thread. Declare before any WinRT locals.

use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};

pub struct Apartment;

impl Apartment {
    pub fn enter() -> windows::core::Result<Self> {
        // SAFETY: called once on a new dedicated media thread, before creating WinRT objects.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: balances this thread's successful CoInitializeEx; WinRT locals drop first.
        unsafe { CoUninitialize() };
    }
}
