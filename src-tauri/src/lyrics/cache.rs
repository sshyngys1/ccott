//! SQLite cache of lookups (`lyrics_cache`): found texts, instrumentals and "not found" with a TTL.

use super::{LyricsLine, LyricsResult, Source};
use rusqlite::{Connection, OptionalExtension, params};

/// How long "not found" is trusted: 1 day (contract §30 says 7; shortened after user feedback on fresh releases).
pub const NOT_FOUND_TTL_MS: i64 = 24 * 3600 * 1000;
/// Cached rows kept at most (oldest dropped on insert).
const MAX_ROWS: i64 = 2000;

/// Normalized key: `title|artist|album|round(duration / 2 s)`.
pub fn key(title: &str, artist: &str, album: &str, duration_ms: i64) -> String {
    let norm = |s: &str| {
        s.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let bucket = (duration_ms.max(0) as f64 / 2000.0).round() as i64;
    format!("{}|{}|{}|{bucket}", norm(title), norm(artist), norm(album))
}

/// A usable cached answer, or `None` (missing, expired `notFound`, unreadable).
pub fn load(conn: &Connection, key: &str, now: i64) -> Option<LyricsResult> {
    let (status, payload, fetched_at): (String, String, i64) = conn
        .query_row(
            "SELECT status, payload, fetched_at FROM lyrics_cache WHERE key = ?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .ok()??;
    match status.as_str() {
        "synced" => {
            let lines: Vec<LyricsLine> = serde_json::from_str(&payload).ok()?;
            (!lines.is_empty()).then_some(LyricsResult::Synced {
                lines,
                source: Source::Cache,
            })
        }
        "plain" => Some(LyricsResult::Plain {
            text: payload,
            source: Source::Cache,
        }),
        "instrumental" => Some(LyricsResult::Instrumental),
        "notFound" if (0..NOT_FOUND_TTL_MS).contains(&(now - fetched_at)) => {
            Some(LyricsResult::NotFound)
        }
        _ => None,
    }
}

/// Stores a definitive answer; `Error` is never cached.
pub fn store(conn: &Connection, key: &str, result: &LyricsResult, now: i64) {
    let (status, payload) = match result {
        LyricsResult::Synced { lines, .. } => match serde_json::to_string(lines) {
            Ok(json) => ("synced", json),
            Err(_) => return,
        },
        LyricsResult::Plain { text, .. } => ("plain", text.clone()),
        LyricsResult::Instrumental => ("instrumental", String::new()),
        LyricsResult::NotFound => ("notFound", String::new()),
        LyricsResult::Error { .. } => return,
    };
    let _ = conn.execute(
        "INSERT INTO lyrics_cache(key, status, payload, fetched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET status = ?2, payload = ?3, fetched_at = ?4",
        params![key, status, payload, now],
    );
    let _ = conn.execute(
        "DELETE FROM lyrics_cache WHERE status = 'notFound' AND fetched_at < ?1",
        [now - NOT_FOUND_TTL_MS],
    );
    let _ = conn.execute(
        "DELETE FROM lyrics_cache WHERE key IN (
            SELECT key FROM lyrics_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ?1)",
        [MAX_ROWS],
    );
}

/// Forgets the cached answer of a track (the "Retry" button).
pub fn forget(conn: &Connection, key: &str) {
    let _ = conn.execute("DELETE FROM lyrics_cache WHERE key = ?1", [key]);
}
