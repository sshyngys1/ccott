//! §28. SQLite reminders and one cancellable deadline, with paced overdue delivery.
mod scheduler;

use crate::db::{Db, now_ms};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub text: String,
    pub due_at: f64,
    pub created_at: i64,
    pub done: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub text: Option<String>,
    pub due_at: Option<f64>,
    pub done: Option<bool>,
}

fn validate(text: &str, due_at: f64) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > 500 {
        return Err("Reminder text must contain 1–500 characters".into());
    }
    if !due_at.is_finite() {
        return Err("Reminder dueAt must be finite".into());
    }
    Ok(())
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id: r.get::<_, i64>(0)?.to_string(),
        text: r.get(1)?,
        due_at: r.get(2)?,
        created_at: r.get(3)?,
        done: r.get(4)?,
    })
}

pub fn list(c: &Connection) -> rusqlite::Result<Vec<Reminder>> {
    c.prepare("SELECT id,text,due_at,created_at,done FROM reminders ORDER BY done,due_at,id")?
        .query_map([], row)?
        .collect()
}

fn get(c: &Connection, id: &str) -> Result<Reminder, String> {
    c.query_row(
        "SELECT id,text,due_at,created_at,done FROM reminders WHERE id=?1",
        [id],
        row,
    )
    .map_err(|e| e.to_string())
}

fn add(c: &Connection, text: String, due_at: f64, now: i64) -> Result<Reminder, String> {
    validate(&text, due_at)?;
    c.execute(
        "INSERT INTO reminders(text,due_at,created_at) VALUES (?1,?2,?3)",
        params![text.trim(), due_at, now],
    )
    .map_err(|e| e.to_string())?;
    get(c, &c.last_insert_rowid().to_string())
}

fn update(c: &Connection, id: &str, patch: Patch) -> Result<Reminder, String> {
    let old = get(c, id)?;
    let text = patch.text.unwrap_or(old.text);
    let due = patch.due_at.unwrap_or(old.due_at);
    validate(&text, due)?;
    c.execute(
        "UPDATE reminders SET text=?1,due_at=?2,done=?3 WHERE id=?4",
        params![text.trim(), due, patch.done.unwrap_or(old.done), id],
    )
    .map_err(|e| e.to_string())?;
    get(c, id)
}

fn delete(c: &Connection, id: &str) -> Result<(), String> {
    if c.execute("DELETE FROM reminders WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Reminder not found".into());
    }
    Ok(())
}

fn changed(app: &AppHandle, c: &Connection) -> Result<(), String> {
    // Called under the same database lock as the mutation: concurrent commands
    // cannot emit an older list after a newer change (or race a due delivery).
    let items = list(c).map_err(|e| e.to_string())?;
    let _ = app.emit("reminders://changed", items);
    Ok(())
}

#[tauri::command]
pub async fn reminders_list(db: State<'_, Db>) -> Result<Vec<Reminder>, String> {
    db.run(|c| list(c).map_err(|e| e.to_string())).await
}
#[tauri::command]
pub async fn reminders_add(
    app: AppHandle,
    db: State<'_, Db>,
    text: String,
    due_at: f64,
) -> Result<Reminder, String> {
    let notify = app.clone();
    let item = db
        .run(move |c| {
            let item = add(c, text, due_at, now_ms())?;
            changed(&notify, c)?;
            Ok(item)
        })
        .await?;
    scheduler::refresh(&app);
    Ok(item)
}
#[tauri::command]
pub async fn reminders_update(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
    patch: Patch,
) -> Result<Reminder, String> {
    let notify = app.clone();
    let item = db
        .run(move |c| {
            let item = update(c, &id, patch)?;
            changed(&notify, c)?;
            Ok(item)
        })
        .await?;
    scheduler::refresh(&app);
    Ok(item)
}
#[tauri::command]
pub async fn reminders_delete(app: AppHandle, db: State<'_, Db>, id: String) -> Result<(), String> {
    let notify = app.clone();
    db.run(move |c| {
        delete(c, &id)?;
        changed(&notify, c)
    })
    .await?;
    scheduler::refresh(&app);
    Ok(())
}

pub use scheduler::{setup, shutdown};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_and_crud_preserve_notes_and_dates() {
        let c = crate::db::open_in_memory();
        c.execute("INSERT INTO notes(title,updated_at) VALUES ('kept',1)", [])
            .unwrap();
        let a = add(&c, "call".into(), 12.5, 1).unwrap();
        let b = add(&c, "meet".into(), -2.0, 2).unwrap();
        assert_eq!(list(&c).unwrap(), [b.clone(), a.clone()]);
        let done = update(
            &c,
            &b.id,
            Patch {
                text: Some("changed".into()),
                due_at: Some(99.0),
                done: Some(true),
            },
        )
        .unwrap();
        assert_eq!(done.created_at, 2);
        assert!(done.done);
        assert_eq!(done.text, "changed");
        delete(&c, &a.id).unwrap();
        assert_eq!(list(&c).unwrap(), [done]);
        assert!(delete(&c, &a.id).is_err());
        assert!(update(&c, &a.id, Patch::default()).is_err());
        assert_eq!(
            c.query_row("SELECT title FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "kept"
        );
    }
    #[test]
    fn validates_unicode_length_empty_text_and_finite_time() {
        let c = crate::db::open_in_memory();
        for text in ["", " \n\t"] {
            assert!(add(&c, text.into(), 1.0, 0).is_err());
        }
        assert!(add(&c, "🏝".repeat(500), 1.0, 0).is_ok());
        assert!(add(&c, "я".repeat(501), 1.0, 0).is_err());
        for due in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(add(&c, "x".into(), due, 0).is_err());
        }
        let a = add(&c, "x".into(), 1.0, 0).unwrap();
        assert!(
            update(
                &c,
                &a.id,
                Patch {
                    text: Some(" ".into()),
                    ..Patch::default()
                }
            )
            .is_err()
        );
        assert_eq!(get(&c, &a.id).unwrap(), a);
    }
}
