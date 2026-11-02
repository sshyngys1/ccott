//! The `Settings` value, tolerant merging of JSON into it and clamping (pure, unit-tested).
//! Mirror of `Settings` in `src/shared/types.ts`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::hotkeys::{DEFAULT_COMMAND_HOTKEY, DEFAULT_SUMMON_HOTKEY, parse_hotkey};
use crate::window::VibrancyMode;

/// Upper bound of both hover delays, in milliseconds.
pub const MAX_DELAY_MS: u32 = 2000;
pub const SHELF_RETENTION_HOURS: &[u32] = &[1, 24, 72, 168, 0];
fn default_shelf_retention() -> u32 {
    24
}
/// `Settings::monitor` value meaning "the primary monitor".
pub const MONITOR_PRIMARY: &str = "primary";
/// Default list of applications (`Settings::auto_hide_apps`) over which the pill auto-hides
/// when maximized or touching the top of the monitor work area.
/// Number of cells in the quick-tiles grid (2 columns × 4 rows).
pub const QUICK_TILE_CELLS: usize = 8;
/// Maximum length of a tile identifier.
pub const MAX_TILE_ID_LEN: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TileSize {
    #[serde(rename = "1x1")]
    OneByOne,
    #[serde(rename = "2x1")]
    TwoByOne,
}

