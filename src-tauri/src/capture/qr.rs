use image::{DynamicImage, RgbaImage, imageops::FilterType};

fn read(image: image::GrayImage) -> Option<String> {
    let mut image = rqrr::PreparedImage::prepare(image);
    image
        .detect_grids()
        .into_iter()
        .find_map(|grid| grid.decode().ok().map(|(_, text)| text))
}

/// Search the whole selection. Nearest-neighbour enlargement also handles tiny, crisp QR modules.
pub fn decode(width: u32, height: u32, pixels: Vec<u8>) -> String {
    let Some(image) = RgbaImage::from_raw(width, height, pixels) else {
        return String::new();
    };
    let gray = DynamicImage::ImageRgba8(image).into_luma8();
    if let Some(text) = read(gray.clone()) {
        return text;
    }
    if width.max(height) < 512 && width > 0 && height > 0 {
        return read(image::imageops::resize(
            &gray,
            width * 4,
            height * 4,
            FilterType::Nearest,
        ))
        .unwrap_or_default();
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_a_generated_qr_including_utf8_and_quiet_zone() {
        let text = "https://example.com/Привет?x=1";
        let qr = qrcode::QrCode::new(text.as_bytes()).unwrap();
        let colors = qr.to_colors();
        let modules = qr.width();
        let size = (modules + 8) * 5;
        let mut image =
            RgbaImage::from_pixel(size as u32, size as u32, image::Rgba([255, 255, 255, 255]));
        for y in 0..modules {
            for x in 0..modules {
                if colors[y * modules + x] == qrcode::Color::Dark {
                    for dy in 0..5 {
                        for dx in 0..5 {
                            image.put_pixel(
                                ((x + 4) * 5 + dx) as u32,
                                ((y + 4) * 5 + dy) as u32,
                                image::Rgba([0, 0, 0, 255]),
                            );
                        }
                    }
                }
            }
        }
        assert_eq!(decode(size as u32, size as u32, image.into_raw()), text);
    }
    #[test]
    fn blank_selection_has_no_qr() {
        assert_eq!(decode(32, 32, vec![255; 32 * 32 * 4]), "");
    }
}
