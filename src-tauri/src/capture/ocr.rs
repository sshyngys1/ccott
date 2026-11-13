use super::model::join_ocr_lines;
use std::time::{Duration, Instant};
use windows::{
    Globalization::Language,
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
    core::HSTRING,
};

struct Apartment;

impl Apartment {
    fn initialize() -> Result<Self, String> {
        // SAFETY: balanced apartment initialization on this blocking worker only.
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).map_err(|e| e.to_string())?;
        }
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: balances the successful RoInitialize above on the same thread.
        unsafe {
            RoUninitialize();
        }
    }
}

#[derive(serde::Serialize)]
pub struct OcrLanguage {
    tag: String,
    name: String,
}

fn available_languages() -> Result<Vec<OcrLanguage>, String> {
    OcrEngine::AvailableRecognizerLanguages()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|language| {
            Ok(OcrLanguage {
                tag: language
                    .LanguageTag()
                    .map_err(|e| e.to_string())?
                    .to_string(),
                name: language
                    .DisplayName()
                    .map_err(|e| e.to_string())?
                    .to_string(),
            })
        })
        .collect()
}

pub fn installed_languages() -> Result<Vec<OcrLanguage>, String> {
    let _apartment = Apartment::initialize()?;
    available_languages()
}

/// Keep engine selection independent of WinRT so every fallback can be tested.
fn select_engine<T>(
    requested: &str,
    available: impl FnOnce() -> Result<Vec<String>, String>,
    from_language: impl FnOnce(&str) -> Result<T, String>,
    from_profile: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if requested != "auto" {
        let explicit = available().and_then(|tags| {
            if tags.iter().any(|tag| tag.eq_ignore_ascii_case(requested)) {
                from_language(requested)
            } else {
                Err("language is not installed".into())
            }
        });
        match explicit {
            Ok(engine) => return Ok(engine),
            Err(error) => log::warn!(
                "OCR language {requested:?} unavailable: {error}; falling back to Windows profile languages"
            ),
        }
    }
    from_profile()
}

pub fn recognize(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    ocr_language: &str,
) -> Result<String, String> {
    let _apartment = Apartment::initialize()?;
    let engine = select_engine(
        ocr_language,
        || available_languages().map(|languages| languages.into_iter().map(|l| l.tag).collect()),
        |tag| {
            let language =
                Language::CreateLanguage(&HSTRING::from(tag)).map_err(|e| e.to_string())?;
            OcrEngine::TryCreateFromLanguage(&language).map_err(|e| e.to_string())
        },
        || OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| "ocr.missing".into()),
    )?;
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

#[cfg(test)]
mod tests {
    use super::select_engine;

    #[test]
    fn auto_uses_profile_without_querying_or_creating_a_language() {
        let engine = select_engine(
            "auto",
            || panic!("auto must not enumerate languages"),
            |_| panic!("auto must not create an explicit recognizer"),
            || Ok("profile"),
        );
        assert_eq!(engine, Ok("profile"));
    }

    #[test]
    fn installed_language_uses_explicit_recognizer() {
        let engine = select_engine(
            "en-US",
            || Ok(vec!["en-US".into(), "ru".into()]),
            |tag| {
                assert_eq!(tag, "en-US");
                Ok("explicit")
            },
            || panic!("available language must not fall back"),
        );
        assert_eq!(engine, Ok("explicit"));
    }

    #[test]
    fn missing_language_falls_back_without_creating_it() {
        let engine = select_engine(
            "ru",
            || Ok(vec!["en-US".into()]),
            |_| panic!("missing language must not be created"),
            || Ok("profile"),
        );
        assert_eq!(engine, Ok("profile"));
    }

    #[test]
    fn creation_or_enumeration_failure_falls_back() {
        for languages in [Ok(vec!["ru".into()]), Err("enumeration failed".into())] {
            assert_eq!(
                select_engine(
                    "ru",
                    || languages,
                    |_| Err("creation failed".into()),
                    || Ok("profile")
                ),
                Ok("profile")
            );
        }
    }

    #[test]
    fn missing_profile_engine_keeps_the_existing_error() {
        assert_eq!(
            select_engine::<()>(
                "ru",
                || Ok(vec![]),
                |_| unreachable!(),
                || Err("ocr.missing".into())
            ),
            Err("ocr.missing".into())
        );
    }
}