impl TileSize {
    pub fn cells(self) -> usize {
        match self {
            Self::OneByOne => 1,
            Self::TwoByOne => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileSlot {
    pub id: String,
    pub size: TileSize,
}

pub fn default_quick_tiles() -> Vec<TileSlot> {
    vec![
        TileSlot {
            id: "region".to_string(),
            size: TileSize::OneByOne,
        },
        TileSlot {
            id: "screen".to_string(),
            size: TileSize::OneByOne,
        },
        TileSlot {
            id: "ocr".to_string(),
            size: TileSize::OneByOne,
        },
        TileSlot {
            id: "qr".to_string(),
            size: TileSize::OneByOne,
        },
        TileSlot {
            id: "color".to_string(),
            size: TileSize::TwoByOne,
        },
    ]
}

pub const DEFAULT_AUTO_HIDE_APPS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "browser.exe",
    "opera.exe",
    "brave.exe",
    "vivaldi.exe",
];

pub fn default_auto_hide_apps() -> Vec<String> {
    DEFAULT_AUTO_HIDE_APPS
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

fn default_ocr_language() -> String {
    "auto".to_string()
}

fn default_downloads_monitor() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    #[default]
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageMode {
    #[default]
    Auto,
    Ru,
    En,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_ocr_language")]
    pub ocr_language: String,
    #[serde(default)]
    pub language: LanguageMode,
    pub theme: ThemeMode,
    pub vibrancy: VibrancyMode,
    #[serde(default)]
    pub lite_mode: bool,
    #[serde(default = "default_downloads_monitor")]
    pub downloads_monitor: bool,
    #[serde(default)]
    pub shelf_keep_after_drag: bool,
    #[serde(default = "default_shelf_retention")]
    pub shelf_retention_hours: u32,
    /// `MonitorInfo.id` or `"primary"`.
    pub monitor: String,
    pub autostart: bool,
    pub do_not_disturb: bool,
    pub hover_expand_delay_ms: u32,
    pub hover_collapse_delay_ms: u32,
    pub hide_in_fullscreen: bool,
    pub summon_hotkey: String,
    #[serde(default = "default_command_hotkey")]
    pub command_hotkey: String,
    pub fullscreen_allowlist: Vec<String>,
    #[serde(default = "default_auto_hide_apps")]
    pub auto_hide_apps: Vec<String>,
    #[serde(default = "default_quick_tiles")]
    pub quick_tiles: Vec<TileSlot>,
}

fn default_command_hotkey() -> String {
    DEFAULT_COMMAND_HOTKEY.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ocr_language: default_ocr_language(),
            language: LanguageMode::Auto,
            theme: ThemeMode::Auto,
            vibrancy: VibrancyMode::None,
            lite_mode: false,
            downloads_monitor: true,
            shelf_keep_after_drag: false,
            shelf_retention_hours: default_shelf_retention(),
            monitor: MONITOR_PRIMARY.to_string(),
            autostart: false,
            do_not_disturb: false,
            hover_expand_delay_ms: 120,
            hover_collapse_delay_ms: 350,
            hide_in_fullscreen: true,
            summon_hotkey: DEFAULT_SUMMON_HOTKEY.to_string(),
            command_hotkey: default_command_hotkey(),
            fullscreen_allowlist: Vec::new(),
            auto_hide_apps: default_auto_hide_apps(),
            quick_tiles: default_quick_tiles(),
        }
    }
}

/// Reads `key` from `map` into `target`; an invalid value is reported and `target` is kept.
fn take<T: DeserializeOwned>(
    map: &Map<String, Value>,
    key: &str,
    target: &mut T,
    rejected: &mut Vec<String>,
) {
    if let Some(v) = map.get(key) {
        match serde_json::from_value::<T>(v.clone()) {
            Ok(x) => *target = x,
            Err(_) => rejected.push(key.to_string()),
        }
    }
}

/// A delay: any finite number, rounded and clamped to `0..=MAX_DELAY_MS`.
fn take_delay(map: &Map<String, Value>, key: &str, target: &mut u32, rejected: &mut Vec<String>) {
    if let Some(v) = map.get(key) {
        match v.as_f64().filter(|n| n.is_finite()) {
            Some(n) => *target = n.round().clamp(0.0, f64::from(MAX_DELAY_MS)) as u32,
            None => rejected.push(key.to_string()),
        }
    }
}

/// A global shortcut: `""` (disabled) or a valid accelerator with at least one modifier.
fn take_quick_tiles(
    map: &Map<String, Value>,
    key: &str,
    target: &mut Vec<TileSlot>,
    rejected: &mut Vec<String>,
) {
    let Some(v) = map.get(key) else {
        return;
    };
    let Some(arr) = v.as_array() else {
        rejected.push(key.to_string());
        return;
    };
    let mut parsed = Vec::with_capacity(arr.len());
    let mut seen = std::collections::HashSet::new();
    let mut total_cells = 0;
    for item in arr {
        let Ok(slot) = serde_json::from_value::<TileSlot>(item.clone()) else {
            rejected.push(key.to_string());
            return;
        };
        if slot.id.is_empty() || slot.id.chars().count() > MAX_TILE_ID_LEN {
            rejected.push(key.to_string());
            return;
        }
        if !seen.insert(slot.id.clone()) {
            rejected.push(key.to_string());
            return;
        }
        total_cells += slot.size.cells();
        if total_cells > QUICK_TILE_CELLS {
            rejected.push(key.to_string());
            return;
        }
        parsed.push(slot);
    }
    *target = parsed;
}

fn take_hotkey(
    map: &Map<String, Value>,
    key: &str,
    target: &mut String,
    rejected: &mut Vec<String>,
) {
    if let Some(v) = map.get(key) {
        match v.as_str().and_then(|s| parse_hotkey(s).ok()) {
            Some(parsed) => *target = parsed.canonical,
            None => rejected.push(key.to_string()),
        }
    }
}

/// Normalizes an allowlist of executable names: trimmed, lower-case, non-empty, deduplicated.
pub fn normalize_allowlist(items: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let normalized = item.trim().to_lowercase();
        if !normalized.is_empty() && !out.contains(&normalized) {
            out.push(normalized);
        }
    }
    out
}

