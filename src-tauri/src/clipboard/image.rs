//! Clipboard image helpers: DIB <-> RGBA conversion, PNG encode/decode, thumbnails. Pure code.

use std::io::Cursor;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use image::codecs::jpeg::JpegEncoder;
use image::{
    DynamicImage, ImageFormat, ImageReader, Rgb, RgbImage, RgbaImage, imageops::FilterType,
};

/// Longest side of the list thumbnail (px).
pub const THUMB_MAX: u32 = 200;
/// Images with more pixels than this are ignored (guards memory).
pub const MAX_PIXELS: u64 = 64 * 1024 * 1024;

/// Classic CF_DIB: BITMAPINFOHEADER + bottom-up BGRA, compatible with older paste consumers.
pub fn rgba_to_dib(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let v5 = rgba_to_dibv5(width, height, rgba);
    let mut out = v5[..40].to_vec();
    out[..4].copy_from_slice(&40u32.to_le_bytes());
    out[16..20].copy_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&v5[124..]);
    out
}

const BI_RGB: u32 = 0;
const BI_BITFIELDS: u32 = 3;

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// Extracts one channel of `px` described by `mask`, scaled to 0..=255 (missing mask → 255).
fn channel(px: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 255;
    }
    let shift = mask.trailing_zeros();
    let v = (px & mask) >> shift;
    let bits = (mask >> shift).count_ones();
    if bits >= 8 {
        (v >> (bits - 8)) as u8
    } else {
        (v * 255 / ((1u32 << bits) - 1)) as u8
    }
}

/// Decoded image: width, height, RGBA8 pixels (top-down).
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Parses a packed DIB (`BITMAPINFOHEADER`/`V4`/`V5` + pixels, as in CF_DIB/CF_DIBV5).
/// Supports 24- and 32-bit uncompressed images; returns `None` for anything else.
pub fn dib_to_rgba(dib: &[u8]) -> Option<Rgba> {
    let hdr = u32_at(dib, 0)? as usize;
    if hdr < 40 || dib.len() < hdr {
        return None;
    }
    let w = i32_at(dib, 4)?;
    let h = i32_at(dib, 8)?;
    let bpp = u16_at(dib, 14)? as usize;
    let compression = u32_at(dib, 16)?;
    let clr_used = u32_at(dib, 32)? as usize;
    if w <= 0 || h == 0 || !(bpp == 24 || bpp == 32) {
        return None;
    }
    if compression != BI_RGB && compression != BI_BITFIELDS {
        return None;
    }
    let (w, top_down, h) = (w as u32, h < 0, h.unsigned_abs());
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return None;
    }

    // Channel masks (32-bit only; 24-bit is always BGR).
    let (mut rm, mut gm, mut bm, mut am) = (0x00FF_0000, 0x0000_FF00, 0x0000_00FF, 0xFF00_0000u32);
    let mut data_off = hdr + clr_used * 4;
    if bpp == 32 && compression == BI_BITFIELDS {
        rm = u32_at(dib, 40)?;
        gm = u32_at(dib, 44)?;
        bm = u32_at(dib, 48)?;
        am = if hdr >= 56 { u32_at(dib, 52)? } else { 0 };
        if hdr == 40 {
            data_off += 12; // masks follow a plain BITMAPINFOHEADER
        }
    }

    let stride = (w as usize * bpp).div_ceil(32) * 4;
    let need = data_off.checked_add(stride.checked_mul(h as usize)?)?;
    if dib.len() < need {
        return None;
    }

    let mut out = vec![0u8; w as usize * h as usize * 4];
    let mut any_alpha = false;
    for y in 0..h as usize {
        let src_y = if top_down { y } else { h as usize - 1 - y };
        let row = &dib[data_off + src_y * stride..][..stride];
        let dst = &mut out[y * w as usize * 4..][..w as usize * 4];
        for x in 0..w as usize {
            let d = &mut dst[x * 4..x * 4 + 4];
            if bpp == 24 {
                let p = &row[x * 3..x * 3 + 3];
                d.copy_from_slice(&[p[2], p[1], p[0], 255]);
            } else {
                let px = u32::from_le_bytes(row[x * 4..x * 4 + 4].try_into().ok()?);
                let a = channel(px, am);
                any_alpha |= a != 0;
                d.copy_from_slice(&[channel(px, rm), channel(px, gm), channel(px, bm), a]);
            }
        }
    }
    // Plain 32-bit screenshots carry zero alpha everywhere: treat them as opaque.
    if bpp == 32 && !any_alpha {
        out.as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|p| p[3] = 255);
    }
    Some(Rgba {
        width: w,
        height: h,
        pixels: out,
    })
}

