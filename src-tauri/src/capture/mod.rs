pub(crate) mod desktop;
pub(crate) mod model;
mod ocr;
mod qr;
use image::{DynamicImage, ImageFormat, RgbaImage};
use model::{CaptureAction, CaptureMode, CaptureResult, PickedColor, file_name};
use std::{
    io::{Cursor, Write},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use windows::Win32::{
    Globalization::GetUserDefaultUILanguage,
    System::SystemInformation::GetLocalTime,
    UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetThreadDpiAwarenessContext},
};

static BUSY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn capture_ocr_languages() -> Result<Vec<ocr::OcrLanguage>, String> {
    tauri::async_runtime::spawn_blocking(ocr::installed_languages)
        .await
        .map_err(|e| e.to_string())?
}

struct Busy;
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
fn russian(app: &AppHandle) -> bool {
    use crate::settings::model::LanguageMode;
    match crate::settings::current(app).language {
        LanguageMode::Ru => true,
        LanguageMode::En => false,
        // SAFETY: a pointer-free query of the current user's display language.
        LanguageMode::Auto => (unsafe { GetUserDefaultUILanguage() } & 0x3ff) == 0x19,
    }
}
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join("Screenshots")
        .join("CCOTT");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn save(app: &AppHandle, png: &[u8]) -> Result<PathBuf, String> {
    // SAFETY: GetLocalTime returns the current local calendar time without caller pointers.
    let time = unsafe { GetLocalTime() };
    let name = file_name(
        time.wYear,
        time.wMonth,
        time.wDay,
        time.wHour,
        time.wMinute,
        time.wSecond,
    );
    let dir = folder(app)?;
    for suffix in 0..1000 {
        let path = dir.join(if suffix == 0 {
            name.clone()
        } else {
            format!("{} ({suffix}).png", name.trim_end_matches(".png"))
        });
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                if let Err(e) = f.write_all(png).and_then(|()| f.sync_all()) {
                    drop(f);
                    let _ = std::fs::remove_file(&path);
                    return Err(e.to_string());
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many screenshots with the same timestamp".into())
}
fn run(
    app: &AppHandle,
    mode: CaptureMode,
    action: CaptureAction,
    started: Instant,
) -> Result<Option<CaptureResult>, String> {
    let _hidden = crate::window::CaptureVisibility::hide(app)?;
    log::debug!(
        "capture island hidden in {} ms",
        started.elapsed().as_millis()
    );
    let snapshot = desktop::capture(mode == CaptureMode::Screen)?;
    log::debug!(
        "capture desktop frozen in {} ms",
        started.elapsed().as_millis()
    );
    let rect = if mode == CaptureMode::Region {
        let hint = if russian(app) {
            "Выделите область · Esc / правый клик — отмена"
        } else {
            "Drag to select · Esc / right-click to cancel"
        };
        match crate::window::capture_overlay::select(&snapshot, hint, started)? {
            Some(r) => r,
            None => return Ok(None),
        }
    } else {
        snapshot.bounds
    };
    let (width, height) = (rect.width() as u32, rect.height() as u32);
    let rgba = snapshot.crop(rect);
    drop(snapshot);
    if matches!(action, CaptureAction::Ocr | CaptureAction::Qr) {
        let text = if action == CaptureAction::Qr {
            qr::decode(width, height, rgba)
        } else {
            ocr::recognize(
                width,
                height,
                rgba,
                &crate::settings::current(app).ocr_language,
            )?
        };
        if !text.is_empty() {
            crate::clipboard::copy_ocr(text.clone())?;
        }
        return Ok(Some(CaptureResult {
            action,
            width,
            height,
            path: None,
            text: Some(text),
        }));
    }
    let image = RgbaImage::from_raw(width, height, rgba).ok_or("invalid capture size")?;
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let png = encoded.into_inner();
    let path = if action == CaptureAction::Save {
        Some(save(app, &png)?.to_string_lossy().into_owned())
    } else {
        None
    };
    crate::clipboard::copy_capture(png)?;
    Ok(Some(CaptureResult {
        action,
        width,
        height,
        path,
        text: None,
    }))
}
#[tauri::command]
pub async fn capture_start(
    app: AppHandle,
    mode: CaptureMode,
    action: CaptureAction,
) -> Result<Option<CaptureResult>, String> {
    on_capture_thread(app, move |app, started| run(app, mode, action, started)).await
}

#[tauri::command]
pub async fn capture_pick_color(app: AppHandle) -> Result<Option<PickedColor>, String> {
    on_capture_thread(app, |app, started| {
        let _hidden = crate::window::CaptureVisibility::hide(app)?;
        let snapshot = desktop::capture(false)?;
        let hint = if russian(app) {
            "Клик / Enter — выбрать · Стрелки — 1 px · Esc — отмена"
        } else {
            "Click / Enter to pick · Arrows: 1 px · Esc to cancel"
        };
        let point = crate::window::capture_overlay::pick_color(&snapshot, hint, started)?;
        let color = point.and_then(|point| snapshot.color_at(point));
        if let Some(color) = &color {
            crate::clipboard::copy_ocr(color.hex.clone())?;
        }
        Ok(color)
    })
    .await
}

async fn on_capture_thread<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppHandle, Instant) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let started = Instant::now();
    let ru = russian(&app);
    if BUSY.swap(true, Ordering::AcqRel) {
        return Err(if ru {
            "Захват уже выполняется"
        } else {
            "A capture is already in progress"
        }
        .into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = Busy;
        // SAFETY: DPI awareness is scoped to this blocking worker and restored before it is reused.
        let previous = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let result = work(&app, started);
        // SAFETY: restoring the context returned for this very thread above.
        unsafe { SetThreadDpiAwarenessContext(previous); }
        result.map_err(|error| {
            log::debug!("capture failed: {error}");
            if error == "ocr.missing" { if ru { "Нет языкового пакета OCR. Добавьте распознавание текста для языка в настройках Windows." } else { "No OCR language pack is available. Add text recognition for your language in Windows Settings." } }
            else { if ru { "Не удалось сделать снимок или распознать текст" } else { "Couldn’t capture the screen or recognize text" } }.to_string()
        })
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn capture_open_folder(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .open_path(folder(&app)?.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
