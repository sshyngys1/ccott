use super::store::DockItem;
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::{io::Cursor, path::Path};
use windows::{
    Win32::{
        Foundation::SIZE,
        Graphics::Gdi::*,
        Storage::FileSystem::*,
        System::Com::*,
        UI::{Shell::*, WindowsAndMessaging::SW_SHOWNORMAL},
    },
    core::{Interface, PCWSTR, w},
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn shell_path(path: &str) -> String {
    if let Some(path) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{path}")
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(path).to_string()
    }
}
struct Com(bool);
impl Com {
    fn new() -> Self {
        // SAFETY: COM initialization is balanced on this worker thread; existing apartments are left intact.
        Self(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: this instance successfully initialized COM on the current thread.
            unsafe { CoUninitialize() };
        }
    }
}

fn description(path: &str) -> Option<String> {
    let path = wide(&shell_path(path));
    // SAFETY: all resource pointers refer to the owned, live version buffer; lengths are checked before reading.
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), None);
        if size == 0 || size > 8 * 1024 * 1024 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(path.as_ptr()), None, size, data.as_mut_ptr().cast()).ok()?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0;
        if !VerQueryValueW(
            data.as_ptr().cast(),
            w!("\\VarFileInfo\\Translation"),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            || len < 4
            || ptr.is_null()
        {
            return None;
        }
        let lang = std::ptr::read_unaligned(ptr.cast::<u16>());
        let page = std::ptr::read_unaligned(ptr.cast::<u16>().add(1));
        let query = wide(&format!(
            "\\StringFileInfo\\{lang:04x}{page:04x}\\FileDescription"
        ));
        if !VerQueryValueW(
            data.as_ptr().cast(),
            PCWSTR(query.as_ptr()),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            || len == 0
            || ptr.is_null()
        {
            return None;
        }
        let text =
            String::from_utf16_lossy(std::slice::from_raw_parts(ptr.cast::<u16>(), len as usize))
                .trim_end_matches('\0')
                .trim()
                .to_string();
        (!text.is_empty()).then_some(text)
    }
}
fn icon(path: &str) -> Result<String, windows::core::Error> {
    let path = wide(&shell_path(path));
    // SAFETY: COM is initialized on this worker. Shell returns an owned bitmap, which is deleted after extraction.
    let pixels = unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None)?;
        let bitmap = factory.GetImage(
            SIZE { cx: 64, cy: 64 },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        )?;
        let mut info = BITMAP::default();
        GetObjectW(
            bitmap.into(),
            size_of::<BITMAP>() as i32,
            Some((&mut info as *mut BITMAP).cast()),
        );
        let (width, height) = (info.bmWidth, info.bmHeight.abs());
        let result = if width > 0 && height > 0 && width <= 512 && height <= 512 {
            let dc = CreateCompatibleDC(None);
            let mut pixels = vec![0u8; width as usize * height as usize * 4];
            let mut dib = crate::capture::desktop::bitmap_info(width, height);
            let rows = GetDIBits(
                dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut dib,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(dc);
            (rows == height).then_some((width as u32, height as u32, pixels))
        } else {
            None
        };
        let _ = DeleteObject(bitmap.into());
        result
    };
    let Some((width, height, mut pixels)) = pixels else {
        return Ok(String::new());
    };
    let has_alpha = pixels.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
    for p in pixels.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        } else if p[3] > 0 {
            for c in 0..3 {
                p[c] = ((p[c] as u32 * 255 / p[3] as u32).min(255)) as u8;
            }
        }
    }
    let Some(image) = RgbaImage::from_raw(width, height, pixels) else {
        return Ok(String::new());
    };
    let image =
        DynamicImage::ImageRgba8(image).resize_exact(64, 64, image::imageops::FilterType::Lanczos3);
    let mut png = Cursor::new(Vec::new());
    if image.write_to(&mut png, ImageFormat::Png).is_err() {
        return Ok(String::new());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    ))
}
pub fn describe(paths: Vec<String>) -> Result<Vec<DockItem>, String> {
    let _com = Com::new();
    let mut items = Vec::new();
    for path in paths {
        if path.contains('\0') || !Path::new(&path).is_absolute() {
            return Err("dock.notFound".into());
        }
        let canonical = std::fs::canonicalize(&path).map_err(|_| "dock.notFound")?;
        let path = shell_path(&canonical.to_string_lossy());
        let p = Path::new(&path);
        let folder = p.is_dir();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let fallback = if folder { p.file_name() } else { p.file_stem() }
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| path.clone());
        let name = if ext == "exe" {
            description(&path).unwrap_or(fallback)
        } else {
            fallback
        };
        let icon = icon(&path).unwrap_or_else(|error| {
            log::debug!("dock icon extraction failed: {error}");
            String::new()
        });
        items.push(DockItem {
            id: String::new(),
            path,
            name,
            kind: if folder {
                "folder"
            } else if matches!(ext.as_str(), "exe" | "lnk" | "url") {
                "app"
            } else {
                "file"
            }
            .into(),
            icon,
        });
    }
    Ok(items)
}
fn working_directory(path: &str) -> String {
    let p = Path::new(path);
    if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
        // SAFETY: COM interfaces remain on this initialized worker; the path and destination buffers stay live.
        let result = unsafe {
            (|| -> windows::core::Result<String> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let persist: IPersistFile = link.cast()?;
                let path = wide(path);
                persist.Load(PCWSTR(path.as_ptr()), STGM_READ)?;
                let mut buffer = vec![0u16; 32768];
                link.GetWorkingDirectory(&mut buffer)?;
                Ok(String::from_utf16_lossy(
                    &buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())],
                ))
            })()
        };
        if let Ok(dir) = result
            && !dir.is_empty()
        {
            return dir;
        }
    }
    p.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}
pub fn open(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("dock.notFound".into());
    }
    let _com = Com::new();
    let directory = wide(&working_directory(path));
    let path = wide(&shell_path(path));
    // SAFETY: all strings are NUL-terminated and live through this synchronous ShellExecute call.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(path.as_ptr()),
            PCWSTR::null(),
            PCWSTR(directory.as_ptr()),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        Err("dock.open".into())
    } else {
        Ok(())
    }
}