/// Builds a packed `BITMAPV5HEADER` DIB (32-bit BGRA, bottom-up) for CF_DIBV5.
pub fn rgba_to_dibv5(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    const HDR: usize = 124;
    let row = width as usize * 4;
    let mut out = vec![0u8; HDR + row * height as usize];
    let mut put32 = |o: usize, v: u32| out[o..o + 4].copy_from_slice(&v.to_le_bytes());
    put32(0, HDR as u32);
    put32(4, width);
    put32(8, height); // positive = bottom-up
    put32(12, 1 | (32 << 16)); // planes (u16) + bit count (u16)
    put32(16, BI_BITFIELDS);
    put32(20, (row * height as usize) as u32);
    put32(40, 0x00FF_0000);
    put32(44, 0x0000_FF00);
    put32(48, 0x0000_00FF);
    put32(52, 0xFF00_0000);
    put32(56, 0x7352_4742); // LCS_sRGB
    put32(108, 4); // LCS_GM_IMAGES
    for y in 0..height as usize {
        let src = &rgba[y * row..][..row];
        let dst = &mut out[HDR + (height as usize - 1 - y) * row..][..row];
        for (s, d) in src
            .as_chunks::<4>()
            .0
            .iter()
            .zip(dst.as_chunks_mut::<4>().0.iter_mut())
        {
            d.copy_from_slice(&[s[2], s[1], s[0], s[3]]);
        }
    }
    out
}

pub fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Option<Vec<u8>> {
    let img = RgbaImage::from_raw(width, height, rgba)?;
    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, ImageFormat::Png)
        .ok()?;
    Some(buf.into_inner())
}

pub fn decode_png(png: &[u8]) -> Option<Rgba> {
    let dimensions = ImageReader::with_format(Cursor::new(png), ImageFormat::Png)
        .into_dimensions()
        .ok()?;
    if !allowed_dimensions(dimensions.0, dimensions.1) {
        return None;
    }
    let img = ImageReader::with_format(Cursor::new(png), ImageFormat::Png)
        .decode()
        .ok()?;
    let rgba = img.to_rgba8();
    Some(Rgba {
        width: rgba.width(),
        height: rgba.height(),
        pixels: rgba.into_raw(),
    })
}

fn allowed_dimensions(width: u32, height: u32) -> bool {
    width > 0 && height > 0 && u64::from(width) * u64::from(height) <= MAX_PIXELS
}

/// JPEG quality 80 thumbnail (longest side ≤ [`THUMB_MAX`]), alpha over neutral grey.
pub fn thumbnail_data_url(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    let img = RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let img = if width.max(height) > THUMB_MAX {
        let (w, h) = fit(width, height, THUMB_MAX);
        image::imageops::resize(&img, w, h, FilterType::Triangle)
    } else {
        img
    };
    let (w, h) = (img.width(), img.height());
    let rgb = RgbImage::from_fn(w, h, |x, y| {
        let p = img.get_pixel(x, y).0;
        let alpha = u32::from(p[3]);
        let blend =
            |channel: u8| ((u32::from(channel) * alpha + 128 * (255 - alpha) + 127) / 255) as u8;
        Rgb([blend(p[0]), blend(p[1]), blend(p[2])])
    });
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 80)
        .encode_image(&rgb)
        .ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)))
}

