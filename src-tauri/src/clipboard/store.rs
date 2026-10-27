//! Clipboard history storage: pure SQLite logic (dedupe, limits, ordering, search). No Win32 here.

use rusqlite::{Connection, OptionalExtension, params};

use crate::db::content_hash;
use serde::Serialize;

/// Unpinned entries kept in the history; older ones are dropped.
pub const MAX_UNPINNED: usize = 500;
/// Longest text we store (bytes); longer clipboard text is ignored.
pub const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
/// `preview` length for text entries (chars).
pub const PREVIEW_CHARS: usize = 200;
/// Only list responses are capped; the stored paste payload remains complete.
pub const LIST_TEXT_CHARS: usize = 10_000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipKind {
    Text,
    Link,
    Image,
    Files,
}

impl ClipKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ClipKind::Text => "text",
            ClipKind::Link => "link",
            ClipKind::Image => "image",
            ClipKind::Files => "files",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "text" => ClipKind::Text,
            "link" => ClipKind::Link,
            "image" => ClipKind::Image,
            "files" => ClipKind::Files,
            _ => return None,
        })
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: i64,
    pub kind: ClipKind,
    pub text: String,
    pub preview: String,
    pub source_app: String,
    pub created_at: i64,
    pub pinned: bool,
}

/// What to store. Images carry the full PNG blob and a thumbnail data URL in `preview`.
#[derive(Clone, Debug)]
pub struct NewClip {
    pub kind: ClipKind,
    pub text: String,
    pub preview: String,
    pub source_app: String,
    pub image: Option<Vec<u8>>,
}

/// Full entry as needed for pasting.
pub struct ClipPayload {
    pub kind: ClipKind,
    pub text: String,
    pub image: Option<Vec<u8>>,
}

/// True when `s` is a single http(s)/ftp URL (no whitespace, has a host).
pub fn is_url(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.len() > 2048 || s.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    let rest = ["https://", "http://", "ftp://"]
        .iter()
        .find_map(|p| lower.strip_prefix(p));
    match rest {
        Some(r) => {
            let host = r.split(['/', '?', '#']).next().unwrap_or("");
            !host.is_empty() && !host.starts_with('.') && !host.starts_with(':')
        }
        None => false,
    }
}

/// Classifies clipboard text as `link` (single URL) or `text`.
pub fn classify_text(text: &str) -> ClipKind {
    if is_url(text) {
        ClipKind::Link
    } else {
        ClipKind::Text
    }
}

/// First [`PREVIEW_CHARS`] chars, with line breaks collapsed to spaces.
pub fn make_preview(text: &str) -> String {
    text.trim()
        .chars()
        .take(PREVIEW_CHARS)
        .map(|ch| {
            if matches!(ch, '\r' | '\n' | '\t') {
                ' '
            } else {
                ch
            }
        })
        .collect()
}

fn row_to_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<ClipItem> {
    let kind: String = r.get(1)?;
    Ok(ClipItem {
        id: r.get(0)?,
        kind: ClipKind::parse(&kind).unwrap_or(ClipKind::Text),
        text: r.get(2)?,
        preview: r.get(3)?,
        source_app: r.get(4)?,
        created_at: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0,
    })
}

const ITEM_COLS: &str = "id, kind, text, preview, source_app, created_at, pinned";

pub fn get_item(conn: &Connection, id: i64) -> rusqlite::Result<Option<ClipItem>> {
    conn.query_row(
        &format!("SELECT {ITEM_COLS} FROM clips WHERE id = ?1"),
        [id],
        row_to_item,
    )
    .optional()
}

/// Inserts a new entry, or moves an identical existing one to the top. Returns the item and
/// whether a new row was created. Trims the history afterwards.
pub fn add(conn: &Connection, clip: &NewClip, now: i64) -> rusqlite::Result<(ClipItem, bool)> {
    let hash = match (&clip.image, clip.kind) {
        (Some(img), _) => content_hash(img),
        (None, _) => content_hash(clip.text.as_bytes()),
    };
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM clips WHERE kind = ?1 AND hash = ?2 LIMIT 1",
            params![clip.kind.as_str(), hash],
            |r| r.get(0),
        )
        .optional()?;
    let (id, is_new) = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE clips SET created_at = ?1, source_app = ?2 WHERE id = ?3",
                params![now, clip.source_app, id],
            )?;
            (id, false)
        }
        None => {
            conn.execute(
                "INSERT INTO clips (kind, text, preview, source_app, created_at, pinned, hash, image, text_fold)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
                params![
                    clip.kind.as_str(),
                    clip.text,
                    clip.preview,
                    clip.source_app,
                    now,
                    hash,
                    clip.image,
                    clip.text.to_lowercase()
                ],
            )?;
            (conn.last_insert_rowid(), true)
        }
    };
    trim(conn, MAX_UNPINNED)?;
    let item = get_item(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    Ok((item, is_new))
}

