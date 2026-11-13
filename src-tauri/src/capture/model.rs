//! Physical virtual-desktop geometry; no DPI-scaled window coordinates enter capture storage.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureMode {
    Region,
    Screen,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureAction {
    Copy,
    Save,
    Ocr,
    Qr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PickedColor {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}
impl PickedColor {
    pub fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self {
            hex: format!("#{r:02X}{g:02X}{b:02X}"),
            r,
            g,
            b,
        }
    }
}

/// Place the magnifier on the cursor's monitor, flipping at right/bottom edges.
pub fn magnifier_origin(cursor: (i32, i32), monitor: Rect, size: (i32, i32)) -> (i32, i32) {
    let x = if cursor.0 + 24 + size.0 > monitor.right {
        cursor.0 - 24 - size.0
    } else {
        cursor.0 + 24
    };
    let y = if cursor.1 + 24 + size.1 > monitor.bottom {
        cursor.1 - 24 - size.1
    } else {
        cursor.1 + 24
    };
    (
        x.clamp(monitor.left, (monitor.right - size.0).max(monitor.left)),
        y.clamp(monitor.top, (monitor.bottom - size.1).max(monitor.top)),
    )
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub action: CaptureAction,
    pub width: u32,
    pub height: u32,
    pub path: Option<String>,
    pub text: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
impl Rect {
    pub fn width(self) -> i32 {
        self.right - self.left
    }
    pub fn height(self) -> i32 {
        self.bottom - self.top
    }
    pub fn selection(a: (i32, i32), b: (i32, i32), bounds: Self) -> Option<Self> {
        let r = Self {
            left: a.0.min(b.0).max(bounds.left),
            top: a.1.min(b.1).max(bounds.top),
            right: a.0.max(b.0).min(bounds.right),
            bottom: a.1.max(b.1).min(bounds.bottom),
        };
        (r.width() > 0 && r.height() > 0).then_some(r)
    }
    pub fn contains(self, (x, y): (i32, i32)) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}
pub fn monitor_at(monitors: &[Rect], point: (i32, i32)) -> Option<Rect> {
    monitors.iter().copied().find(|r| r.contains(point))
}
/// Convert a logical offset on a particular monitor; never scale its physical desktop origin.
#[cfg(test)]
fn physical_point(origin: (i32, i32), offset: (f64, f64), scale: f64) -> (i32, i32) {
    (
        origin.0 + (offset.0 * scale).round() as i32,
        origin.1 + (offset.1 * scale).round() as i32,
    )
}
pub fn file_name(year: u16, month: u16, day: u16, hour: u16, minute: u16, second: u16) -> String {
    format!("CCOTT {year:04}-{month:02}-{day:02} {hour:02}-{minute:02}-{second:02}.png")
}
pub fn join_ocr_lines(lines: impl IntoIterator<Item = String>) -> String {
    lines
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hex_has_uppercase_two_digit_channels() {
        assert_eq!(PickedColor::rgb(0, 10, 255).hex, "#000AFF");
        let c = PickedColor::rgb(51, 102, 153);
        assert_eq!((c.hex.as_str(), c.r, c.g, c.b), ("#336699", 51, 102, 153));
    }
    #[test]
    fn magnifier_flips_and_stays_inside_its_monitor_including_negative_origins() {
        let monitor = Rect {
            left: -1920,
            top: -200,
            right: 0,
            bottom: 880,
        };
        for point in [(-1919, -199), (-1, 879), (-1919, 879), (-1, -199)] {
            let (x, y) = magnifier_origin(point, monitor, (132, 156));
            assert!(
                x >= monitor.left
                    && x + 132 <= monitor.right
                    && y >= monitor.top
                    && y + 156 <= monitor.bottom
            );
        }
        assert_eq!(
            magnifier_origin((-1, 879), monitor, (132, 156)),
            (-157, 699)
        );
    }
    #[test]
    fn monitor_selection_respects_physical_boundaries_in_mixed_dpi_layouts() {
        let left = Rect {
            left: -1920,
            top: -200,
            right: 0,
            bottom: 880,
        };
        let right = Rect {
            left: 0,
            top: 0,
            right: 2560,
            bottom: 1600,
        };
        assert_eq!(monitor_at(&[left, right], (-1, 10)), Some(left));
        assert_eq!(monitor_at(&[left, right], (0, 10)), Some(right));
        assert_eq!(monitor_at(&[left, right], (0, -1)), None);
    }
    #[test]
    fn file_names_are_local_time_and_windows_safe() {
        assert_eq!(
            file_name(2026, 1, 2, 3, 4, 5),
            "CCOTT 2026-01-02 03-04-05.png"
        );
    }
    #[test]
    fn ocr_preserves_line_breaks_and_unicode() {
        assert_eq!(
            join_ocr_lines(["Hello".into(), "".into(), "Привет мир".into()]),
            "Hello\nПривет мир"
        );
    }
    #[test]
    fn selection_handles_reverse_drag_negative_origins_and_clipping() {
        let bounds = Rect {
            left: -1920,
            top: -200,
            right: 2560,
            bottom: 1440,
        };
        assert_eq!(
            Rect::selection((20, 30), (-2000, -300), bounds),
            Some(Rect {
                left: -1920,
                top: -200,
                right: 20,
                bottom: 30
            })
        );
        assert!(Rect::selection((1, 1), (1, 5), bounds).is_none());
        assert_eq!(monitor_at(&[bounds], (-100, -100)), Some(bounds));
        assert_eq!(monitor_at(&[bounds], (2560, 20)), None);
    }
    #[test]
    fn mixed_dpi_offsets_keep_monitor_origins_physical() {
        assert_eq!(
            physical_point((-1920, -200), (100.0, 80.0), 1.5),
            (-1770, -80)
        );
        assert_eq!(physical_point((0, 0), (100.0, 80.0), 1.25), (125, 100));
    }
}