impl Settings {
    /// Brings every field into its valid range.
    pub fn clamp(&mut self) {
        if !SHELF_RETENTION_HOURS.contains(&self.shelf_retention_hours) {
            self.shelf_retention_hours = default_shelf_retention();
        }
        self.hover_expand_delay_ms = self.hover_expand_delay_ms.min(MAX_DELAY_MS);
        self.hover_collapse_delay_ms = self.hover_collapse_delay_ms.min(MAX_DELAY_MS);
        let monitor = self.monitor.trim();
        self.monitor = if monitor.is_empty() {
            MONITOR_PRIMARY.to_string()
        } else {
            monitor.to_string()
        };
        self.summon_hotkey = match parse_hotkey(&self.summon_hotkey) {
            Ok(parsed) => parsed.canonical,
            Err(_) => DEFAULT_SUMMON_HOTKEY.to_string(),
        };
        self.command_hotkey = parse_hotkey(&self.command_hotkey)
            .map(|p| p.canonical)
            .unwrap_or_else(|_| default_command_hotkey());
        let allowlist = std::mem::take(&mut self.fullscreen_allowlist);
        self.fullscreen_allowlist = normalize_allowlist(allowlist);
        let auto_hide = std::mem::take(&mut self.auto_hide_apps);
        self.auto_hide_apps = normalize_allowlist(auto_hide);
        let mut seen = std::collections::HashSet::new();
        let mut total_cells = 0;
        self.quick_tiles.retain(|tile| {
            if tile.id.is_empty() || tile.id.chars().count() > MAX_TILE_ID_LEN {
                return false;
            }
            if !seen.insert(tile.id.clone()) {
                return false;
            }
            let cells = tile.size.cells();
            if total_cells + cells > QUICK_TILE_CELLS {
                return false;
            }
            total_cells += cells;
            true
        });
    }

    /// Merges the known fields of the JSON object `value` into `self` (unknown fields are
    /// ignored, delays are clamped). Fields that are present but invalid are left unchanged and
    /// returned by name. A non-object `value` changes nothing and is reported as `"<root>"`.
    pub fn merge_json(&mut self, value: &Value) -> Vec<String> {
        let Some(map) = value.as_object() else {
            return vec!["<root>".to_string()];
        };
        let mut rejected = Vec::new();
        take(
            map,
            "shelfKeepAfterDrag",
            &mut self.shelf_keep_after_drag,
            &mut rejected,
        );
        if let Some(value) = map.get("shelfRetentionHours") {
            match value
                .as_u64()
                .and_then(|v| u32::try_from(v).ok())
                .filter(|v| SHELF_RETENTION_HOURS.contains(v))
            {
                Some(hours) => self.shelf_retention_hours = hours,
                None => rejected.push("shelfRetentionHours".into()),
            }
        }
        take(map, "language", &mut self.language, &mut rejected);
        take(map, "ocrLanguage", &mut self.ocr_language, &mut rejected);
        take(map, "theme", &mut self.theme, &mut rejected);
        take(map, "vibrancy", &mut self.vibrancy, &mut rejected);
        take(map, "liteMode", &mut self.lite_mode, &mut rejected);
        take(
            map,
            "downloadsMonitor",
            &mut self.downloads_monitor,
            &mut rejected,
        );
        take(map, "monitor", &mut self.monitor, &mut rejected);
        take(map, "autostart", &mut self.autostart, &mut rejected);
        take(map, "doNotDisturb", &mut self.do_not_disturb, &mut rejected);
        take_delay(
            map,
            "hoverExpandDelayMs",
            &mut self.hover_expand_delay_ms,
            &mut rejected,
        );
        take_delay(
            map,
            "hoverCollapseDelayMs",
            &mut self.hover_collapse_delay_ms,
            &mut rejected,
        );
        take(
            map,
            "hideInFullscreen",
            &mut self.hide_in_fullscreen,
            &mut rejected,
        );
        take_hotkey(map, "summonHotkey", &mut self.summon_hotkey, &mut rejected);
        take_hotkey(
            map,
            "commandHotkey",
            &mut self.command_hotkey,
            &mut rejected,
        );
        take(
            map,
            "fullscreenAllowlist",
            &mut self.fullscreen_allowlist,
            &mut rejected,
        );
        take(map, "autoHideApps", &mut self.auto_hide_apps, &mut rejected);
        take_quick_tiles(map, "quickTiles", &mut self.quick_tiles, &mut rejected);
        self.clamp();
        rejected
    }