/// Keeps only the newest `max_unpinned` unpinned entries.
pub fn trim(conn: &Connection, max_unpinned: usize) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM clips WHERE pinned = 0 AND id NOT IN (
            SELECT id FROM clips WHERE pinned = 0 ORDER BY created_at DESC, id DESC LIMIT ?1)",
        [max_unpinned as i64],
    )
}

/// Pinned first, then newest first. `query` is a case-insensitive substring of the text.
pub fn list(conn: &Connection, query: &str, limit: usize) -> rusqlite::Result<Vec<ClipItem>> {
    let query = query.trim().to_lowercase();
    // Preserve literal substring semantics: SQL wildcards in clipboard text are not operators.
    let pattern = if query.is_empty() {
        String::new()
    } else {
        format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        )
    };
    let limit = limit.clamp(1, 5000) as i64;
    let mut stmt = conn.prepare(&format!(
        "SELECT id, kind, substr(text, 1, {LIST_TEXT_CHARS}), preview, source_app, created_at, pinned FROM clips
         WHERE (?1 = '' OR text_fold LIKE ?1 ESCAPE '\\')
         ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ?2"
    ))?;
    stmt.query_map(params![pattern, limit], row_to_item)?
        .collect()
}

pub fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clips SET pinned = ?1 WHERE id = ?2",
        params![i64::from(pinned), id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM clips WHERE id = ?1", [id])?;
    checkpoint_truncate(conn);
    Ok(())
}

pub fn clear(conn: &Connection, keep_pinned: bool) -> rusqlite::Result<()> {
    if keep_pinned {
        conn.execute("DELETE FROM clips WHERE pinned = 0", [])?;
    } else {
        conn.execute("DELETE FROM clips", [])?;
    }
    checkpoint_truncate(conn);
    Ok(())
}

/// Best effort: readers may hold a WAL snapshot. A committed DELETE must still report success.
fn checkpoint_truncate(conn: &Connection) {
    match conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
        r.get::<_, i64>(0)
    }) {
        Ok(0) => {}
        Ok(busy) => log::debug!("clipboard: WAL truncate deferred (busy={busy})"),
        Err(err) => log::debug!("clipboard: WAL truncate deferred: {err}"),
    }
}

