//! Pure download tracking. No filesystem access or browser integration.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

const RETENTION_MS: i64 = 5 * 60 * 1000;
const STALLED_MS: i64 = 3_000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub name: String,
    pub state: DownloadState,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_sec: Option<f64>,
    pub started_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadState {
    Active,
    Done,
    Failed,
}

pub fn partial_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy();
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    if !matches!(extension.as_str(), "crdownload" | "part" | "download") {
        return None;
    }
    let stem = &name[..name.len() - extension.len() - 1];
    let lower = stem.to_lowercase();
    Some(
        if lower.starts_with("unconfirmed ") || lower.starts_with("не подтверждено ")
        {
            String::new()
        } else {
            stem.to_string()
        },
    )
}

#[derive(Clone)]
pub struct Tracked {
    pub item: DownloadItem,
    pub path: PathBuf,
    sampled_at: i64,
    grew_at: i64,
}

#[derive(Default)]
pub struct Tracker {
    pub entries: Vec<Tracked>,
    sequence: u64,
}

#[derive(Default)]
pub struct Changes {
    added: HashSet<PathBuf>,
    removed: HashSet<PathBuf>,
    renamed: HashSet<PathBuf>,
    rename_old: Option<PathBuf>,
}

impl Tracker {
    /// State transitions need no disk reads; byte sampling is separately limited to once per second.
    pub fn notify(&mut self, events: Vec<(u32, PathBuf)>, changes: &mut Changes, now: i64) {
        for (action, path) in events {
            match action {
                1 => {
                    if partial_name(&path).is_some() {
                        if !self
                            .entries
                            .iter()
                            .any(|e| e.path == path && e.item.state == DownloadState::Active)
                        {
                            self.created(path, 0, now);
                        }
                    } else {
                        changes.added.insert(path);
                    }
                }
                3 => {
                    changes.removed.insert(path.clone());
                    if let Some(entry) = self
                        .entries
                        .iter_mut()
                        .find(|e| e.path == path && e.item.state == DownloadState::Active)
                    {
                        entry.item.state = DownloadState::Failed;
                        entry.item.bytes_per_sec = None;
                        entry.item.updated_at = now;
                    }
                }
                4 => changes.rename_old = Some(path),
                5 => {
                    if let Some(old) = changes.rename_old.take() {
                        changes.renamed.insert(path.clone());
                        self.rename(&old, path, now);
                    }
                }
                _ => {}
            }
        }
    }

    /// Coalesces notifications with one disk snapshot. Paths are absolute in production.
    pub fn reconcile(
        &mut self,
        files: &HashMap<PathBuf, u64>,
        known: &HashMap<PathBuf, u64>,
        changes: &mut Changes,
        now: i64,
    ) {
        self.sample(files, now);
        for (path, bytes) in files {
            if !known.contains_key(path) || changes.added.contains(path) {
                let companion = files
                    .keys()
                    .any(|partial| is_companion(path, *bytes, partial))
                    || (*bytes == 0
                        && self.entries.iter().any(|e| {
                            e.item.state == DownloadState::Failed
                                && (e.item.updated_at == now || changes.removed.contains(&e.path))
                                && is_companion(path, *bytes, &e.path)
                        }));
                let tracked = self.entries.iter().any(|e| e.path == *path);
                if !companion
                    && !changes.renamed.contains(path)
                    && (!tracked || changes.added.contains(path))
                {
                    self.created(path.clone(), *bytes, now);
                }
            }
        }
        for entry in &mut self.entries {
            if let Some(bytes) = files.get(&entry.path) {
                entry.item.received_bytes = *bytes;
            }
            if entry.item.state == DownloadState::Active {
                // Firefox sometimes uses final.ext.<random>.part beside an empty final placeholder.
                if let Some(final_path) = files.iter().find_map(|(path, bytes)| {
                    is_companion(path, *bytes, &entry.path).then_some(path)
                }) {
                    entry.item.name = final_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                }
            }
        }
        changes.added.clear();
        changes.removed.clear();
        changes.renamed.clear();
    }

