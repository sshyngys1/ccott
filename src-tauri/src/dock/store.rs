use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashSet;

pub const LIMIT: usize = 12;
#[derive(Debug, Clone, Serialize)]
pub struct DockItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub icon: String,
}
pub fn path_key(path: &str) -> String {
    let path = path.replace('/', "\\");
    let path = if let Some(p) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{p}")
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(&path).to_string()
    };
    if path.len() > 3 {
        path.trim_end_matches('\\').to_lowercase()
    } else {
        path.to_lowercase()
    }
}
pub fn list(conn: &Connection) -> Result<Vec<DockItem>, String> {
    let mut stmt = conn
        .prepare("SELECT id,path,name,kind,icon FROM dock ORDER BY position,id")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |r| {
        Ok(DockItem {
            id: r.get::<_, i64>(0)?.to_string(),
            path: r.get(1)?,
            name: r.get(2)?,
            kind: r.get(3)?,
            icon: r.get(4)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}
pub fn add(conn: &mut Connection, items: Vec<DockItem>) -> Result<Vec<DockItem>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let existing = list(&tx)?;
    let mut keys: HashSet<String> = existing.iter().map(|i| path_key(&i.path)).collect();
    let fresh: Vec<_> = items
        .into_iter()
        .filter(|i| keys.insert(path_key(&i.path)))
        .collect();
    if existing.len() + fresh.len() > LIMIT {
        return Err("dock.limit".into());
    }
    let next: i64 = tx
        .query_row("SELECT COALESCE(MAX(position)+1,0) FROM dock", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    for (offset, item) in fresh.into_iter().enumerate() {
        tx.execute(
            "INSERT INTO dock(path,path_key,name,kind,icon,position) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                item.path,
                path_key(&item.path),
                item.name,
                item.kind,
                item.icon,
                next + offset as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let result = list(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
pub fn remove(conn: &mut Connection, id: &str) -> Result<Vec<DockItem>, String> {
    conn.execute("DELETE FROM dock WHERE CAST(id AS TEXT)=?1", [id])
        .map_err(|e| e.to_string())?;
    list(conn)
}
pub fn reorder(conn: &mut Connection, ids: &[String]) -> Result<Vec<DockItem>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current = list(&tx)?;
    let ids_set: HashSet<_> = ids.iter().map(String::as_str).collect();
    if ids.len() != current.len()
        || ids_set.len() != ids.len()
        || current.iter().any(|i| !ids_set.contains(i.id.as_str()))
    {
        return Err("dock.order".into());
    }
    for (pos, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE dock SET position=?1 WHERE CAST(id AS TEXT)=?2",
            params![pos as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let result = list(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn item(path: &str) -> DockItem {
        DockItem {
            id: String::new(),
            path: path.into(),
            name: "Test".into(),
            kind: "app".into(),
            icon: String::new(),
        }
    }
    #[test]
    fn normalization_handles_unc_separators_case_and_drive_roots() {
        assert_eq!(
            path_key(r"\\?\C:\ПАПКА\Tool.EXE"),
            path_key("c:/папка/tool.exe")
        );
        assert_eq!(
            path_key(r"\\?\UNC\server\Share\"),
            path_key(r"\\SERVER\share")
        );
        assert_eq!(path_key(r"C:\"), r"c:\");
    }
    #[test]
    fn duplicates_limit_order_and_remove_are_persistent() {
        let mut db = crate::db::open_in_memory();
        add(
            &mut db,
            vec![item(r"C:\Tools\ONE.exe"), item(r"c:\tools\one.EXE")],
        )
        .unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
        for n in 1..LIMIT {
            add(&mut db, vec![item(&format!(r"C:\{n}.exe"))]).unwrap();
        }
        assert_eq!(
            add(&mut db, vec![item(r"C:\overflow.exe")]).unwrap_err(),
            "dock.limit"
        );
        let mut ids: Vec<_> = list(&db).unwrap().iter().map(|i| i.id.clone()).collect();
        ids.reverse();
        reorder(&mut db, &ids).unwrap();
        crate::db::migrate(&mut db).unwrap();
        assert_eq!(
            list(&db)
                .unwrap()
                .iter()
                .map(|i| i.id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        assert!(reorder(&mut db, &vec![ids[0].clone(); LIMIT]).is_err());
        assert_eq!(remove(&mut db, &ids[0]).unwrap().len(), LIMIT - 1);
        let added = add(&mut db, vec![item(r"C:\new.exe")]).unwrap();
        assert_eq!(added.last().unwrap().path, r"C:\new.exe");
    }
    #[test]
    fn migration_from_v2_preserves_existing_data() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE notes(title TEXT); INSERT INTO notes VALUES ('keep'); PRAGMA user_version=2;").unwrap();
        crate::db::migrate(&mut db).unwrap();
        crate::db::migrate(&mut db).unwrap();
        assert!(list(&db).unwrap().is_empty());
        assert_eq!(
            db.query_row("SELECT title FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "keep"
        );
    }
}