pub fn payload(conn: &Connection, id: i64) -> rusqlite::Result<Option<ClipPayload>> {
    conn.query_row(
        "SELECT kind, text, image FROM clips WHERE id = ?1",
        [id],
        |r| {
            let kind: String = r.get(0)?;
            Ok(ClipPayload {
                kind: ClipKind::parse(&kind).unwrap_or(ClipKind::Text),
                text: r.get(1)?,
                image: r.get(2)?,
            })
        },
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn text_clip(t: &str) -> NewClip {
        NewClip {
            kind: classify_text(t),
            text: t.into(),
            preview: make_preview(t),
            source_app: "app.exe".into(),
            image: None,
        }
    }

    #[test]
    fn url_detection() {
        assert!(is_url("https://example.com"));
        assert!(is_url("  http://example.com/path?q=1#x \n"));
        assert!(is_url("HTTPS://Example.COM/A"));
        assert!(is_url("ftp://files.example.com/x"));
        assert!(!is_url("example.com"));
        assert!(!is_url("https://"));
        assert!(!is_url("https:// example.com"));
        assert!(!is_url("see https://example.com"));
        assert!(!is_url("https://a.com https://b.com"));
        assert!(!is_url("javascript:alert(1)"));
        assert!(!is_url(""));
        assert_eq!(classify_text("https://rust-lang.org"), ClipKind::Link);
        assert_eq!(classify_text("hello"), ClipKind::Text);
    }

    #[test]
    fn preview_is_single_line_and_capped() {
        let long = "a\nb".repeat(300);
        let p = make_preview(&long);
        assert_eq!(p.chars().count(), PREVIEW_CHARS);
        assert!(!p.contains('\n'));
    }

    #[test]
    fn dedupe_moves_existing_to_top() {
        let conn = open_in_memory();
        let (a, new_a) = add(&conn, &text_clip("alpha"), 100).unwrap();
        let (_b, _) = add(&conn, &text_clip("beta"), 200).unwrap();
        assert!(new_a);
        let (a2, new_a2) = add(&conn, &text_clip("alpha"), 300).unwrap();
        assert!(!new_a2);
        assert_eq!(a2.id, a.id);
        assert_eq!(a2.created_at, 300);
        let items = list(&conn, "", 10).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].text, "alpha");
    }

    #[test]
    fn same_text_different_kind_is_not_deduped() {
        let conn = open_in_memory();
        let mut files = text_clip("C:\\a.txt");
        files.kind = ClipKind::Files;
        let (_, n1) = add(&conn, &text_clip("C:\\a.txt"), 1).unwrap();
        let (_, n2) = add(&conn, &files, 2).unwrap();
        assert!(n1 && n2);
    }

    #[test]
    fn unpinned_limit_keeps_newest_and_all_pinned() {
        let conn = open_in_memory();
        let (pinned, _) = add(&conn, &text_clip("keep me"), 1).unwrap();
        set_pinned(&conn, pinned.id, true).unwrap();
        for i in 0..(MAX_UNPINNED + 20) {
            add(&conn, &text_clip(&format!("item {i}")), 10 + i as i64).unwrap();
        }
        let all = list(&conn, "", 5000).unwrap();
        assert_eq!(all.len(), MAX_UNPINNED + 1);
        assert!(all.iter().any(|c| c.text == "keep me"));
        assert!(!all.iter().any(|c| c.text == "item 0"));
        assert!(
            all.iter()
                .any(|c| c.text == format!("item {}", MAX_UNPINNED + 19))
        );
    }

    #[test]
    fn pinned_first_then_newest() {
        let conn = open_in_memory();
        let (old, _) = add(&conn, &text_clip("old"), 1).unwrap();
        add(&conn, &text_clip("mid"), 2).unwrap();
        add(&conn, &text_clip("new"), 3).unwrap();
        set_pinned(&conn, old.id, true).unwrap();
        let texts: Vec<_> = list(&conn, "", 10)
            .unwrap()
            .into_iter()
            .map(|c| c.text)
            .collect();
        assert_eq!(texts, ["old", "new", "mid"]);
        // limit applies after ordering
        assert_eq!(list(&conn, "", 2).unwrap().len(), 2);
    }

    #[test]
    fn search_is_case_insensitive_unicode() {
        let conn = open_in_memory();
        add(&conn, &text_clip("Привет, МИР"), 1).unwrap();
        add(&conn, &text_clip("Hello World"), 2).unwrap();
        assert_eq!(list(&conn, "мир", 10).unwrap().len(), 1);
        assert_eq!(list(&conn, "WORLD", 10).unwrap().len(), 1);
        assert_eq!(list(&conn, "o", 10).unwrap().len(), 1); // Latin o only in "Hello World"
        assert_eq!(list(&conn, "zzz", 10).unwrap().len(), 0);
        // percent / underscore are literal (no LIKE semantics)
        assert_eq!(list(&conn, "%", 10).unwrap().len(), 0);
        add(&conn, &text_clip("ПУТЬ C:\\100%_ГОТОВО"), 3).unwrap();
        assert_eq!(list(&conn, "c:\\100%_готово", 10).unwrap().len(), 1);
        assert_eq!(list(&conn, "100%Xготово", 10).unwrap().len(), 0);
        let folded: String = conn
            .query_row(
                "SELECT text_fold FROM clips WHERE created_at = 3",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folded, "путь c:\\100%_готово");
    }

    #[test]
    fn list_caps_unicode_chars_but_search_and_paste_keep_full_text() {
        let conn = open_in_memory();
        let prefix = "Я🏝".repeat(LIST_TEXT_CHARS / 2);
        let full = format!("{prefix}ХВОСТ");
        let (item, _) = add(&conn, &text_clip(&full), 1).unwrap();
        let found = list(&conn, "хвост", 10).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text, prefix);
        assert_eq!(found[0].text.chars().count(), LIST_TEXT_CHARS);
        assert_eq!(payload(&conn, item.id).unwrap().unwrap().text, full);
        let exact = text_clip(&"ю".repeat(LIST_TEXT_CHARS));
        add(&conn, &exact, 2).unwrap();
        assert_eq!(list(&conn, "", 1).unwrap()[0].text, exact.text);
    }

    #[test]
    fn delete_and_clear_truncate_file_backed_wal() {
        let dir = std::env::temp_dir().join(format!("island-wal-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("clips.db");
        let conn = crate::db::open(&path).unwrap();
        let wal = dir.join("clips.db-wal");
        let (a, _) = add(&conn, &text_clip(&"secret".repeat(1000)), 1).unwrap();
        assert!(std::fs::metadata(&wal).unwrap().len() > 0);
        delete(&conn, a.id).unwrap();
        assert_eq!(std::fs::metadata(&wal).unwrap().len(), 0);
        add(&conn, &text_clip("another secret"), 2).unwrap();
        clear(&conn, false).unwrap();
        assert_eq!(std::fs::metadata(&wal).unwrap().len(), 0);
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn busy_wal_checkpoint_does_not_fail_committed_delete_or_clear() {
        let dir = std::env::temp_dir().join(format!("island-wal-busy-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("clips.db");
        let writer = crate::db::open(&path).unwrap();
        writer.busy_timeout(std::time::Duration::ZERO).unwrap();
        let reader = crate::db::open(&path).unwrap();
        let (clip, _) = add(&writer, &text_clip("test secret"), 1).unwrap();
        reader.execute_batch("BEGIN").unwrap();
        let count: i64 = reader
            .query_row("SELECT count(*) FROM clips", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        delete(&writer, clip.id).unwrap();
        assert!(payload(&writer, clip.id).unwrap().is_none());
        add(&writer, &text_clip("another test"), 2).unwrap();
        clear(&writer, false).unwrap();
        assert!(list(&writer, "", 10).unwrap().is_empty());
        assert!(std::fs::metadata(dir.join("clips.db-wal")).unwrap().len() > 0);
        reader.execute_batch("COMMIT").unwrap();
        clear(&writer, false).unwrap();
        assert_eq!(
            std::fs::metadata(dir.join("clips.db-wal")).unwrap().len(),
            0
        );
        drop(reader);
        drop(writer);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn delete_and_clear() {
        let conn = open_in_memory();
        let (a, _) = add(&conn, &text_clip("a"), 1).unwrap();
        let (b, _) = add(&conn, &text_clip("b"), 2).unwrap();
        add(&conn, &text_clip("c"), 3).unwrap();
        set_pinned(&conn, b.id, true).unwrap();
        delete(&conn, a.id).unwrap();
        assert_eq!(list(&conn, "", 10).unwrap().len(), 2);
        clear(&conn, true).unwrap();
        let left = list(&conn, "", 10).unwrap();
        assert_eq!(left.len(), 1);
        assert!(left[0].pinned);
        clear(&conn, false).unwrap();
        assert!(list(&conn, "", 10).unwrap().is_empty());
    }

    #[test]
    fn images_dedupe_by_blob_and_payload_returns_blob() {
        let conn = open_in_memory();
        let img = NewClip {
            kind: ClipKind::Image,
            text: String::new(),
            preview: "data:image/png;base64,AAAA".into(),
            source_app: String::new(),
            image: Some(vec![1, 2, 3, 4]),
        };
        let (a, n1) = add(&conn, &img, 1).unwrap();
        let (b, n2) = add(&conn, &img, 2).unwrap();
        assert!(n1 && !n2);
        assert_eq!(a.id, b.id);
        let p = payload(&conn, a.id).unwrap().unwrap();
        assert_eq!(p.kind, ClipKind::Image);
        assert_eq!(p.image.unwrap(), vec![1, 2, 3, 4]);
        // list does not carry the blob but keeps the thumbnail
        let item = &list(&conn, "", 10).unwrap()[0];
        assert!(item.preview.starts_with("data:image/png"));
        assert_eq!(item.text, "");
    }

    #[test]
    fn serializes_camel_case() {
        let item = ClipItem {
            id: 1,
            kind: ClipKind::Link,
            text: "t".into(),
            preview: "p".into(),
            source_app: "x.exe".into(),
            created_at: 5,
            pinned: false,
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["sourceApp"], "x.exe");
        assert_eq!(v["createdAt"], 5);
        assert_eq!(v["kind"], "link");
    }
}
