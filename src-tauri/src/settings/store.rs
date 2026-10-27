//! `settings.json` on disk: tolerant load, atomic write (temp file + rename).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::model::Settings;

pub const FILE_NAME: &str = "settings.json";

/// Loads the settings. A missing, unreadable or invalid file gives the defaults; a file with
/// unknown or invalid fields gives the defaults overlaid with its valid known fields.
/// The second value is `true` when the file did not exist.
pub fn load(path: &Path) -> (Settings, bool) {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Settings::default(), true),
        Err(e) => {
            log::warn!("settings: cannot read {}: {e}", path.display());
            return (Settings::default(), false);
        }
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => (Settings::from_json_lossy(&v), false),
        Err(e) => {
            log::warn!(
                "settings: {} is not valid JSON ({e}), using defaults",
                path.display()
            );
            (Settings::default(), false)
        }
    }
}

/// Writes the settings atomically: the data goes to `<file>.tmp`, is flushed to disk and renamed
/// over the target, so a crash never leaves a half-written file.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::model::ThemeMode;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("island-win-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = temp_dir("missing");
        let (s, missing) = load(&dir.join(FILE_NAME));
        assert!(missing);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn invalid_or_foreign_files_give_defaults() {
        let dir = temp_dir("invalid");
        let p = dir.join(FILE_NAME);
        fs::write(&p, "{ not json").unwrap();
        assert_eq!(load(&p), (Settings::default(), false));
        fs::write(&p, "[1,2,3]").unwrap();
        assert_eq!(load(&p), (Settings::default(), false));
        fs::write(&p, "").unwrap();
        assert_eq!(load(&p), (Settings::default(), false));
    }

    #[test]
    fn unknown_and_broken_fields_are_tolerated() {
        let dir = temp_dir("tolerant");
        let p = dir.join(FILE_NAME);
        fs::write(
            &p,
            r#"{"theme":"dark","future":1,"hoverExpandDelayMs":"x","hoverCollapseDelayMs":5000}"#,
        )
        .unwrap();
        let (s, missing) = load(&p);
        assert!(!missing);
        assert_eq!(s.theme, ThemeMode::Dark);
        assert_eq!(s.hover_expand_delay_ms, 120);
        assert_eq!(s.hover_collapse_delay_ms, 2000);
    }

    #[test]
    fn save_then_load_round_trips_and_replaces_atomically() {
        let dir = temp_dir("roundtrip");
        let p = dir.join("nested").join(FILE_NAME);
        let s = Settings {
            theme: ThemeMode::Light,
            autostart: true,
            ..Settings::default()
        };
        save(&p, &s).unwrap();
        assert_eq!(load(&p), (s.clone(), false));
        // The second write replaces the existing file and leaves no temp file behind.
        let s2 = Settings {
            do_not_disturb: true,
            ..s
        };
        save(&p, &s2).unwrap();
        assert_eq!(load(&p).0, s2);
        assert!(!dir.join("nested").join("settings.json.tmp").exists());
    }
}
