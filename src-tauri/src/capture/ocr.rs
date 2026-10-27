use super::model::join_ocr_lines;
use std::time::{Duration, Instant};
use windows::{
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
};

pub fn recognize(width: u32, height: u32, rgba: Vec<u8>) -> Result<String, String> {
    // SAFETY: balanced apartment initialization on this blocking worker only.
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED).map_err(|e| e.to_string())?;
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            // SAFETY: balances the successful RoInitialize above on the same thread.
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| "ocr.missing")?;
    let maximum = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())?;
    let image = image::RgbaImage::from_raw(width, height, rgba).ok_or("invalid OCR image")?;
    let image = if width.max(height) > maximum {
        image::DynamicImage::ImageRgba8(image)
            .resize(maximum, maximum, image::imageops::FilterType::Lanczos3)
            .to_rgba8()
    } else {
        image
    };
    let (w, h) = image.dimensions();
    let mut pixels = image.into_raw();
    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&pixels).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    let bitmap =
        SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
            .map_err(|e| e.to_string())?;
    let operation = engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?;
    let start = Instant::now();
    while operation.Status().map_err(|e| e.to_string())?.0 == 0 {
        if start.elapsed() >= Duration::from_secs(10) {
            let _ = operation.Cancel();
            return Err("OCR timeout".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let result = operation.GetResults().map_err(|e| e.to_string())?;
    let lines = result.Lines().map_err(|e| e.to_string())?;
    let mut text = Vec::new();
    for line in lines {
        text.push(line.Text().map_err(|e| e.to_string())?.to_string());
    }
    Ok(join_ocr_lines(text))
}
