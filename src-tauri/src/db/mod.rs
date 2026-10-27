//! SQLite storage (`island.db` in the app data dir). Owner: R2 (Rust-System).
//!
//! One shared connection behind a mutex, managed as `tauri::State<Db>`. Commands never touch it on
//! the UI thread: they go through [`Db::run`] (`spawn_blocking`).

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;

/// Migrations, applied in order; the index + 1 is the `PRAGMA user_version` after applying it.
const MIGRATIONS: &[&str] = &[
    // v1: clipboard history + notes.
    "CREATE TABLE clips (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT    NOT NULL,
        text       TEXT    NOT NULL DEFAULT '',
        preview    TEXT    NOT NULL DEFAULT '',
        source_app TEXT    NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        pinned     INTEGER NOT NULL DEFAULT 0,
        hash       TEXT    NOT NULL,
        image      BLOB
    );
    CREATE INDEX idx_clips_hash ON clips(kind, hash);
    CREATE INDEX idx_clips_order ON clips(pinned DESC, created_at DESC);
    CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        folder     TEXT    NOT NULL DEFAULT '',
        title      TEXT    NOT NULL DEFAULT '',
        body       TEXT    NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_notes_updated ON notes(updated_at DESC);",
    // v2: Unicode-folded search text, populated once below in Rust (SQLite lower is ASCII-only).
    "ALTER TABLE clips ADD COLUMN text_fold TEXT NOT NULL DEFAULT '';",
    // v3: launcher paths and cached shell icons; order is explicit and survives restarts.
    "CREATE TABLE dock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL
    );",
];

/// Current schema version (= number of migrations).
pub fn schema_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// Brings `conn` to the latest schema. Safe to call repeatedly.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = i as i64 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        if version == 2 {
            let mut stmt = tx.prepare("SELECT id, text FROM clips")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (id, text) = row?;
                tx.execute(
                    "UPDATE clips SET text_fold = ?1 WHERE id = ?2",
                    rusqlite::params![text.to_lowercase(), id],
                )?;
            }
        }
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

/// Opens (creating if needed) the database file and migrates it.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "secure_delete", "ON")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// In-memory database with the full schema (tests).
#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory db");
    conn.pragma_update(None, "secure_delete", "ON")
        .expect("secure delete");
    migrate(&mut conn).expect("migrate");
    conn
}

/// Shared handle to the connection; cheap to clone.
#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Self(Arc::new(Mutex::new(conn)))
    }

    /// Locks the connection (a panic in another holder must not brick the database).
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Runs `f` with the connection on a blocking thread (never on the UI thread).
    pub async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
    {
        let db = self.clone();
        tauri::async_runtime::spawn_blocking(move || f(&mut db.lock()))
            .await
            .map_err(|e| format!("db task failed: {e}"))?
    }
}

/// Opens `island.db` in the app data dir and registers [`Db`] as managed state.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("island.db");
    let conn = open(&path)?;
    log::info!(
        "db: opened {} (schema v{})",
        path.display(),
        schema_version()
    );
    app.manage(Db::new(conn));
    Ok(())
}

/// FNV-1a 64-bit; stable across runs and Rust versions (unlike `DefaultHasher`).
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}:{}", bytes.len())
}

/// Epoch milliseconds.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, schema_version());
        migrate(&mut conn).unwrap();
        for table in ["clips", "notes", "dock"] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "table {table}");
        }
    }

    #[test]
    fn v2_backfills_unicode_search_without_changing_existing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute("INSERT INTO clips(kind, text, created_at, hash, pinned, image) VALUES ('text', 'Привет МИР 🏝', 123, 'hash', 1, X'0102')", []).unwrap();
        conn.execute("INSERT INTO notes(folder, title, body, updated_at) VALUES ('Работа', 'Заметка', '<p>Текст</p>', 123)", []).unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        let row: (String, String, i64, Vec<u8>) = conn
            .query_row(
                "SELECT text, text_fold, pinned, image FROM clips",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            ("Привет МИР 🏝".into(), "привет мир 🏝".into(), 1, vec![1, 2])
        );
        assert_eq!(
            conn.query_row("SELECT body FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "<p>Текст</p>"
        );
        assert_eq!(schema_version(), 3);
    }

    #[test]
    fn open_creates_file_in_wal_mode() {
        let dir = std::env::temp_dir().join(format!("island-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let conn = open(&path).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let secure: i64 = conn
            .query_row("PRAGMA secure_delete", [], |r| r.get(0))
            .unwrap();
        assert_eq!(secure, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
