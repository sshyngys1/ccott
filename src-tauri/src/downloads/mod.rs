//! Downloads monitor (§21). The worker never owns a strong AppHandle.
mod model;
mod native;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::system::worker::{Control, WorkerApp, with_app};
use model::{Changes, DownloadItem, DownloadState, Tracked, Tracker, partial_name};

const EVENT: &str = "downloads://changed";
type Cache = Arc<RwLock<Vec<Tracked>>>;
type Worker = (Arc<Control>, JoinHandle<()>);

pub struct DownloadsHandle {
    cache: Cache,
    worker: Mutex<Option<Worker>>,
    app: WorkerApp,
}

impl DownloadsHandle {
    pub fn set_enabled(&self, enabled: bool) {
        let mut worker = self.worker.lock().unwrap();
        if enabled && worker.is_some() {
            return;
        }
        if let Some((stop, thread)) = worker.take() {
            stop.stop();
            let _ = thread.join();
        }
        self.cache.write().unwrap().clear();
        if !enabled {
            with_app(&self.app, |app| {
                let _ = app.emit(EVENT, Vec::<DownloadItem>::new());
            });
            return;
        }
        let stop = Arc::new(Control::default());
        let (app, cache, control) = (self.app.clone(), self.cache.clone(), stop.clone());
        match std::thread::Builder::new()
            .name("downloads-monitor".into())
            .spawn(move || {
                while !control.stopped() && app.strong_count() > 0 {
                    // Resolve on every start/retry: honors relocated or reconnected known folders.
                    match native::downloads_folder()
                        .and_then(|folder| run(&folder, &app, &cache, &control))
                    {
                        Ok(()) => break,
                        Err(error) => log::warn!("downloads watcher: {error}"),
                    }
                    cache.write().unwrap().clear();
                    with_app(&app, |app| {
                        let _ = app.emit(EVENT, Vec::<DownloadItem>::new());
                    });
                    control.wait(Duration::from_secs(5));
                }
            }) {
            Ok(thread) => *worker = Some((stop, thread)),
            Err(error) => log::warn!("downloads worker: {error}"),
        }
    }

    fn stop(&self) {
        if let Some((stop, thread)) = self.worker.lock().unwrap().take() {
            stop.stop();
            let _ = thread.join();
        }
        self.cache.write().unwrap().clear();
    }
}

impl Drop for DownloadsHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = DownloadsHandle {
        cache: Arc::default(),
        worker: Mutex::default(),
        app: worker_app,
    };
    handle.set_enabled(crate::settings::current(app.handle()).downloads_monitor);
    app.manage(handle);
    Ok(())
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    if let Some(handle) = app.try_state::<DownloadsHandle>() {
        handle.set_enabled(enabled);
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<DownloadsHandle>() {
        handle.stop();
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn snapshot(folder: &Path) -> std::io::Result<HashMap<PathBuf, u64>> {
    let mut files = HashMap::new();
    for entry in std::fs::read_dir(folder)?.flatten() {
        if let Ok(meta) = entry.metadata()
            && meta.is_file()
        {
            files.insert(entry.path(), meta.len());
        }
    }
    Ok(files)
}

fn run(folder: &Path, app: &WorkerApp, cache: &Cache, stop: &Control) -> Result<(), String> {
    // Arm before baseline scan so newly created files cannot fall into a blind interval.
    let mut watcher = native::Watcher::open(folder)?;
    let mut known = snapshot(folder).map_err(|e| e.to_string())?;
    let mut tracker = Tracker::default();
    for (path, bytes) in &known {
        if partial_name(path).is_some() {
            tracker.observe(path.clone(), *bytes, now_ms());
        }
    }
    let mut previous = Vec::new();
    let mut changes = Changes::default();
    let mut dirty = false;
    let mut sampled = Instant::now();
    let mut emitted = Instant::now() - Duration::from_secs(1);
    while !stop.stopped() && app.strong_count() > 0 {
        if let Some(events) = watcher.next()? {
            dirty = true;
            tracker.notify(
                events
                    .into_iter()
                    .map(|(action, name)| (action, folder.join(name)))
                    .collect(),
                &mut changes,
                now_ms(),
            );
        }
        let now = now_ms();
        // A single directory snapshot each second coalesces changes and handles missed events.
        if sampled.elapsed() >= Duration::from_secs(1) {
            sampled = Instant::now();
            let has_active = tracker
                .entries
                .iter()
                .any(|e| e.item.state == DownloadState::Active);
            if dirty || has_active {
                let files = snapshot(folder).map_err(|e| e.to_string())?;
                tracker.reconcile(&files, &known, &mut changes, now);
                known = files;
                dirty = false;
            } else {
                tracker.sample(&known, now); // retention only, no disk reads
            }
        }
        let items = tracker.items();
        if items != previous && emitted.elapsed() >= Duration::from_millis(500) {
            *cache.write().unwrap() = tracker.entries.clone();
            with_app(app, |app| {
                let _ = app.emit(EVENT, &items);
            });
            previous = items;
            emitted = Instant::now();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn downloads_list(
    handle: State<'_, DownloadsHandle>,
) -> Result<Vec<DownloadItem>, String> {
    let mut items: Vec<_> = handle
        .cache
        .read()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|e| e.item.clone())
        .collect();
    items.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(items)
}

#[tauri::command]
pub async fn downloads_open(
    app: AppHandle,
    handle: State<'_, DownloadsHandle>,
    id: String,
    mode: String,
) -> Result<(), String> {
    let entry = handle
        .cache
        .read()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|e| e.item.id == id)
        .cloned()
        .ok_or("Download is no longer available")?;
    tauri::async_runtime::spawn_blocking(move || {
        if !entry.path.is_file() {
            return Err("Downloaded file is no longer available".into());
        }
        let path = entry.path.to_string_lossy().into_owned();
        match mode.as_str() {
            "reveal" => app
                .opener()
                .reveal_item_in_dir(path)
                .map_err(|e| e.to_string()),
            "open" if entry.item.state == DownloadState::Done => app
                .opener()
                .open_path(path, None::<&str>)
                .map_err(|e| e.to_string()),
            "open" => Err("Download is not complete".into()),
            _ => Err("Invalid download action".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_joins_the_worker_and_clears_all_cached_downloads() {
        let stop = Arc::new(Control::default());
        let control = stop.clone();
        let thread = std::thread::spawn(move || control.wait(Duration::from_secs(30)));
        let mut tracker = Tracker::default();
        tracker.observe(PathBuf::from("test.part"), 100, 0);
        let handle = DownloadsHandle {
            cache: Arc::new(RwLock::new(tracker.entries)),
            worker: Mutex::new(Some((stop.clone(), thread))),
            app: WorkerApp::new(), // never resolves the real Downloads known folder
        };
        // Exercise the shared shutdown primitive without linking Tauri's GUI emitter into the test EXE.
        handle.stop();
        assert!(stop.stopped());
        assert!(handle.worker.lock().unwrap().is_none());
        assert!(handle.cache.read().unwrap().is_empty());
        handle.stop(); // repeated shutdown / Drop is harmless
    }
}
