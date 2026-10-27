//! Notes storage (table `notes`). Owner: R2 (Rust-System).
//! The body is HTML from the UI and is stored as is (the UI sanitizes it before rendering).

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Db, now_ms};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub folder: String,
    pub title: String,
    pub body: String,
    pub updated_at: i64,
}

/// Argument of `notes_save`: `id == None` inserts, otherwise updates.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub id: Option<i64>,
    pub folder: String,
    pub title: String,
    pub body: String,
}

fn row_to_note(r: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        folder: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder, title, body, updated_at FROM notes ORDER BY updated_at DESC, id DESC",
    )?;
    stmt.query_map([], row_to_note)?.collect()
}

pub fn save(conn: &Connection, input: &NoteInput, now: i64) -> Result<Note, String> {
    let id = match input.id {
        None => {
            conn.execute(
                "INSERT INTO notes (folder, title, body, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![input.folder, input.title, input.body, now],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
        Some(id) => {
            let n = conn
                .execute(
                    "UPDATE notes SET folder = ?1, title = ?2, body = ?3, updated_at = ?4 WHERE id = ?5",
                    params![input.folder, input.title, input.body, now, id],
                )
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err(format!("note {id} not found"));
            }
            id
        }
    };
    conn.query_row(
        "SELECT id, folder, title, body, updated_at FROM notes WHERE id = ?1",
        [id],
        row_to_note,
    )
    .map_err(|e| e.to_string())
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub async fn notes_list(db: State<'_, Db>) -> Result<Vec<Note>, String> {
    db.run(|c| list(c).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn notes_save(db: State<'_, Db>, note: NoteInput) -> Result<Note, String> {
    db.run(move |c| save(c, &note, now_ms())).await
}

#[tauri::command]
pub async fn notes_delete(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.run(move |c| delete(c, id).map_err(|e| e.to_string()))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn input(id: Option<i64>, title: &str) -> NoteInput {
        NoteInput {
            id,
            folder: "Заметка".into(),
            title: title.into(),
            body: "<p>hi</p>".into(),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let conn = open_in_memory();
        let a = save(&conn, &input(None, "A"), 100).unwrap();
        let b = save(&conn, &input(None, "B"), 200).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(a.body, "<p>hi</p>");

        // newest first
        let titles: Vec<_> = list(&conn).unwrap().into_iter().map(|n| n.title).collect();
        assert_eq!(titles, ["B", "A"]);

        // update bumps updated_at and reorders
        let a2 = save(&conn, &input(Some(a.id), "A2"), 300).unwrap();
        assert_eq!((a2.id, a2.title.as_str(), a2.updated_at), (a.id, "A2", 300));
        assert_eq!(list(&conn).unwrap()[0].id, a.id);

        delete(&conn, b.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn update_of_missing_note_fails() {
        let conn = open_in_memory();
        assert!(save(&conn, &input(Some(42), "x"), 1).is_err());
    }

    #[test]
    fn input_deserializes_null_id() {
        let n: NoteInput =
            serde_json::from_str(r#"{"id":null,"folder":"f","title":"t","body":"b"}"#).unwrap();
        assert!(n.id.is_none());
    }
}
