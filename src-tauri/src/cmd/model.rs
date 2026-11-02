//! Search ranking and the session-local launch capability registry. No OS access.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    App,
    File,
    Folder,
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub kind: Kind,
    pub title: String,
    pub subtitle: String,
    /// Shell parsing name, shortcut path, or filesystem path; never supplied by IPC.
    pub launch: String,
    /// Resolved shortcut target (used for elevation and reveal).
    pub resolved: String,
    pub arguments: String,
    pub directory: String,
    pub aumid: Option<String>,
}

impl Entry {
    pub fn key(&self) -> String {
        self.launch.to_lowercase()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdItem {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub subtitle: String,
    pub icon: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LaunchMode {
    Open,
    Admin,
    Reveal,
}

pub fn score(title: &str, query: &str) -> Option<u8> {
    let title = title.to_lowercase();
    if title == query {
        Some(0)
    } else if title.starts_with(query) {
        Some(1)
    } else if title
        .split(|c: char| !c.is_alphanumeric())
        .any(|w| w.starts_with(query))
    {
        Some(2)
    } else if title.contains(query) {
        Some(3)
    } else {
        None
    }
}

pub fn search(entries: impl IntoIterator<Item = Entry>, query: &str, limit: usize) -> Vec<Entry> {
    let query = query.trim().to_lowercase();
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut seen = HashSet::new();
    let mut ranked: Vec<_> = entries
        .into_iter()
        .filter_map(|entry| {
            let rank = score(&entry.title, &query)?;
            seen.insert(entry.key()).then_some((rank, entry))
        })
        .collect();
    ranked.sort_by_cached_key(|(rank, entry)| {
        (
            *rank,
            entry.kind != Kind::App,
            entry.title.to_lowercase(),
            entry.key(),
        )
    });
    ranked
        .into_iter()
        .take(limit.min(100))
        .map(|(_, entry)| entry)
        .collect()
}

#[derive(Default)]
pub struct Registry {
    ids: HashMap<String, String>,
    current: HashMap<String, Entry>,
    sequence: u64,
}

impl Registry {
    /// Old results cease to authorize launches. Reappearing items keep their session ID.
    pub fn publish(&mut self, entries: Vec<Entry>) -> Vec<(String, Entry)> {
        self.current.clear();
        entries
            .into_iter()
            .map(|entry| {
                let key = entry.key();
                let id = self
                    .ids
                    .entry(key)
                    .or_insert_with(|| {
                        self.sequence += 1;
                        format!("cmd-{}", self.sequence)
                    })
                    .clone();
                self.current.insert(id.clone(), entry.clone());
                (id, entry)
            })
            .collect()
    }

    pub fn resolve(&self, id: &str, mode: LaunchMode) -> Result<Entry, String> {
        let entry = self
            .current
            .get(id)
            .ok_or("Search result is no longer available. Search again.")?;
        if mode == LaunchMode::Admin && entry.kind != Kind::App {
            return Err("Only applications can be run as administrator.".into());
        }
        Ok(entry.clone())
    }
}

/// InternetShortcut is an INI file. Ignore URL keys outside its section.
pub fn parse_url(bytes: &[u8]) -> Option<String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16_lossy(
            &bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| u16::from_le_bytes([p[0], p[1]]))
                .collect::<Vec<_>>(),
        )
    } else {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .to_string()
    };
    let mut shortcut = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            shortcut = line.eq_ignore_ascii_case("[InternetShortcut]");
        } else if shortcut && let Some((key, value)) = line.split_once('=') {
            let value = value.trim();
            if key.trim().eq_ignore_ascii_case("URL") && !value.is_empty() && !value.contains('\0')
            {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
pub(super) fn fixture(title: &str, kind: Kind) -> Entry {
    Entry {
        kind,
        title: title.into(),
        subtitle: "fixture".into(),
        launch: format!("C:\\fixture\\{title}-{kind:?}"),
        resolved: String::new(),
        arguments: String::new(),
        directory: String::new(),
        aumid: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_synthetic_index_is_bounded_and_ranked() {
        let entries: Vec<_> = (0..10_000)
            .map(|i| {
                fixture(
                    &format!("Fixture Editor {i:05}"),
                    if i % 2 == 0 { Kind::App } else { Kind::File },
                )
            })
            .collect();
        let started = std::time::Instant::now();
        let result = search(entries, "editor", 20);
        let elapsed = started.elapsed();
        assert_eq!(result.len(), 20);
        assert!(result.iter().all(|e| e.kind == Kind::App));
        assert_eq!(result[0].title, "Fixture Editor 00000");
        println!(
            "Synthetic search: 10,000 entries, 20 results, {elapsed:?} (debug, includes owned input processing)"
        );
    }
    #[test]
    fn ranking_case_unicode_ties_and_limit() {
        let entries = vec![
            fixture("encodex", Kind::App),
            fixture("The Code", Kind::App),
            fixture("Code Editor", Kind::App),
            fixture("CODE", Kind::File),
            fixture("Code", Kind::App),
        ];
        let result = search(entries.clone(), " cOdE ", 20);
        assert_eq!(
            result.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(),
            ["Code", "CODE", "Code Editor", "The Code", "encodex"]
        );
        assert_eq!(search(entries.clone(), "code", 2).len(), 2);
        assert!(search(entries.clone(), "", 2).is_empty());
        assert!(search(entries, "unknown", 2).is_empty());
        assert_eq!(search([fixture("Заметки", Kind::App)], "ЗАМ", 5).len(), 1);
        assert_eq!(score("some-code", "code"), Some(2));
    }
    #[test]
    fn url_sections_equals_bom_and_utf16() {
        assert_eq!(
            parse_url(
                b"[Other]\nURL=wrong\n[InternetShortcut]\nurl = https://example.test/?a=b\r\n"
            ),
            Some("https://example.test/?a=b".into())
        );
        let bytes: Vec<_> = [0xff, 0xfe]
            .into_iter()
            .chain(
                "[InternetShortcut]\nURL=steam://run/123"
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes),
            )
            .collect();
        assert_eq!(parse_url(&bytes), Some("steam://run/123".into()));
        assert!(parse_url(b"[InternetShortcut]\nURL=\n").is_none());
        assert!(parse_url(b"URL=https://example.test").is_none());
    }
    #[test]
    fn ids_are_stable_but_only_latest_results_authorize_launch() {
        let mut registry = Registry::default();
        let app = fixture("Editor", Kind::App);
        let id = registry.publish(vec![app.clone()])[0].0.clone();
        assert!(registry.resolve(&id, LaunchMode::Admin).is_ok());
        registry.publish(vec![]);
        assert!(registry.resolve(&id, LaunchMode::Open).is_err());
        assert_eq!(registry.publish(vec![app])[0].0, id);
        assert!(
            registry
                .resolve("C:\\arbitrary.exe", LaunchMode::Open)
                .is_err()
        );
        let file = registry.publish(vec![fixture("report", Kind::File)])[0]
            .0
            .clone();
        assert!(registry.resolve(&file, LaunchMode::Admin).is_err());
        assert!(registry.resolve(&file, LaunchMode::Reveal).is_ok());
    }
}
