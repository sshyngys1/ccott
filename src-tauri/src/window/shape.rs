//! Pure geometry: rounded-rectangle hit-test, coordinate conversion, window-region rectangle.

use super::types::IslandShape;

/// Hysteresis (CSS px): once the cursor is inside, it must move this far outside to leave.
pub const HOVER_HYSTERESIS: f64 = 1.5;

/// Cursor position in screen physical px -> CSS px relative to the window's top-left.
pub fn screen_to_window_css(
    cursor: (i32, i32),
    window_origin: (i32, i32),
    scale: f64,
) -> (f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    (
        f64::from(cursor.0 - window_origin.0) / scale,
        f64::from(cursor.1 - window_origin.1) / scale,
    )
}

/// Hit-test of a rounded rectangle.
///
/// `margin` inflates (positive) or deflates (negative) the shape on every side, keeping the corners
/// concentric. The corner radius is clamped to half of the smaller side, so `radius > height / 2`
/// yields a capsule. Edges are inclusive.
pub fn rounded_rect_contains(shape: &IslandShape, px: f64, py: f64, margin: f64) -> bool {
    let x0 = shape.x - margin;
    let y0 = shape.y - margin;
    let w = shape.width + 2.0 * margin;
    let h = shape.height + 2.0 * margin;
    if w <= 0.0 || h <= 0.0 {
        return false;
    }
    let x1 = x0 + w;
    let y1 = y0 + h;
    if px < x0 || px > x1 || py < y0 || py > y1 {
        return false;
    }
    let r = (shape.radius + margin).clamp(0.0, w.min(h) / 2.0);
    // Distance from the point to the closest point of the "core" rectangle (shape shrunk by r);
    // inside iff that distance is within the corner radius.
    let cx = px.clamp(x0 + r, x1 - r);
    let cy = py.clamp(y0 + r, y1 - r);
    let (dx, dy) = (px - cx, py - cy);
    dx * dx + dy * dy <= r * r
}

/// Hit-test with hysteresis: leaving requires `HOVER_HYSTERESIS` px outside the shape.
pub fn hover_inside(shape: &IslandShape, px: f64, py: f64, was_inside: bool) -> bool {
    rounded_rect_contains(
        shape,
        px,
        py,
        if was_inside { HOVER_HYSTERESIS } else { 0.0 },
    )
}

/// Rounded rectangle in physical px, ready for `CreateRoundRectRgn`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RegionRect {
    pub left: i32,
    pub top: i32,
    /// Exclusive right edge.
    pub right: i32,
    /// Exclusive bottom edge.
    pub bottom: i32,
    /// Corner ellipse diameter.
    pub ellipse: i32,
}