    /// Defaults overlaid with the valid known fields of `value` (the tolerant load).
    pub fn from_json_lossy(value: &Value) -> Self {
        let mut s = Self::default();
        let rejected = s.merge_json(value);
        if !rejected.is_empty() {
            log::warn!("settings: ignoring invalid fields {rejected:?}");
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shelf_defaults_old_settings_and_retention_validation() {
        let mut settings = Settings::default();
        assert!(!settings.shelf_keep_after_drag);
        assert_eq!(settings.shelf_retention_hours, 24);
        let mut old = serde_json::to_value(&settings).unwrap();
        old.as_object_mut().unwrap().remove("shelfKeepAfterDrag");
        old.as_object_mut().unwrap().remove("shelfRetentionHours");
        assert_eq!(
            serde_json::from_value::<Settings>(old.clone()).unwrap(),
            settings
        );
        assert_eq!(Settings::from_json_lossy(&old), settings);
        for hours in SHELF_RETENTION_HOURS {
            assert!(
                settings
                    .merge_json(&json!({"shelfRetentionHours": hours}))
                    .is_empty()
            );
            assert_eq!(settings.shelf_retention_hours, *hours);
        }
        for value in [
            json!(-1),
            json!(2),
            json!(1.5),
            json!("24"),
            json!(null),
            json!(4_294_967_296u64),
        ] {
            assert_eq!(
                settings.merge_json(&json!({"shelfRetentionHours": value})),
                vec!["shelfRetentionHours"]
            );
            assert_eq!(settings.shelf_retention_hours, 0);
        }
        assert!(
            settings
                .merge_json(&json!({"shelfKeepAfterDrag": true}))
                .is_empty()
        );
        assert!(settings.shelf_keep_after_drag);
        assert_eq!(
            settings.merge_json(&json!({"shelfKeepAfterDrag": "true"})),
            vec!["shelfKeepAfterDrag"]
        );
    }

    #[test]
    fn command_hotkey_default_validation_disable_and_old_settings() {
        let mut settings = Settings::default();
        assert_eq!(settings.command_hotkey, "Ctrl+Alt+Space");
        for invalid in [
            serde_json::json!(12),
            serde_json::json!("Space"),
            serde_json::json!("Ctrl+"),
            serde_json::json!("Ctrl+A+B"),
        ] {
            assert_eq!(
                settings.merge_json(&serde_json::json!({"commandHotkey": invalid})),
                ["commandHotkey"]
            );
            assert_eq!(settings.command_hotkey, "Ctrl+Alt+Space");
        }
        assert!(
            settings
                .merge_json(&serde_json::json!({"commandHotkey": "shift+ctrl+keyk"}))
                .is_empty()
        );
        assert_eq!(settings.command_hotkey, "Ctrl+Shift+K");
        assert!(
            settings
                .merge_json(&serde_json::json!({"commandHotkey": ""}))
                .is_empty()
        );
        assert_eq!(settings.command_hotkey, "");
        let mut old = serde_json::to_value(Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("commandHotkey");
        assert_eq!(
            serde_json::from_value::<Settings>(old)
                .unwrap()
                .command_hotkey,
            "Ctrl+Alt+Space"
        );
    }
    use serde_json::json;

    #[test]
    fn downloads_monitor_defaults_validates_and_round_trips() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("downloadsMonitor");
        assert!(
            serde_json::from_value::<Settings>(value.clone())
                .unwrap()
                .downloads_monitor
        );
        let mut settings = Settings::from_json_lossy(&value);
        assert!(settings.downloads_monitor);
        assert!(
            settings
                .merge_json(&json!({"downloadsMonitor": false}))
                .is_empty()
        );
        assert!(!settings.downloads_monitor);
        assert_eq!(
            settings.merge_json(&json!({"downloadsMonitor": "true"})),
            vec!["downloadsMonitor"]
        );
        assert!(!settings.downloads_monitor);
        assert!(
            !serde_json::from_value::<Settings>(serde_json::to_value(settings).unwrap())
                .unwrap()
                .downloads_monitor
        );
    }

    #[test]
    fn defaults_match_the_contract() {
        let d = Settings::default();
        assert_eq!(d.ocr_language, "auto");
        assert_eq!(d.theme, ThemeMode::Auto);
        assert_eq!(d.vibrancy, VibrancyMode::None);
        assert!(!d.lite_mode);
        assert_eq!(d.monitor, "primary");
        assert!(!d.autostart && !d.do_not_disturb);
        assert_eq!(
            (d.hover_expand_delay_ms, d.hover_collapse_delay_ms),
            (120, 350)
        );
        assert!(d.hide_in_fullscreen);
        assert_eq!(d.summon_hotkey, "Ctrl+Alt+I");
        assert!(d.fullscreen_allowlist.is_empty());
        assert_eq!(d.auto_hide_apps, default_auto_hide_apps());
        assert_eq!(d.quick_tiles, default_quick_tiles());
    }

    #[test]
    fn serializes_to_camel_case() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(
            v,
            json!({
                "language": "auto",
                "ocrLanguage": "auto",
                "theme": "auto", "vibrancy": "none", "monitor": "primary",
                "liteMode": false,
                "downloadsMonitor": true,
                "shelfKeepAfterDrag": false,
                "shelfRetentionHours": 24,
                "autostart": false, "doNotDisturb": false,
                "hoverExpandDelayMs": 120, "hoverCollapseDelayMs": 350,
                "hideInFullscreen": true,
                "summonHotkey": "Ctrl+Alt+I",
                "commandHotkey": "Ctrl+Alt+Space",
                "fullscreenAllowlist": [],
                "autoHideApps": [
                    "chrome.exe",
                    "msedge.exe",
                    "firefox.exe",
                    "browser.exe",
                    "opera.exe",
                    "brave.exe",
                    "vivaldi.exe"
                ],
                "quickTiles": [
                    { "id": "region", "size": "1x1" },
                    { "id": "screen", "size": "1x1" },
                    { "id": "ocr", "size": "1x1" },
                    { "id": "qr", "size": "1x1" },
                    { "id": "color", "size": "2x1" }
                ]
            })
        );
    }

    #[test]
    fn lite_mode_defaults_for_old_files_and_round_trips() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("liteMode");
        assert!(
            !serde_json::from_value::<Settings>(value.clone())
                .unwrap()
                .lite_mode
        );
        assert!(!Settings::from_json_lossy(&value).lite_mode);

        let mut settings = Settings::default();
        for enabled in [true, false] {
            assert!(
                settings
                    .merge_json(&json!({"liteMode": enabled}))
                    .is_empty()
            );
            assert_eq!(settings.lite_mode, enabled);
            let saved = serde_json::to_value(&settings).unwrap();
            assert_eq!(saved["liteMode"], enabled);
            assert_eq!(serde_json::from_value::<Settings>(saved).unwrap(), settings);
        }
    }

