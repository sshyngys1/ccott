mod drag;
mod native;
mod store;

use crate::{
    db::{self, Db},
    system::worker::{Control, WorkerApp, with_app},
};
use std::{
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::Duration,
};
use store::ShelfItem;
use tauri::{AppHandle, Emitter, Manager, State};

const EVENT: &str = "shelf://changed";

fn localized(app: &AppHandle, error: String) -> String {
    use crate::settings::model::LanguageMode;
    let language = crate::settings::current(app).language;
    // SAFETY: reads user UI language without pointers or handles.
    let ru = language == LanguageMode::Ru
        || (language == LanguageMode::Auto
            && unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() } & 0x3ff
                == 0x19);
    match (error.as_str(), ru) {
        ("shelf.missing", true) => "Файл перемещён или удалён",
        ("shelf.missing", false) => "File moved or deleted",
        (_, true) => "Не удалось выполнить действие с полкой",
        (_, false) => "Couldn’t complete the shelf action",
    }
    .into()
}

fn publish(app: &AppHandle, before: Vec<ShelfItem>, items: Vec<ShelfItem>) -> Vec<ShelfItem> {
    if before != items {
        let _ = app.emit(EVENT, &items);
    }
    items
}

fn refresh(app: &AppHandle, conn: &mut rusqlite::Connection) -> Result<Vec<ShelfItem>, String> {
    let before = store::list(conn)?;
    let items = store::refresh(
        conn,
        crate::settings::current(app).shelf_retention_hours,
        db::now_ms(),
    )?;
    Ok(publish(app, before, items))
}

pub struct ShelfWorker {
    control: Arc<Control>,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl ShelfWorker {
    fn stop(&self) {
        self.control.stop();
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}
impl Drop for ShelfWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    let control = Arc::new(Control::default());
    let stop = control.clone();
    let db = app.state::<Db>().inner().clone();
    let thread = std::thread::Builder::new()
        .name("shelf-retention".into())
        .spawn(move || {
            while !stop.stopped() && worker_app.strong_count() > 0 {
                // First pass is startup cleanup; subsequent passes run at most ten minutes apart.
                with_app(&worker_app, |app| {
                    if refresh(app, &mut db.lock()).is_err() {
                        log::warn!("shelf retention failed");
                    }
                });
                stop.wait(Duration::from_secs(600));
            }
        })?;
    app.manage(ShelfWorker {
        control,
        thread: Mutex::new(Some(thread)),
    });
    Ok(())
}
pub fn shutdown(app: &AppHandle) {
    if let Some(worker) = app.try_state::<ShelfWorker>() {
        worker.stop();
    }
}

#[tauri::command]
pub async fn shelf_list(app: AppHandle, db: State<'_, Db>) -> Result<Vec<ShelfItem>, String> {
    let app2 = app.clone();
    db.run(move |conn| refresh(&app2, conn))
        .await
        .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn shelf_add(
    app: AppHandle,
    db: State<'_, Db>,
    paths: Vec<String>,
) -> Result<Vec<ShelfItem>, String> {
    let items = tauri::async_runtime::spawn_blocking(move || native::describe(paths))
        .await
        .map_err(|_| localized(&app, "shelf.error".into()))?
        .map_err(|e| localized(&app, e))?;
    let app2 = app.clone();
    db.run(move |conn| {
        refresh(&app2, conn)?;
        let before = store::list(conn)?;
        let items = store::add(conn, items, db::now_ms())?;
        Ok(publish(&app2, before, items))
    })
    .await
    .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn shelf_remove(
    app: AppHandle,
    db: State<'_, Db>,
    ids: Vec<String>,
) -> Result<Vec<ShelfItem>, String> {
    let app2 = app.clone();
    db.run(move |conn| {
        let before = store::list(conn)?;
        let items = store::remove(conn, &ids)?;
        Ok(publish(&app2, before, items))
    })
    .await
    .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn shelf_clear(app: AppHandle, db: State<'_, Db>) -> Result<Vec<ShelfItem>, String> {
    let app2 = app.clone();
    db.run(move |conn| {
        let before = store::list(conn)?;
        let items = store::clear(conn)?;
        Ok(publish(&app2, before, items))
    })
    .await
    .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn shelf_open(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
    mode: String,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "open" | "reveal") {
        return Err(localized(&app, "shelf.error".into()));
    }
    let item = db
        .run(move |conn| {
            store::list(conn)?
                .into_iter()
                .find(|i| i.id == id)
                .ok_or("shelf.missing".into())
        })
        .await
        .map_err(|e| localized(&app, e))?;
    tauri::async_runtime::spawn_blocking(move || native::open(&item.path, mode == "reveal"))
        .await
        .map_err(|_| localized(&app, "shelf.error".into()))?
        .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn shelf_start_drag(
    app: AppHandle,
    db: State<'_, Db>,
    ids: Vec<String>,
) -> Result<(), String> {
    let app2 = app.clone();
    let dragged = db
        .run(move |conn| {
            let items = refresh(&app2, conn)?;
            if ids.is_empty() {
                return Err("shelf.missing".into());
            }
            ids.iter()
                .map(|id| {
                    items
                        .iter()
                        .find(|i| &i.id == id && !i.missing)
                        .cloned()
                        .ok_or("shelf.missing".into())
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .await
        .map_err(|e| localized(&app, e))?;
    let paths = dragged.iter().map(|i| i.path.clone()).collect::<Vec<_>>();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(drag::start(&paths));
    })
    .map_err(|_| localized(&app, "shelf.error".into()))?;
    let dropped = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| localized(&app, "shelf.error".into()))?
        .map_err(|_| localized(&app, "shelf.error".into()))?
        .map_err(|e| localized(&app, e))?;
    let settings = crate::settings::current(&app);
    let app2 = app.clone();
    db.run(move |conn| {
        let before = store::list(conn)?;
        store::after_drag(conn, &dragged, dropped, settings.shelf_keep_after_drag)?;
        // A target can move a kept file, so refresh missing flags before publishing.
        let items = store::refresh(conn, settings.shelf_retention_hours, db::now_ms())?;
        publish(&app2, before, items);
        Ok(())
    })
    .await
    .map_err(|e| localized(&app, e))
}