    pub fn created(&mut self, path: PathBuf, bytes: u64, now: i64) {
        // Reusing a cancelled/completed filename is a new download, not a revival of its ID.
        self.entries
            .retain(|e| e.path != path || e.item.state == DownloadState::Active);
        self.observe(path, bytes, now);
    }

    pub fn observe(&mut self, path: PathBuf, bytes: u64, now: i64) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.path == path) {
            if entry.item.state != DownloadState::Done {
                let elapsed = now - entry.sampled_at;
                let grew = bytes > entry.item.received_bytes;
                if grew && elapsed > 0 {
                    let speed =
                        (bytes - entry.item.received_bytes) as f64 * 1000.0 / elapsed as f64;
                    // EMA with a ~3 second time constant, independent of sample spacing.
                    let weight = 1.0 - (-(elapsed as f64) / 3000.0).exp();
                    entry.item.bytes_per_sec = Some(
                        entry
                            .item
                            .bytes_per_sec
                            .map_or(speed, |old| old + weight * (speed - old)),
                    );
                    entry.grew_at = now;
                    entry.item.state = DownloadState::Active;
                } else if bytes < entry.item.received_bytes || now - entry.grew_at >= STALLED_MS {
                    entry.item.bytes_per_sec = None;
                }
                if bytes != entry.item.received_bytes {
                    entry.item.updated_at = now;
                }
                entry.item.received_bytes = bytes;
                entry.sampled_at = now;
            }
            return;
        }
        self.sequence += 1;
        let partial = partial_name(&path);
        self.entries.push(Tracked {
            item: DownloadItem {
                id: format!("dl-{now}-{}", self.sequence),
                name: partial.clone().unwrap_or_else(|| {
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                }),
                state: if partial.is_some() {
                    DownloadState::Active
                } else {
                    DownloadState::Done
                },
                received_bytes: bytes,
                total_bytes: None,
                bytes_per_sec: None,
                started_at: now,
                updated_at: now,
            },
            path,
            sampled_at: now,
            grew_at: now,
        });
    }

    pub fn rename(&mut self, old: &Path, new: PathBuf, now: i64) {
        if old == new {
            return;
        }
        // A Firefox final-name placeholder may already exist. The partial owns the identity.
        if self.entries.iter().any(|e| e.path == old) {
            self.entries.retain(|e| e.path != new);
        } else if partial_name(old).is_some() {
            self.observe(old.to_path_buf(), 0, now);
            self.entries.retain(|e| e.path != new);
        } else {
            return;
        }
        if let Some(entry) = self.entries.iter_mut().find(|e| e.path == old) {
            let partial = partial_name(&new);
            entry.item.name = partial.clone().unwrap_or_else(|| {
                new.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            entry.item.state = if partial.is_some() {
                DownloadState::Active
            } else {
                DownloadState::Done
            };
            entry.item.bytes_per_sec = None;
            entry.item.updated_at = now;
            entry.path = new;
        }
    }

    pub fn sample(&mut self, files: &HashMap<PathBuf, u64>, now: i64) {
        let paths: Vec<_> = self
            .entries
            .iter()
            .filter(|e| e.item.state != DownloadState::Done)
            .map(|e| e.path.clone())
            .collect();
        for path in paths {
            if let Some(bytes) = files.get(&path) {
                self.observe(path, *bytes, now);
            } else {
                // Recover a same-name partial → final if notifications overflowed / were split.
                let entry = self.entries.iter().find(|e| e.path == path).unwrap();
                let final_path =
                    (!entry.item.name.is_empty()).then(|| path.with_file_name(&entry.item.name));
                // A Firefox placeholder is not evidence of completion after cancellation.
                let received = entry.item.received_bytes;
                if let Some(final_path) = final_path.filter(|p| {
                    files
                        .get(p)
                        .is_some_and(|size| *size > 0 && *size >= received)
                }) {
                    self.rename(&path, final_path.clone(), now);
                    if let Some(entry) = self.entries.iter_mut().find(|e| e.path == final_path) {
                        entry.item.received_bytes = files[&final_path];
                    }
                } else if let Some(entry) = self
                    .entries
                    .iter_mut()
                    .find(|e| e.path == path && e.item.state == DownloadState::Active)
                {
                    entry.item.state = DownloadState::Failed;
                    entry.item.bytes_per_sec = None;
                    entry.item.updated_at = now;
                }
            }
        }
        // Pauses alone are not cancellation (§21): only disappearance confirms failure.
        self.entries.retain(|e| {
            e.item.state == DownloadState::Active || now - e.item.updated_at < RETENTION_MS
        });
    }

    pub fn items(&self) -> Vec<DownloadItem> {
        let mut items: Vec<_> = self.entries.iter().map(|e| e.item.clone()).collect();
        items.sort_by(|a, b| {
            b.started_at
                .cmp(&a.started_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        items
    }
}

fn is_companion(final_path: &Path, bytes: u64, partial: &Path) -> bool {
    if partial_name(final_path).is_some() || final_path.parent() != partial.parent() {
        return false;
    }
    let Some(stem) = partial_name(partial).filter(|n| !n.is_empty()) else {
        return false;
    };
    let name = final_path.file_name().unwrap_or_default().to_string_lossy();
    if stem == name {
        return true;
    }
    // Infer randomized Firefox stems only from empty placeholders and a short opaque suffix.
    bytes == 0
        && stem
            .strip_prefix(name.as_ref())
            .and_then(|s| s.strip_prefix('.'))
            .is_some_and(|suffix| {
                (6..=12).contains(&suffix.len())
                    && suffix
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn path(name: &str) -> PathBuf {
        PathBuf::from(name)
    }

    #[test]
    fn browser_names() {
        for suffix in ["crdownload", "part", "download", "PART"] {
            assert_eq!(
                partial_name(&path(&format!("archive.zip.{suffix}"))),
                Some("archive.zip".into())
            );
        }
        for name in [
            "Unconfirmed 123.crdownload",
            "Не подтверждено 42.crdownload",
        ] {
            assert_eq!(partial_name(&path(name)), Some(String::new()));
        }
        assert_eq!(partial_name(&path("file.zip")), None);
    }

    #[test]
    fn split_notifications_finish_immediately_and_sampling_preserves_identity() {
        let mut t = Tracker::default();
        let mut changes = Changes::default();
        let partial = path("Unconfirmed 123.crdownload");
        let final_path = path("empty.txt");
        t.notify(vec![(1, partial.clone())], &mut changes, 0);
        let id = t.items()[0].id.clone();
        t.notify(vec![(4, partial)], &mut changes, 100);
        t.notify(vec![(5, final_path.clone())], &mut changes, 200);
        assert_eq!(t.items()[0].state, DownloadState::Done); // no disk sample required
        t.reconcile(
            &HashMap::from([(final_path, 0)]),
            &HashMap::new(),
            &mut changes,
            1000,
        );
        assert_eq!(t.items().len(), 1);
        assert_eq!(t.items()[0].id, id);
        assert_eq!(t.items()[0].name, "empty.txt");
    }

    #[test]
    fn firefox_placeholder_waits_for_partial_rename_and_keeps_its_id() {
        let mut t = Tracker::default();
        let partial = path("archive.zip.ABC12345.part");
        let final_path = path("archive.zip");
        let files = HashMap::from([(partial.clone(), 100), (final_path.clone(), 0)]);
        let mut changes = Changes::default();
        t.notify(
            vec![(1, final_path.clone()), (1, partial.clone())],
            &mut changes,
            0,
        );
        t.reconcile(&files, &HashMap::new(), &mut changes, 0);
        assert_eq!(t.items().len(), 1);
        assert_eq!(t.items()[0].name, "archive.zip");
        let id = t.items()[0].id.clone();
        let finished = HashMap::from([(final_path.clone(), 100)]);
        t.notify(vec![(4, partial), (5, final_path)], &mut changes, 1000);
        t.reconcile(&finished, &files, &mut changes, 1000);
        assert_eq!(t.items().len(), 1);
        assert_eq!(t.items()[0].id, id);
        assert_eq!(t.items()[0].state, DownloadState::Done);
    }

    #[test]
    fn cancelled_firefox_with_placeholder_is_failed_and_reused_name_gets_new_id() {
        let mut t = Tracker::default();
        let partial = path("archive.zip.part");
        let final_path = path("archive.zip");
        t.observe(partial.clone(), 100, 0);
        let id = t.items()[0].id.clone();
        t.sample(&HashMap::from([(final_path, 0)]), 1000);
        assert_eq!(t.items()[0].state, DownloadState::Failed);
        t.created(partial, 0, 2000);
        assert_eq!(t.items()[0].state, DownloadState::Active);
        assert_ne!(t.items()[0].id, id);
    }

    #[test]
    fn rename_chain_preserves_id_and_resolves_unknown_name() {
        let mut t = Tracker::default();
        t.observe(path("Unconfirmed 123.crdownload"), 50, 0);
        let id = t.items()[0].id.clone();
        t.rename(
            &path("Unconfirmed 123.crdownload"),
            path("file.zip.crdownload"),
            1000,
        );
        t.rename(&path("file.zip.crdownload"), path("file.zip"), 2000);
        let item = &t.items()[0];
        assert_eq!(item.id, id);
        assert_eq!(item.name, "file.zip");
        assert_eq!(item.state, DownloadState::Done);
    }

    #[test]
    fn speed_is_smoothed_and_stalls_are_unknown() {
        let mut t = Tracker::default();
        let p = path("a.part");
        t.observe(p.clone(), 0, 0);
        assert_eq!(t.items()[0].bytes_per_sec, None);
        t.observe(p.clone(), 1000, 1000);
        assert_eq!(t.items()[0].bytes_per_sec, Some(1000.0));
        t.observe(p.clone(), 4000, 2000);
        let speed = t.items()[0].bytes_per_sec.unwrap();
        assert!(speed > 1000.0 && speed < 3000.0);
        t.observe(p.clone(), 4000, 5000);
        assert_eq!(t.items()[0].bytes_per_sec, None);
        t.observe(p, 1, 6000); // a browser restarted the file
        assert_eq!(t.items()[0].bytes_per_sec, None);
    }

    #[test]
    fn deletion_failure_retention_and_pause() {
        let mut t = Tracker::default();
        t.observe(path("a.part"), 10, 0);
        t.sample(&HashMap::from([(path("a.part"), 10)]), 61_000);
        assert_eq!(t.items()[0].state, DownloadState::Active);
        t.sample(&HashMap::new(), 62_000);
        assert_eq!(t.items()[0].state, DownloadState::Failed);
        t.sample(&HashMap::new(), 362_000);
        assert!(t.items().is_empty());
    }

    #[test]
    fn missing_rename_notification_and_new_regular_file() {
        let mut t = Tracker::default();
        t.observe(path("a.zip.part"), 10, 0);
        let id = t.items()[0].id.clone();
        t.sample(&HashMap::from([(path("a.zip"), 20)]), 1000);
        assert_eq!(t.items()[0].id, id);
        assert_eq!(t.items()[0].received_bytes, 20);
        assert_eq!(t.items()[0].state, DownloadState::Done);
        t.observe(path("b.txt"), 30, 1000);
        assert_eq!(t.items()[0].state, DownloadState::Done);
        assert_eq!(t.items()[0].total_bytes, None);
    }
}