    #[test]
    fn lite_mode_rejects_non_booleans_without_changing_the_value() {
        for invalid in [
            json!(null),
            json!(0),
            json!(1),
            json!("true"),
            json!([]),
            json!({}),
        ] {
            let mut settings = Settings {
                lite_mode: true,
                ..Settings::default()
            };
            assert_eq!(
                settings.merge_json(&json!({"liteMode": invalid})),
                vec!["liteMode"]
            );
            assert!(settings.lite_mode);
        }
    }

    #[test]
    fn merge_applies_known_fields_and_ignores_unknown() {
        let mut s = Settings::default();
        let rejected = s.merge_json(&json!({
            "theme": "dark", "monitor": "\\\\.\\DISPLAY2@1920,0", "doNotDisturb": true,
            "hideInFullscreen": false, "summonHotkey": "Ctrl+Shift+K",
            "fullscreenAllowlist": ["CS2.exe", " chrome.exe ", "cs2.exe", ""],
            "somethingNew": 42
        }));
        assert!(rejected.is_empty());
        assert_eq!(s.theme, ThemeMode::Dark);
        assert_eq!(s.monitor, "\\\\.\\DISPLAY2@1920,0");
        assert!(s.do_not_disturb && !s.hide_in_fullscreen);
        assert_eq!(s.summon_hotkey, "Ctrl+Shift+K");
        assert_eq!(s.fullscreen_allowlist, vec!["cs2.exe", "chrome.exe"]);
        // Untouched fields keep their value.
        assert_eq!(s.hover_expand_delay_ms, 120);
    }

