use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub added_at: i64,
    pub missing: bool,
    pub icon: String,
}

fn failure(_: rusqlite::Error) -> String {
    "shelf.error".into()
}

pub fn list(conn: &Connection) -> Result<Vec<ShelfItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id,path,name,kind,size,added_at,missing,icon FROM shelf ORDER BY position DESC",
        )
        .map_err(failure)?;
    stmt.query_map([], |r| {
        Ok(ShelfItem {
            id: r.get::<_, i64>(0)?.to_string(),
            path: r.get(1)?,
            name: r.get(2)?,
            kind: r.get(3)?,
            size: r
                .get::<_, Option<i64>>(4)?
                .and_then(|n| u64::try_from(n).ok()),
            added_at: r.get(5)?,
            missing: r.get(6)?,
            icon: r.get(7)?,
        })
    })
    .map_err(failure)?
    .collect::<Result<_, _>>()
    .map_err(failure)
}

pub fn refresh(conn: &mut Connection, hours: u32, now: i64) -> Result<Vec<ShelfItem>, String> {
    let tx = conn.transaction().map_err(failure)?;
    if hours != 0 {
        tx.execute(
            "DELETE FROM shelf WHERE added_at <= ?1",
            [now.saturating_sub(i64::from(hours) * 3_600_000)],
        )
        .map_err(failure)?;
    }
    let mut items = list(&tx)?;
    for item in &mut items {
        let missing = !Path::new(&item.path).exists();
        if missing != item.missing {
            tx.execute(
                "UPDATE shelf SET missing=?1 WHERE id=?2",
                params![missing, item.id],
            )
            .map_err(failure)?;
            item.missing = missing;
        }
    }
    tx.commit().map_err(failure)?;
    Ok(items)
}

fn path_key(path: &str) -> String {
    let normalized = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.into());
    normalized
        .strip_prefix("\\\\?\\")
        .unwrap_or(&normalized)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub fn add(
    conn: &mut Connection,
    items: Vec<ShelfItem>,
    now: i64,
) -> Result<Vec<ShelfItem>, String> {
    let tx = conn.transaction().map_err(failure)?;
    let mut position: i64 = tx
        .query_row("SELECT COALESCE(MAX(position),0) FROM shelf", [], |r| {
            r.get(0)
        })
        .map_err(failure)?;
    for item in items {
        position += 1;
        tx.execute("INSERT INTO shelf(path,path_key,name,kind,size,added_at,missing,icon,position)
            VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)
            ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,name=excluded.name,kind=excluded.kind,
            size=excluded.size,added_at=MAX(excluded.added_at,shelf.added_at+1),missing=0,icon=excluded.icon,position=excluded.position",
            params![item.path, path_key(&item.path), item.name, item.kind, item.size.and_then(|n| i64::try_from(n).ok()), now, item.icon, position]).map_err(failure)?;
    }
    tx.commit().map_err(failure)?;
    list(conn)
}

pub fn remove(conn: &mut Connection, ids: &[String]) -> Result<Vec<ShelfItem>, String> {
    let tx = conn.transaction().map_err(failure)?;
    for id in ids {
        tx.execute("DELETE FROM shelf WHERE id=?1", [id])
            .map_err(failure)?;
    }
    tx.commit().map_err(failure)?;
    list(conn)
}

pub fn clear(conn: &Connection) -> Result<Vec<ShelfItem>, String> {
    conn.execute("DELETE FROM shelf", []).map_err(failure)?;
    Ok(Vec::new())
}

/// A completed OLE drop may remove only the exact snapshot that was dragged.
/// A concurrent re-add of the same stable id is retained.
pub fn after_drag(
    conn: &mut Connection,
    dragged: &[ShelfItem],
    dropped: bool,
    keep: bool,
) -> Result<Vec<ShelfItem>, String> {
    if dropped && !keep {
        let tx = conn.transaction().map_err(failure)?;
        for item in dragged {
            tx.execute(
                "DELETE FROM shelf WHERE id=?1 AND added_at=?2",
                params![item.id, item.added_at],
            )
            .map_err(failure)?;
        }
        tx.commit().map_err(failure)?;
    }
    list(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(path: &str) -> ShelfItem {
        ShelfItem {
            id: String::new(),
            path: path.into(),
            name: "file.txt".into(),
            kind: "file".into(),
            size: Some(10),
            added_at: 0,
            missing: false,
            icon: String::new(),
        }
    }
    #[test]
    fn add_duplicate_promotes_stable_id_remove_and_clear() {
        let mut db = crate::db::open_in_memory();
        let first = add(&mut db, vec![item("C:\\a.txt")], 1).unwrap();
        add(&mut db, vec![item("C:\\b.txt")], 2).unwrap();
        let promoted = add(&mut db, vec![item("c:/A.txt")], 3).unwrap();
        assert_eq!(promoted.len(), 2);
        assert_eq!(promoted[0].id, first[0].id);
        assert_eq!(promoted[0].added_at, 3);
        assert_eq!(remove(&mut db, &[first[0].id.clone()]).unwrap().len(), 1);
        assert!(clear(&db).unwrap().is_empty());
        assert!(list(&db).unwrap().is_empty());
    }
    #[test]
    fn retention_hours_boundary_and_forever() {
        let mut db = crate::db::open_in_memory();
        add(&mut db, vec![item("C:\\a.txt")], 0).unwrap();
        assert_eq!(refresh(&mut db, 0, i64::MAX).unwrap().len(), 1);
        assert_eq!(refresh(&mut db, 24, 86_399_999).unwrap().len(), 1);
        assert!(refresh(&mut db, 24, 86_400_000).unwrap().is_empty());
        add(&mut db, vec![item("C:\\a.txt")], 0).unwrap();
        assert!(refresh(&mut db, 1, 3_600_000).unwrap().is_empty());
    }
    #[test]
    fn missing_is_recomputed_in_both_directions() {
        let mut db = crate::db::open_in_memory();
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("shelf-missing-{}", std::process::id()));
        std::fs::write(&path, b"test").unwrap();
        add(&mut db, vec![item(&path.to_string_lossy())], 0).unwrap();
        assert!(!refresh(&mut db, 0, 0).unwrap()[0].missing);
        std::fs::remove_file(&path).unwrap();
        assert!(refresh(&mut db, 0, 0).unwrap()[0].missing);
        std::fs::write(&path, b"test").unwrap();
        assert!(!refresh(&mut db, 0, 0).unwrap()[0].missing);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn only_successful_drop_removes_unless_keep_or_readded() {
        for (dropped, keep, remaining) in [(false, false, 1), (true, true, 1), (true, false, 0)] {
            let mut db = crate::db::open_in_memory();
            let dragged = add(&mut db, vec![item("C:\\a.txt")], 1).unwrap();
            assert_eq!(
                after_drag(&mut db, &dragged, dropped, keep).unwrap().len(),
                remaining
            );
        }
        let mut db = crate::db::open_in_memory();
        let dragged = add(&mut db, vec![item("C:\\a.txt")], 1).unwrap();
        add(&mut db, vec![item("C:\\a.txt")], 1).unwrap();
        assert_eq!(after_drag(&mut db, &dragged, true, false).unwrap().len(), 1);
    }
}
