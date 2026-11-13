//! Wire types of the island window IPC. Mirror of `src/shared/types.ts` (window / shell section).

use serde::{Deserialize, Serialize};

/// Fixed size of the native island window, in CSS (logical) px. Mirrors `ISLAND_WINDOW`.
pub const ISLAND_WINDOW_WIDTH: f64 = 800.0;
pub const ISLAND_WINDOW_HEIGHT: f64 = 520.0;

/// Current visible island shape: rounded rectangle in CSS px relative to the window's top-left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandShape {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Corner radius in CSS px.
    pub radius: f64,
}

impl IslandShape {
    /// Default collapsed pill centered at the top of the window. Mirrors the design tokens
    /// `--ig-pill-width` 224, `--ig-pill-height` 36, `--ig-pill-top` 8, `--ig-radius-pill` 18.
    pub const DEFAULT_PILL: IslandShape = IslandShape {
        x: (ISLAND_WINDOW_WIDTH - 224.0) / 2.0,
        y: 8.0,
        width: 224.0,
        height: 36.0,
        radius: 18.0,
    };

    /// All fields finite and the size non-negative.
    pub fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height, self.radius]
            .iter()
            .all(|v| v.is_finite())
            && self.width >= 0.0
            && self.height >= 0.0
            && self.radius >= 0.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IslandMode {
    Collapsed,
    Expanded,
}

/// Payload of `island://focus-changed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPayload {
    pub active: bool,
}

/// Payload of `island://hover`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoverPayload {
    pub inside: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VibrancyMode {
    Acrylic,
    Mica,
    None,
}

/// Result of `window_set_vibrancy`: what was actually applied (may fall back to `none`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibrancyResult {
    pub requested: VibrancyMode,
    pub applied: VibrancyMode,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    /// Physical px.
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// A fullscreen app R1 has seen recently (for the allowlist UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenApp {
    /// Lower-case exe name, e.g. `"cs2.exe"`.
    pub exe: String,
    /// Last window title seen (may be `""`).
    pub title: String,
    /// Epoch ms.
    pub last_seen: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_matches_ts_contract() {
        let shape: IslandShape =
            serde_json::from_str(r#"{"x":1,"y":2,"width":3,"height":4,"radius":5}"#).unwrap();
        assert_eq!(shape.width, 3.0);
        assert_eq!(
            serde_json::to_string(&IslandMode::Expanded).unwrap(),
            "\"expanded\""
        );
        assert_eq!(
            serde_json::to_string(&VibrancyMode::Acrylic).unwrap(),
            "\"acrylic\""
        );
        assert_eq!(
            serde_json::to_string(&HoverPayload { inside: true }).unwrap(),
            r#"{"inside":true}"#
        );
        let r = VibrancyResult {
            requested: VibrancyMode::Mica,
            applied: VibrancyMode::None,
            error: Some("x".into()),
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"requested":"mica","applied":"none","error":"x"}"#
        );
        let m = MonitorInfo {
            id: "a".into(),
            name: "b".into(),
            width: 1,
            height: 2,
            scale_factor: 1.5,
            is_primary: true,
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"scaleFactor\":1.5"));
        assert!(json.contains("\"isPrimary\":true"));
        let fs = FullscreenApp {
            exe: "cs2.exe".into(),
            title: "Counter-Strike 2".into(),
            last_seen: 1700000000000,
        };
        assert_eq!(
            serde_json::to_string(&fs).unwrap(),
            r#"{"exe":"cs2.exe","title":"Counter-Strike 2","lastSeen":1700000000000}"#
        );
    }

    #[test]
    fn default_pill_is_centered() {
        let p = IslandShape::DEFAULT_PILL;
        assert_eq!(p.x * 2.0 + p.width, ISLAND_WINDOW_WIDTH);
        assert_eq!(
            (p.x, p.y, p.width, p.height, p.radius),
            (288.0, 8.0, 224.0, 36.0, 18.0)
        );
        assert!(p.is_valid());
    }

    #[test]
    fn invalid_shapes_rejected() {
        let mut p = IslandShape::DEFAULT_PILL;
        p.width = f64::NAN;
        assert!(!p.is_valid());
        p = IslandShape::DEFAULT_PILL;
        p.height = -1.0;
        assert!(!p.is_valid());
    }
}
