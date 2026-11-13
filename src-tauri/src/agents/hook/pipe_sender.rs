use windows::{
    Win32::{Foundation::*, Storage::FileSystem::*, System::Pipes::*},
    core::PCWSTR,
};

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: this type owns a valid handle and closes it once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
pub fn send(name: &str, bytes: &[u8]) {
    let _ = try_send(name, bytes);
}
pub(super) fn try_send(name: &str, bytes: &[u8]) -> windows::core::Result<()> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    // SAFETY: no WaitNamedPipe or retry; missing/busy pipes fail immediately. All I/O is nonblocking.
    unsafe {
        let handle = OwnedHandle(CreateFileW(
            PCWSTR(name.as_ptr()),
            GENERIC_WRITE.0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES::default(),
            None,
        )?);
        SetNamedPipeHandleState(handle.0, Some(&PIPE_NOWAIT), None, None)?;
        WriteFile(handle.0, Some(bytes), None, None)
    }
}
