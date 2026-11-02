use super::store::ShelfItem;
use std::os::windows::process::CommandExt;
use std::path::Path;
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};

struct Com(bool);
impl Com {
    fn new() -> Self {
        // SAFETY: initialization and teardown are balanced on this blocking worker.
        Self(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: this thread successfully initialized COM above.
            unsafe { CoUninitialize() };
        }
    }
}

pub fn describe(paths: Vec<String>) -> Result<Vec<ShelfItem>, String> {
    let _com = Com::new();
    paths
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            if path.contains('\0') || !p.is_absolute() {
                return Err("shelf.missing".into());
            }
            let meta = p.metadata().map_err(|_| "shelf.missing")?;
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let icon = crate::dock::shell_icon(&path).unwrap_or_default();
            Ok(ShelfItem {
                id: String::new(),
                name,
                kind: if meta.is_dir() { "folder" } else { "file" }.into(),
                size: meta.is_file().then_some(meta.len()),
                added_at: 0,
                missing: false,
                icon,
                path,
            })
        })
        .collect()
}

pub fn open(path: &str, reveal: bool) -> Result<(), String> {
    use windows::{
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        core::{PCWSTR, w},
    };
    if !Path::new(path).exists() {
        return Err("shelf.missing".into());
    }
    let _com = Com::new();
    if reveal {
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|_| "shelf.error")?;
        return Ok(());
    }
    let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    // SAFETY: NUL-terminated path remains alive for the synchronous shell call.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(path.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        Err("shelf.error".into())
    } else {
        Ok(())
    }
}