    #[test]
    fn ocr_language_defaults_in_serde_and_accepts_saved_tags() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("ocrLanguage");
        assert_eq!(
            serde_json::from_value::<Settings>(value)
                .unwrap()
                .ocr_language,
            "auto"
        );
        assert_eq!(Settings::from_json_lossy(&json!({})).ocr_language, "auto");
        let mut settings = Settings::default();
        assert!(
            settings
                .merge_json(&json!({"ocrLanguage": "en-US"}))
                .is_empty()
        );
        assert_eq!(settings.ocr_language, "en-US");
        let saved = serde_json::to_value(&settings).unwrap();
        assert_eq!(saved["ocrLanguage"], "en-US");
        assert_eq!(serde_json::from_value::<Settings>(saved).unwrap(), settings);
        assert_eq!(
            settings.merge_json(&json!({"ocrLanguage": 42})),
            vec!["ocrLanguage"]
        );
        assert_eq!(settings.ocr_language, "en-US");
    }

    #[test]
    fn old_settings_json_without_v01_fields_loads_defaults() {
        let s = Settings::from_json_lossy(&json!({
            "theme": "dark", "vibrancy": "none", "monitor": "primary",
            "autostart": true, "doNotDisturb": false,
            "hoverExpandDelayMs": 100, "hoverCollapseDelayMs": 300,
            "hideInFullscreen": true
        }));
        assert_eq!(s.theme, ThemeMode::Dark);
        assert!(s.autostart);
        assert_eq!(s.summon_hotkey, "Ctrl+Alt+I");
        assert!(s.fullscreen_allowlist.is_empty());
        assert_eq!(s.auto_hide_apps, default_auto_hide_apps());
        assert_eq!(s.language, LanguageMode::Auto);
        assert_eq!(s.quick_tiles, default_quick_tiles());
    }

    #[test]
    fn auto_hide_apps_defaults_in_serde_normalizes_and_merges() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("autoHideApps");
        assert_eq!(
            serde_json::from_value::<Settings>(value)
                .unwrap()
                .auto_hide_apps,
            default_auto_hide_apps()
        );

        let mut settings = Settings::default();
        assert!(
            settings
                .merge_json(&json!({
                    "autoHideApps": [" Chrome.EXE ", "Obsidian.exe", "chrome.exe", ""]
                }))
                .is_empty()
        );
        assert_eq!(settings.auto_hide_apps, vec!["chrome.exe", "obsidian.exe"]);

        assert_eq!(
            settings.merge_json(&json!({ "autoHideApps": "not-an-array" })),
            vec!["autoHideApps"]
        );
        assert_eq!(settings.auto_hide_apps, vec!["chrome.exe", "obsidian.exe"]);

        assert!(
            settings
                .merge_json(&json!({ "autoHideApps": [] }))
                .is_empty()
        );
        assert!(settings.auto_hide_apps.is_empty());
    }

    #[test]
    fn language_defaults_in_serde_and_merges_without_losing_old_settings() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("language");
        assert_eq!(
            serde_json::from_value::<Settings>(value).unwrap().language,
            LanguageMode::Auto
        );
        let mut settings = Settings::default();
        assert!(settings.merge_json(&json!({"language":"en"})).is_empty());
        assert_eq!(settings.language, LanguageMode::En);
        assert_eq!(
            settings.merge_json(&json!({"language":"de"})),
            vec!["language"]
        );
        assert_eq!(settings.language, LanguageMode::En);
    }

    #[test]
    fn invalid_fields_are_reported_and_keep_the_old_value() {
        let mut s = Settings::default();
        let mut rejected = s.merge_json(&json!({
            "theme": "purple", "vibrancy": 3, "autostart": "yes", "hoverExpandDelayMs": "fast",
            "hoverCollapseDelayMs": null, "monitor": 5, "doNotDisturb": true,
            "summonHotkey": "Space", "fullscreenAllowlist": "not-an-array"
        }));
        rejected.sort();
        assert_eq!(
            rejected,
            [
                "autostart",
                "fullscreenAllowlist",
                "hoverCollapseDelayMs",
                "hoverExpandDelayMs",
                "monitor",
                "summonHotkey",
                "theme",
                "vibrancy"
            ]
        );
        assert_eq!(
            s,
            Settings {
                do_not_disturb: true,
                ..Settings::default()
            }
        );
    }

    #[test]
    fn delays_are_rounded_and_clamped() {
        let mut s = Settings::default();
        s.merge_json(&json!({ "hoverExpandDelayMs": -50, "hoverCollapseDelayMs": 99999 }));
        assert_eq!(
            (s.hover_expand_delay_ms, s.hover_collapse_delay_ms),
            (0, 2000)
        );
        s.merge_json(&json!({ "hoverExpandDelayMs": 120.6, "hoverCollapseDelayMs": 2000 }));
        assert_eq!(
            (s.hover_expand_delay_ms, s.hover_collapse_delay_ms),
            (121, 2000)
        );
    }

    #[test]
    fn blank_monitor_falls_back_to_primary() {
        let mut s = Settings::default();
        s.merge_json(&json!({ "monitor": "   " }));
        assert_eq!(s.monitor, "primary");
        s.merge_json(&json!({ "monitor": "  DISPLAY1@0,0 " }));
        assert_eq!(s.monitor, "DISPLAY1@0,0");
    }

    #[test]
    fn empty_hotkey_disables_summon() {
        let mut s = Settings::default();
        assert!(s.merge_json(&json!({ "summonHotkey": "" })).is_empty());
        assert_eq!(s.summon_hotkey, "");
    }

    #[test]
    fn non_object_changes_nothing() {
        let mut s = Settings::default();
        assert_eq!(s.merge_json(&json!([1, 2])), ["<root>"]);
        assert_eq!(s.merge_json(&Value::Null), ["<root>"]);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn lossy_load_keeps_valid_fields_next_to_broken_ones() {
        let s = Settings::from_json_lossy(&json!({
            "theme": "light",
            "vibrancy": "glitter",
            "summonHotkey": "NotAHotkey"
        }));
        assert_eq!(s.theme, ThemeMode::Light);
        assert_eq!(s.vibrancy, VibrancyMode::None);
        assert_eq!(s.summon_hotkey, "Ctrl+Alt+I");
    }

    #[test]
    fn quick_tiles_accepts_new_ids_and_seven_or_eight_cells() {
        let mut settings = Settings::default();
        for last_size in ["1x1", "2x1"] {
            let tiles = json!([
                { "id": "screenshots", "size": "2x1" },
                { "id": "clipboard", "size": "2x1" },
                { "id": "note", "size": "2x1" },
                { "id": "timer", "size": last_size }
            ]);
            assert!(
                settings
                    .merge_json(&json!({ "quickTiles": tiles }))
                    .is_empty()
            );
            assert_eq!(serde_json::to_value(&settings.quick_tiles).unwrap(), tiles);
            assert_eq!(
                serde_json::from_value::<Settings>(serde_json::to_value(&settings).unwrap())
                    .unwrap()
                    .quick_tiles,
                settings.quick_tiles
            );
        }
        let accepted = settings.quick_tiles.clone();
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": [
                { "id": "screenshots", "size": "2x1" },
                { "id": "clipboard", "size": "2x1" },
                { "id": "note", "size": "2x1" },
                { "id": "timer", "size": "2x1" },
                { "id": "region", "size": "1x1" }
            ] })),
            vec!["quickTiles"]
        );
        assert_eq!(settings.quick_tiles, accepted);
    }

    #[test]
    fn quick_tiles_defaults_in_serde_and_validates_according_to_contract() {
        // Serde default when key is omitted
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("quickTiles");
        assert_eq!(
            serde_json::from_value::<Settings>(value)
                .unwrap()
                .quick_tiles,
            default_quick_tiles()
        );
        assert_eq!(
            Settings::from_json_lossy(&json!({})).quick_tiles,
            default_quick_tiles()
        );

        let mut settings = Settings::default();

        // 1. Valid custom layout
        assert!(
            settings
                .merge_json(&json!({
                    "quickTiles": [
                        { "id": "ocr", "size": "1x1" },
                        { "id": "screen", "size": "2x1" }
                    ]
                }))
                .is_empty()
        );
        assert_eq!(
            settings.quick_tiles,
            vec![
                TileSlot {
                    id: "ocr".to_string(),
                    size: TileSize::OneByOne
                },
                TileSlot {
                    id: "screen".to_string(),
                    size: TileSize::TwoByOne
                },
            ]
        );

        // 2. Empty array is valid (all tiles hidden)
        assert!(settings.merge_json(&json!({ "quickTiles": [] })).is_empty());
        assert!(settings.quick_tiles.is_empty());

        // 3. Unknown valid id is preserved
        assert!(
            settings
                .merge_json(&json!({
                    "quickTiles": [
                        { "id": "future_tool", "size": "1x1" }
                    ]
                }))
                .is_empty()
        );
        assert_eq!(
            settings.quick_tiles,
            vec![TileSlot {
                id: "future_tool".to_string(),
                size: TileSize::OneByOne
            }]
        );

        // 4. Reject: not an array -> field rejected, previous value preserved
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": "not-an-array" })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": 123 })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": null })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.quick_tiles,
            vec![TileSlot {
                id: "future_tool".to_string(),
                size: TileSize::OneByOne
            }]
        );

        // 5. Reject: element not {id, size}
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": [123] })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": [{ "id": "region" }] })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": [{ "size": "1x1" }] })),
            vec!["quickTiles"]
        );
        assert_eq!(
            settings.merge_json(&json!({ "quickTiles": [{ "id": "region", "size": "3x1" }] })),
            vec!["quickTiles"]
        );

        // 6. Reject: duplicates by id
        assert_eq!(
            settings.merge_json(&json!({
                "quickTiles": [
                    { "id": "region", "size": "1x1" },
                    { "id": "region", "size": "1x1" }
                ]
            })),
            vec!["quickTiles"]
        );

        // 7. Reject: cell count > 8
        assert_eq!(
            settings.merge_json(&json!({
                "quickTiles": [
                    { "id": "a", "size": "2x1" },
                    { "id": "b", "size": "2x1" },
                    { "id": "c", "size": "2x1" },
                    { "id": "d", "size": "2x1" },
                    { "id": "e", "size": "1x1" }
                ]
            })),
            vec!["quickTiles"]
        );

        // 8. Reject: id longer than 32 characters
        let long_id = "a".repeat(33);
        assert_eq!(
            settings.merge_json(&json!({
                "quickTiles": [
                    { "id": long_id, "size": "1x1" }
                ]
            })),
            vec!["quickTiles"]
        );

        // 9. Reject: empty id
        assert_eq!(
            settings.merge_json(&json!({
                "quickTiles": [
                    { "id": "", "size": "1x1" }
                ]
            })),
            vec!["quickTiles"]
        );

        // Verify previous value was never changed by any rejected merges
        assert_eq!(
            settings.quick_tiles,
            vec![TileSlot {
                id: "future_tool".to_string(),
                size: TileSize::OneByOne
            }]
        );
    }
}
