//! Artwork: raw thumbnail bytes (JPEG/PNG from SMTC) → downscaled `data:` URL.

use std::io::Cursor;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

/// Longest side of the artwork sent to the UI (px).
pub const MAX_SIDE: u32 = 256;
/// Thumbnails bigger than this (bytes) are ignored.
pub const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;

/// Cache misses as well as hits: apps without artwork must not reopen the thumbnail on every tick.
#[derive(Default)]
pub struct Cache {
    key: Option<String>,
    hash: String,
    url: Option<String>,
}

impl Cache {
    pub fn matches(&self, key: &str) -> bool {
        self.key.as_deref() == Some(key)
    }

    pub fn resolve(
        &mut self,
        key: &str,
        force: bool,
        read: impl FnOnce() -> Option<Vec<u8>>,
    ) -> Option<String> {
        let same = self.matches(key);
        if same && !force {
            return self.url.clone();
        }
        let raw = read();
        let hash = raw
            .as_deref()
            .map(crate::db::content_hash)
            .unwrap_or_default();
        if !same || self.hash != hash {
            self.url = raw.as_deref().and_then(to_data_url);
        }
        self.key = Some(key.to_string());
        self.hash = hash;
        self.url.clone()
    }
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

/// Decodes `bytes`, downscales to ≤ [`MAX_SIDE`] and returns a PNG (with alpha) or JPEG data URL.
pub fn to_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > MAX_INPUT_BYTES {
        return None;
    }
    let format = image::guess_format(bytes).ok()?;
    let img = image::load_from_memory(bytes).ok()?;
    let small = img.width().max(img.height()) <= MAX_SIDE;
    // Small PNG/JPEG already: pass through without re-encoding.
    if small {
        match format {
            ImageFormat::Png => return Some(data_url("image/png", bytes)),
            ImageFormat::Jpeg => return Some(data_url("image/jpeg", bytes)),
            _ => {}
        }
    }
    let img = if small {
        img
    } else {
        img.resize(MAX_SIDE, MAX_SIDE, FilterType::Triangle)
    };
    let mut buf = Cursor::new(Vec::new());
    if img.color().has_alpha() {
        DynamicImage::ImageRgba8(img.to_rgba8())
            .write_to(&mut buf, ImageFormat::Png)
            .ok()?;
        Some(data_url("image/png", &buf.into_inner()))
    } else {
        let rgb = img.to_rgb8();
        JpegEncoder::new_with_quality(&mut buf, 85)
            .encode_image(&rgb)
            .ok()?;
        Some(data_url("image/jpeg", &buf.into_inner()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_artwork_is_cached_until_track_change_or_explicit_recheck() {
        let mut cache = Cache::default();
        assert!(cache.resolve("track 1", false, || None).is_none());
        assert!(
            cache
                .resolve("track 1", false, || panic!(
                    "negative cache must avoid reading"
                ))
                .is_none()
        );
        let image = encode(DynamicImage::new_rgb8(8, 8), ImageFormat::Png);
        assert!(cache.resolve("track 1", true, || Some(image)).is_some());
        assert!(
            cache
                .resolve("track 1", false, || panic!(
                    "positive cache must avoid reading"
                ))
                .is_some()
        );
        assert!(cache.resolve("track 2", false, || None).is_none());
    }

    fn encode(img: DynamicImage, fmt: ImageFormat) -> Vec<u8> {
        let mut c = Cursor::new(Vec::new());
        img.write_to(&mut c, fmt).unwrap();
        c.into_inner()
    }

    fn decode_url(url: &str) -> (String, DynamicImage) {
        let (head, b64) = url.split_once(";base64,").unwrap();
        let bytes = STANDARD.decode(b64).unwrap();
        (
            head.trim_start_matches("data:").to_string(),
            image::load_from_memory(&bytes).unwrap(),
        )
    }

    #[test]
    fn large_jpeg_is_downscaled_to_jpeg() {
        let src = DynamicImage::new_rgb8(640, 480);
        let url = to_data_url(&encode(src, ImageFormat::Jpeg)).unwrap();
        let (mime, img) = decode_url(&url);
        assert_eq!(mime, "image/jpeg");
        assert_eq!((img.width(), img.height()), (256, 192));
    }

    #[test]
    fn large_png_with_alpha_stays_png() {
        let src = DynamicImage::new_rgba8(512, 512);
        let url = to_data_url(&encode(src, ImageFormat::Png)).unwrap();
        let (mime, img) = decode_url(&url);
        assert_eq!(mime, "image/png");
        assert_eq!((img.width(), img.height()), (256, 256));
    }

    #[test]
    fn small_images_pass_through_and_garbage_fails() {
        let bytes = encode(DynamicImage::new_rgb8(64, 64), ImageFormat::Png);
        let url = to_data_url(&bytes).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(url, data_url("image/png", &bytes));
        assert!(to_data_url(b"not an image").is_none());
        assert!(to_data_url(&[]).is_none());
    }
}
