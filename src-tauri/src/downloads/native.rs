//! Cancellable overlapped ReadDirectoryChangesW. All OS resources belong to the worker.
use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};

use windows::Win32::Foundation::{HANDLE, WAIT_TIMEOUT};
use windows::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED, FILE_NOTIFY_CHANGE_FILE_NAME,
    FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE, ReadDirectoryChangesW,
};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::IO::{
    CancelIoEx, GetOverlappedResult, GetOverlappedResultEx, OVERLAPPED,
};
use windows::Win32::UI::Shell::{FOLDERID_Downloads, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
use windows::core::HRESULT;

pub fn downloads_folder() -> Result<PathBuf, String> {
    // SAFETY: valid known-folder ID, no token; the returned allocation is freed below.
    let raw = unsafe { SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None) }
        .map_err(|e| e.to_string())?;
    // SAFETY: successful SHGetKnownFolderPath returns a NUL-terminated UTF-16 string.
    let value = unsafe { raw.to_string() }
        .map(PathBuf::from)
        .map_err(|e| e.to_string());
    // SAFETY: this pointer was allocated by SHGetKnownFolderPath using the COM allocator.
    unsafe { CoTaskMemFree(Some(raw.0.cast())) };
    value
}

pub struct Watcher {
    file: File,
    buffer: Box<[u32; 8192]>,
    overlapped: Box<OVERLAPPED>,
    pending: bool,
}

impl Watcher {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .access_mode(1) // FILE_LIST_DIRECTORY
            .share_mode(7) // read, write, delete: never prevent browser rename/cancel
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OVERLAPPED.0)
            .open(path)
            .map_err(|e| e.to_string())?;
        let mut watcher = Self {
            file,
            buffer: Box::new([0; 8192]),
            overlapped: Box::default(),
            pending: false,
        };
        watcher.arm()?;
        Ok(watcher)
    }

    fn handle(&self) -> HANDLE {
        HANDLE(self.file.as_raw_handle())
    }

    fn arm(&mut self) -> Result<(), String> {
        // SAFETY: directory is open for overlapped reads; both boxed, DWORD-aligned buffers
        // remain at fixed addresses until completion (including cancellation in Drop).
        unsafe {
            ReadDirectoryChangesW(
                self.handle(),
                self.buffer.as_mut_ptr().cast(),
                std::mem::size_of_val(self.buffer.as_ref()) as u32,
                false,
                FILE_NOTIFY_CHANGE_FILE_NAME
                    | FILE_NOTIFY_CHANGE_SIZE
                    | FILE_NOTIFY_CHANGE_LAST_WRITE,
                None,
                Some(self.overlapped.as_mut()),
                None,
            )
        }
        .map_err(|e| e.to_string())?;
        self.pending = true;
        Ok(())
    }

    /// None = timeout, Some(empty) = overflow (caller rescans at the next sample).
    pub fn next(&mut self) -> Result<Option<Vec<(u32, PathBuf)>>, String> {
        let mut transferred = 0;
        // SAFETY: the operation and its buffers are still alive; bounded wait, no APC callback.
        match unsafe {
            GetOverlappedResultEx(
                self.handle(),
                self.overlapped.as_ref(),
                &mut transferred,
                100,
                false,
            )
        } {
            Ok(()) => {}
            Err(e) if e.code() == HRESULT::from_win32(WAIT_TIMEOUT.0) => return Ok(None),
            Err(e) => return Err(e.to_string()),
        }
        self.pending = false;
        let bytes: Vec<_> = self
            .buffer
            .iter()
            .flat_map(|word| word.to_ne_bytes())
            .take(transferred as usize)
            .collect();
        let events = parse_notifications(&bytes);
        self.arm()?;
        Ok(Some(events))
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        if self.pending {
            let mut transferred = 0;
            // SAFETY: cancel only this worker's request; wait for completion before freeing
            // OVERLAPPED/buffer or closing the file. ERROR_OPERATION_ABORTED is expected.
            unsafe {
                let _ = CancelIoEx(self.handle(), Some(self.overlapped.as_ref()));
                let _ = GetOverlappedResult(
                    self.handle(),
                    self.overlapped.as_ref(),
                    &mut transferred,
                    true,
                );
            }
        }
    }
}

fn parse_notifications(bytes: &[u8]) -> Vec<(u32, PathBuf)> {
    let mut events = Vec::new();
    let mut offset = 0;
    while let Some(header) = bytes.get(offset..offset + 12) {
        let word = |i| u32::from_le_bytes(header[i..i + 4].try_into().unwrap());
        let next = word(0) as usize;
        let action = word(4);
        let length = word(8) as usize;
        let Some(name) = bytes.get(offset + 12..offset + 12 + length) else {
            break;
        };
        if !length.is_multiple_of(2) {
            break;
        }
        let wide: Vec<_> = name
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        events.push((action, PathBuf::from(String::from_utf16_lossy(&wide))));
        if next < 12 {
            break;
        }
        offset += next;
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_notifications_and_pending_read_cancel_in_temporary_directory() {
        // Never resolve FOLDERID_Downloads in tests.
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/downloads-tests");
        let folder = root.join(format!(
            "{}-{}",
            std::process::id(),
            crate::downloads::now_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let mut watcher = Watcher::open(&folder).unwrap();
        std::fs::write(folder.join("test.zip.part"), b"data").unwrap();
        std::fs::rename(folder.join("test.zip.part"), folder.join("test.zip")).unwrap();
        let mut events = Vec::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Some(batch) = watcher.next().unwrap() {
                events.extend(batch);
            }
            if events.contains(&(5, PathBuf::from("test.zip"))) {
                break;
            }
        }
        // next() rearmed the overlapped read. Drop must cancel and drain it before freeing buffers.
        drop(watcher);
        assert!(folder.starts_with(&root));
        std::fs::remove_dir_all(&folder).unwrap();
        assert!(events.contains(&(1, PathBuf::from("test.zip.part"))));
        assert!(events.contains(&(4, PathBuf::from("test.zip.part"))));
        assert!(events.contains(&(5, PathBuf::from("test.zip"))));
    }
    #[test]
    fn parses_rename_pair_without_pointer_casts() {
        let mut bytes = Vec::new();
        for (action, name, last) in [(4u32, "a.part", false), (5, "a", true)] {
            let wide: Vec<_> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let size = (12 + wide.len()).next_multiple_of(4);
            bytes.extend_from_slice(&(if last { 0 } else { size as u32 }).to_le_bytes());
            bytes.extend_from_slice(&action.to_le_bytes());
            bytes.extend_from_slice(&(wide.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&wide);
            bytes.resize(bytes.len().next_multiple_of(4), 0);
        }
        assert_eq!(
            parse_notifications(&bytes),
            vec![(4, "a.part".into()), (5, "a".into())]
        );
        assert!(parse_notifications(&[0; 3]).is_empty());
    }
}