/// Scales `(w, h)` so that the longest side is `max` (never 0).
pub fn fit(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w >= h {
        (
            max,
            ((u64::from(h) * u64::from(max) / u64::from(w)) as u32).max(1),
        )
    } else {
        (
            ((u64::from(w) * u64::from(max) / u64::from(h)) as u32).max(1),
            max,
        )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn classic_dib_for_capture_roundtrips_pixels_and_dimensions() {
        let pixels = [
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ];
        let dib = super::rgba_to_dib(2, 2, &pixels);
        assert_eq!(&dib[..4], &40u32.to_le_bytes());
        let decoded = super::dib_to_rgba(&dib).unwrap();
        assert_eq!((decoded.width, decoded.height), (2, 2));
        assert_eq!(decoded.pixels, pixels);
    }
    use super::*;

    fn sample() -> Vec<u8> {
        // 2x2: red, green / blue, translucent white
        vec![
            255, 0, 0, 255, 0, 255, 0, 255, //
            0, 0, 255, 255, 255, 255, 255, 128,
        ]
    }

    #[test]
    fn dibv5_roundtrip() {
        let rgba = sample();
        let dib = rgba_to_dibv5(2, 2, &rgba);
        let back = dib_to_rgba(&dib).expect("parse");
        assert_eq!((back.width, back.height), (2, 2));
        assert_eq!(back.pixels, rgba);
    }

    #[test]
    fn plain_32bit_without_alpha_becomes_opaque() {
        // BITMAPINFOHEADER 40 bytes, 1x1, 32bpp BI_RGB, pixel B=1 G=2 R=3 A=0
        let mut dib = vec![0u8; 40];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        dib.extend_from_slice(&[1, 2, 3, 0]);
        let img = dib_to_rgba(&dib).unwrap();
        assert_eq!(img.pixels, vec![3, 2, 1, 255]);
    }

    #[test]
    fn bottom_up_24bit_with_row_padding() {
        // 1x2, 24bpp: stride = 4 bytes (3 + 1 pad). Bottom row first.
        let mut dib = vec![0u8; 40];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&2i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&24u16.to_le_bytes());
        dib.extend_from_slice(&[0, 0, 255, 0]); // bottom: red (BGR)
        dib.extend_from_slice(&[255, 0, 0, 0]); // top: blue
        let img = dib_to_rgba(&dib).unwrap();
        assert_eq!(img.pixels, vec![0, 0, 255, 255, 255, 0, 0, 255]);
    }

    #[test]
    fn rejects_garbage_and_unsupported() {
        assert!(dib_to_rgba(&[]).is_none());
        assert!(dib_to_rgba(&[0; 10]).is_none());
        let mut dib = vec![0u8; 40];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1000i32.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        assert!(dib_to_rgba(&dib).is_none(), "truncated pixel data");
        dib[14..16].copy_from_slice(&8u16.to_le_bytes());
        assert!(dib_to_rgba(&dib).is_none(), "palette images unsupported");
    }

    #[test]
    fn png_roundtrip_and_thumbnail() {
        let (w, h) = (400u32, 100u32);
        let rgba: Vec<u8> = (0..w * h)
            .flat_map(|i| [(i % 256) as u8, 10, 20, 255])
            .collect();
        let png = encode_png(w, h, rgba.clone()).unwrap();
        let back = decode_png(&png).unwrap();
        assert_eq!((back.width, back.height), (w, h));
        assert_eq!(back.pixels, rgba);

        let url = thumbnail_data_url(w, h, &rgba).unwrap();
        let b64 = url.strip_prefix("data:image/jpeg;base64,").unwrap();
        let bytes = STANDARD.decode(b64).unwrap();
        assert_eq!(image::guess_format(&bytes).unwrap(), ImageFormat::Jpeg);
        let thumb = image::load_from_memory(&bytes).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (200, 50));
    }

    #[test]
    fn transparent_thumbnail_is_jpeg_on_neutral_background() {
        let url = thumbnail_data_url(8, 8, &[255, 0, 0, 0].repeat(64)).unwrap();
        let bytes = STANDARD
            .decode(url.strip_prefix("data:image/jpeg;base64,").unwrap())
            .unwrap();
        let img = image::load_from_memory(&bytes).unwrap().to_rgb8();
        for channel in img.get_pixel(4, 4).0 {
            assert!((126..=130).contains(&channel));
        }
    }

    #[test]
    fn rejects_pixel_bombs_before_decoding() {
        assert!(allowed_dimensions(8192, 8192));
        assert!(!allowed_dimensions(8192, 8193));
        assert!(!allowed_dimensions(u32::MAX, u32::MAX));
        assert!(!allowed_dimensions(0, 1));
        let mut png = encode_png(1, 1, vec![0, 0, 0, 255]).unwrap();
        png[16..20].copy_from_slice(&8192u32.to_be_bytes());
        png[20..24].copy_from_slice(&8193u32.to_be_bytes());
        // Recompute IHDR's CRC so the dimensions are valid, without allocating a huge image.
        let mut crc = !0u32;
        for byte in &png[12..29] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xEDB8_8320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        png[29..33].copy_from_slice(&(!crc).to_be_bytes());
        assert_eq!(
            ImageReader::with_format(Cursor::new(&png), ImageFormat::Png)
                .into_dimensions()
                .unwrap(),
            (8192, 8193)
        );
        assert!(decode_png(&png).is_none());
    }

    #[test]
    fn fit_keeps_aspect() {
        assert_eq!(fit(400, 100, 200), (200, 50));
        assert_eq!(fit(100, 400, 200), (50, 200));
        assert_eq!(fit(1000, 1, 200), (200, 1));
    }
}
