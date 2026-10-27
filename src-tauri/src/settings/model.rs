//! The `Settings` value, tolerant merging of JSON into it and clamping (pure, unit-tested).
//! Mirror of `Settings` in `src/shared/types.ts`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::hotkeys::{DEFAULT_SUMMON_HOTKEY, parse_hotkey};
use crate::window::VibrancyMode;

/// Upper bound of both hover delays, in milliseconds.
pub const MAX_DELAY_MS: u32 = 2000;
/// `Settings::monitor` value meaning "the primary monitor".
pub const MONITOR_PRIMARY: &str = "primary";
/// Default list of applications (`Settings::auto_hide_apps`) over which the pill auto-hides
/// when maximized or touching the top of the monitor work area.
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
    #[serde(default)]
    pub language: LanguageMode,
    pub theme: ThemeMode,
    pub vibrancy: VibrancyMode,
    /// `MonitorInfo.id` or `"primary"`.
    pub monitor: String,
    pub autostart: bool,
    pub do_not_disturb: bool,
    pub hover_expand_delay_ms: u32,
    pub hover_collapse_delay_ms: u32,
    pub hide_in_fullscreen: bool,
    pub summon_hotkey: String,
    pub fullscreen_allowlist: Vec<String>,
    #[serde(default = "default_auto_hide_apps")]
    pub auto_hide_apps: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: LanguageMode::Auto,
            theme: ThemeMode::Auto,
            vibrancy: VibrancyMode::None,
            monitor: MONITOR_PRIMARY.to_string(),
            autostart: false,
            do_not_disturb: false,
            hover_expand_delay_ms: 120,
            hover_collapse_delay_ms: 350,
            hide_in_fullscreen: true,
            summon_hotkey: DEFAULT_SUMMON_HOTKEY.to_string(),
            fullscreen_allowlist: Vec::new(),
            auto_hide_apps: default_auto_hide_apps(),
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
        let allowlist = std::mem::take(&mut self.fullscreen_allowlist);
        self.fullscreen_allowlist = normalize_allowlist(allowlist);
        let auto_hide = std::mem::take(&mut self.auto_hide_apps);
        self.auto_hide_apps = normalize_allowlist(auto_hide);
    }

    /// Merges the known fields of the JSON object `value` into `self` (unknown fields are
    /// ignored, delays are clamped). Fields that are present but invalid are left unchanged and
    /// returned by name. A non-object `value` changes nothing and is reported as `"<root>"`.
    pub fn merge_json(&mut self, value: &Value) -> Vec<String> {
        let Some(map) = value.as_object() else {
            return vec!["<root>".to_string()];
        };
        let mut rejected = Vec::new();
        take(map, "language", &mut self.language, &mut rejected);
        take(map, "theme", &mut self.theme, &mut rejected);
        take(map, "vibrancy", &mut self.vibrancy, &mut rejected);
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
        take(
            map,
            "fullscreenAllowlist",
            &mut self.fullscreen_allowlist,
            &mut rejected,
        );
        take(map, "autoHideApps", &mut self.auto_hide_apps, &mut rejected);
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
    use serde_json::json;

    #[test]
    fn defaults_match_the_contract() {
        let d = Settings::default();
        assert_eq!(d.theme, ThemeMode::Auto);
        assert_eq!(d.vibrancy, VibrancyMode::None);
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
    }

    #[test]
    fn serializes_to_camel_case() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(
            v,
            json!({
                "language": "auto",
                "theme": "auto", "vibrancy": "none", "monitor": "primary",
                "autostart": false, "doNotDisturb": false,
                "hoverExpandDelayMs": 120, "hoverCollapseDelayMs": 350,
                "hideInFullscreen": true,
                "summonHotkey": "Ctrl+Alt+I",
                "fullscreenAllowlist": [],
                "autoHideApps": [
                    "chrome.exe",
                    "msedge.exe",
                    "firefox.exe",
                    "browser.exe",
                    "opera.exe",
                    "brave.exe",
                    "vivaldi.exe"
                ]
            })
        );
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
}