/// Convert a CSS-px shape to a physical-px region rectangle for a window of the given scale,
/// clipped to the window bounds (`window_px` = physical width/height). `None` for an empty shape.
pub fn region_rect(shape: &IslandShape, scale: f64, window_px: (i32, i32)) -> Option<RegionRect> {
    let left = ((shape.x * scale).round() as i32).clamp(0, window_px.0);
    let top = ((shape.y * scale).round() as i32).clamp(0, window_px.1);
    let right = (((shape.x + shape.width) * scale).round() as i32).clamp(0, window_px.0);
    let bottom = (((shape.y + shape.height) * scale).round() as i32).clamp(0, window_px.1);
    if right <= left || bottom <= top {
        return None;
    }
    let radius =
        (shape.radius * scale).clamp(0.0, f64::from((right - left).min(bottom - top)) / 2.0);
    Some(RegionRect {
        left,
        top,
        right,
        bottom,
        ellipse: (radius * 2.0).round() as i32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PILL: IslandShape = IslandShape::DEFAULT_PILL; // x=288 y=8 w=224 h=36 r=18

    #[test]
    fn center_and_edges_are_inside() {
        assert!(rounded_rect_contains(&PILL, 400.0, 26.0, 0.0));
        assert!(rounded_rect_contains(&PILL, 400.0, 8.0, 0.0));
        assert!(rounded_rect_contains(&PILL, 400.0, 44.0, 0.0));
        assert!(rounded_rect_contains(&PILL, 288.0, 26.0, 0.0));
        assert!(rounded_rect_contains(&PILL, 512.0, 26.0, 0.0));
    }

    #[test]
    fn outside_is_outside() {
        assert!(!rounded_rect_contains(&PILL, 400.0, 7.9, 0.0));
        assert!(!rounded_rect_contains(&PILL, 400.0, 44.1, 0.0));
        assert!(!rounded_rect_contains(&PILL, 287.9, 26.0, 0.0));
        assert!(!rounded_rect_contains(&PILL, 512.1, 26.0, 0.0));
        assert!(!rounded_rect_contains(&PILL, 0.0, 0.0, 0.0));
    }

    #[test]
    fn corners_are_cut_off() {
        // Bounding-box corners of a capsule are outside.
        assert!(!rounded_rect_contains(&PILL, 288.0, 8.0, 0.0));
        assert!(!rounded_rect_contains(&PILL, 512.0, 8.0, 0.0));
        assert!(!rounded_rect_contains(&PILL, 288.0, 44.0, 0.0));
        assert!(!rounded_rect_contains(&PILL, 512.0, 44.0, 0.0));
        // Arc check: left circle center (306, 26), radius 18, 45 degrees.
        let d = 18.0 / 2f64.sqrt();
        assert!(rounded_rect_contains(
            &PILL,
            306.0 - d + 0.01,
            26.0 - d + 0.01,
            0.0
        ));
        assert!(!rounded_rect_contains(
            &PILL,
            306.0 - d - 0.05,
            26.0 - d - 0.05,
            0.0
        ));
    }

    #[test]
    fn square_corners_when_radius_is_zero() {
        let s = IslandShape {
            x: 10.0,
            y: 10.0,
            width: 100.0,
            height: 50.0,
            radius: 0.0,
        };
        assert!(rounded_rect_contains(&s, 10.0, 10.0, 0.0));
        assert!(rounded_rect_contains(&s, 110.0, 60.0, 0.0));
        assert!(!rounded_rect_contains(&s, 9.9, 10.0, 0.0));
    }

    #[test]
    fn radius_larger_than_half_height_is_clamped() {
        let s = IslandShape {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
            radius: 500.0,
        };
        // Capsule: same as radius 20.
        assert!(rounded_rect_contains(&s, 50.0, 20.0, 0.0));
        assert!(rounded_rect_contains(&s, 0.5, 20.0, 0.0));
        assert!(!rounded_rect_contains(&s, 1.0, 1.0, 0.0));
        assert!(!rounded_rect_contains(&s, 99.0, 1.0, 0.0));
        let tiny = IslandShape {
            x: 0.0,
            y: 0.0,
            width: 2.0,
            height: 2.0,
            radius: 100.0,
        };
        assert!(rounded_rect_contains(&tiny, 1.0, 1.0, 0.0));
    }

    #[test]
    fn empty_or_degenerate_shapes_never_hit() {
        let s = IslandShape {
            x: 5.0,
            y: 5.0,
            width: 0.0,
            height: 10.0,
            radius: 3.0,
        };
        assert!(!rounded_rect_contains(&s, 5.0, 8.0, -0.1));
        let z = IslandShape {
            x: 5.0,
            y: 5.0,
            width: 10.0,
            height: 10.0,
            radius: 0.0,
        };
        assert!(!rounded_rect_contains(&z, 10.0, 10.0, -5.0));
        assert!(!rounded_rect_contains(&z, 10.0, 10.0, -6.0));
    }

    #[test]
    fn margin_inflates_and_deflates_concentrically() {
        assert!(rounded_rect_contains(&PILL, 287.0, 26.0, 2.0));
        assert!(!rounded_rect_contains(&PILL, 285.9, 26.0, 2.0));
        // The inflated bounding-box corner stays cut off.
        assert!(!rounded_rect_contains(&PILL, 286.0, 6.0, 2.0));
        assert!(!rounded_rect_contains(&PILL, 289.0, 26.0, -2.0));
        assert!(rounded_rect_contains(&PILL, 291.0, 26.0, -2.0));
    }

    #[test]
    fn hysteresis_prevents_flicker_on_border() {
        // 1 px above the top edge: not inside when entering, still inside when leaving.
        assert!(!hover_inside(&PILL, 400.0, 7.0, false));
        assert!(hover_inside(&PILL, 400.0, 7.0, true));
        // Far enough outside: leaves.
        assert!(!hover_inside(&PILL, 400.0, 5.0, true));
    }

    #[test]
    fn cursor_conversion_applies_origin_and_scale() {
        assert_eq!(
            screen_to_window_css((1000, 50), (560, 0), 1.0),
            (440.0, 50.0)
        );
        assert_eq!(
            screen_to_window_css((1000, 60), (400, 0), 1.5),
            (400.0, 40.0)
        );
        assert_eq!(
            screen_to_window_css((100, 100), (0, 0), 0.0),
            (100.0, 100.0)
        );
        // Cursor left of / above the window gives negative coordinates (never inside).
        assert_eq!(screen_to_window_css((0, -10), (100, 0), 2.0), (-50.0, -5.0));
    }

    #[test]
    fn region_rect_scales_and_clips() {
        let r = region_rect(&PILL, 1.0, (800, 520)).unwrap();
        assert_eq!(
            (r.left, r.top, r.right, r.bottom, r.ellipse),
            (288, 8, 512, 44, 36)
        );
        let r = region_rect(&PILL, 1.5, (1200, 780)).unwrap();
        assert_eq!(
            (r.left, r.top, r.right, r.bottom, r.ellipse),
            (432, 12, 768, 66, 54)
        );
        let big = IslandShape {
            x: -10.0,
            y: -10.0,
            width: 2000.0,
            height: 2000.0,
            radius: 40.0,
        };
        let r = region_rect(&big, 1.0, (800, 520)).unwrap();
        assert_eq!((r.left, r.top, r.right, r.bottom), (0, 0, 800, 520));
        let e = IslandShape {
            x: 10.0,
            y: 10.0,
            width: 0.0,
            height: 5.0,
            radius: 0.0,
        };
        assert!(region_rect(&e, 1.0, (800, 520)).is_none());
        let c = IslandShape {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
            radius: 999.0,
        };
        assert_eq!(region_rect(&c, 1.0, (800, 520)).unwrap().ellipse, 40);
    }
}
