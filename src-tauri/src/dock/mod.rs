mod drag;
mod native;
mod store;
use crate::db::Db;
use store::DockItem;
use tauri::{AppHandle, Emitter, State};

fn localized(app: &AppHandle, error: String) -> String {
    use crate::settings::model::LanguageMode;
    let language = crate::settings::current(app).language;
    // SAFETY: this reads the current user's UI language, without handles or pointers.
    let ru = language == LanguageMode::Ru
        || (language == LanguageMode::Auto
            && unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() } & 0x3ff
                == 0x19);
    match (error.as_str(), ru) {
        ("dock.limit", true) => "В доке может быть не больше 12 элементов",
        ("dock.limit", false) => "The dock can hold up to 12 items",
        ("dock.notFound", true) => "Файл не найден",
        ("dock.notFound", false) => "File not found",
        ("dock.order", true) => "Не удалось изменить порядок дока",
        ("dock.order", false) => "Couldn’t reorder the dock",
        (_, true) => "Не удалось выполнить действие с доком",
        (_, false) => "Couldn’t complete the dock action",
    }
    .into()
}
fn publish(app: &AppHandle, items: Vec<DockItem>) -> Vec<DockItem> {
    let _ = app.emit("dock://changed", &items);
    items
}
#[tauri::command]
pub async fn dock_list(app: AppHandle, db: State<'_, Db>) -> Result<Vec<DockItem>, String> {
    db.run(move |conn| Ok(publish(&app, store::list(conn)?)))
        .await
}
#[tauri::command]
pub async fn dock_add(
    app: AppHandle,
    db: State<'_, Db>,
    paths: Vec<String>,
) -> Result<Vec<DockItem>, String> {
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || native::describe(paths))
        .await
        .map_err(|e| e.to_string())?;
    let result = match result {
        Ok(items) => {
            db.run(move |conn| Ok(publish(&app2, store::add(conn, items)?)))
                .await
        }
        Err(e) => Err(e),
    };
    result.map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn dock_remove(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
) -> Result<Vec<DockItem>, String> {
    let app2 = app.clone();
    db.run(move |conn| Ok(publish(&app2, store::remove(conn, &id)?)))
        .await
        .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn dock_reorder(
    app: AppHandle,
    db: State<'_, Db>,
    ids: Vec<String>,
) -> Result<Vec<DockItem>, String> {
    let app2 = app.clone();
    db.run(move |conn| Ok(publish(&app2, store::reorder(conn, &ids)?)))
        .await
        .map_err(|e| localized(&app, e))
}
#[tauri::command]
pub async fn dock_open(app: AppHandle, db: State<'_, Db>, id: String) -> Result<(), String> {
    let item = db
        .run(move |conn| {
            store::list(conn)?
                .into_iter()
                .find(|i| i.id == id)
                .ok_or("dock.notFound".into())
        })
        .await
        .map_err(|e| localized(&app, e))?;
    tauri::async_runtime::spawn_blocking(move || native::open(&item.path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| localized(&app, e))
}

#[tauri::command]
pub async fn dock_start_drag(app: AppHandle, db: State<'_, Db>, id: String) -> Result<(), String> {
    let item = db
        .run(move |conn| {
            store::list(conn)?
                .into_iter()
                .find(|item| item.id == id)
                .ok_or("dock.notFound".into())
        })
        .await
        .map_err(|error| localized(&app, error))?;
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(drag::start(&item.path));
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
        .map_err(|error| localized(&app, error))
}
