//! Command bar backend (§20): background application index, local search and opaque launches.
mod automation;
pub(crate) mod currency;
mod model;
mod native;

use crate::system::worker::Control;
use model::{CmdItem, Entry, LaunchMode, Registry};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

const REFRESH: Duration = Duration::from_secs(5 * 60);
type Icons = Arc<Mutex<HashMap<String, Option<String>>>>;
type FallbackCache = Mutex<Option<(Instant, Vec<Entry>)>>;

#[derive(Default)]
struct Shared {
    apps: RwLock<Vec<Entry>>,
    ready: AtomicBool,
    icons: Icons,
    registry: Mutex<Registry>,
    stop: Control,
    fallback: FallbackCache,
}

pub struct CommandHandle {
    shared: Arc<Shared>,
    icons: SyncSender<String>,
    worker: Mutex<Option<JoinHandle<()>>>,
    currency_dir: PathBuf,
    client: reqwest::Client,
}

impl CommandHandle {
    fn stop(&self) {
        self.shared.stop.stop();
        if let Some(worker) = self.worker.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = worker.join();
        }
    }
}
impl Drop for CommandHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let currency_dir = app.path().app_data_dir()?.join("cmd-currency");
    let client = currency::client()?;
    let shared = Arc::new(Shared::default());
    let (icons, receiver) = mpsc::sync_channel::<String>(100);
    let state = shared.clone();
    let worker = std::thread::Builder::new()
        .name("command-index".into())
        .spawn(move || {
            let Ok(_com) = native::Apartment::new() else {
                return;
            };
            let mut refresh = Instant::now();
            while !state.stop.stopped() {
                if Instant::now() >= refresh {
                    let started = Instant::now();
                    let entries = native::applications(&state.stop);
                    if state.stop.stopped() {
                        break;
                    }
                    let count = entries.len();
                    *state.apps.write().unwrap_or_else(|e| e.into_inner()) = entries;
                    state.ready.store(true, Ordering::Release);
                    // Counts/timing only: never names, paths or queries.
                    log::debug!(
                        "command application index: {count} entries in {:?}",
                        started.elapsed()
                    );
                    refresh = Instant::now() + REFRESH;
                }
                if let Ok(path) = receiver.recv_timeout(Duration::from_millis(100)) {
                    if state.stop.stopped() {
                        break;
                    }
                    let icon = crate::dock::shell_icon(&path)
                        .ok()
                        .filter(|s| !s.is_empty());
                    state
                        .icons
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(path, icon);
                }
            }
        })?;
    app.manage(CommandHandle {
        shared,
        icons,
        worker: Mutex::new(Some(worker)),
        currency_dir,
        client,
    });
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<CommandHandle>() {
        handle.stop();
    }
}

fn search(
    shared: &Shared,
    icons: &SyncSender<String>,
    query: &str,
    limit: usize,
) -> Result<Vec<CmdItem>, String> {
    if shared.stop.stopped() {
        return Err("Command search is shutting down.".into());
    }
    if query.chars().count() > 256 || query.contains('\0') {
        return Err("Search query is too long or contains invalid characters.".into());
    }
    let mut entries = shared
        .apps
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    // Startup queries never wait for index construction or touch the user's file tree.
    if shared.ready.load(Ordering::Acquire) && !query.trim().is_empty() && limit > 0 {
        let _com = native::Apartment::new().map_err(|_| "Could not initialize Windows Search.")?;
        // A failed Windows Search provider gets a short circuit-breaker interval. Typing
        // during an outage must not repeatedly pay its two-second connection timeout.
        let fallback = shared
            .fallback
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|(at, _)| at.elapsed() <= Duration::from_secs(60))
            .map(|(_, files)| files.clone());
        match fallback
            .map(Ok)
            .unwrap_or_else(|| native::indexed_files(query.trim(), &shared.stop))
        {
            Ok(files) => entries.extend(files),
            Err(_) => {
                let mut cache = shared.fallback.lock().unwrap_or_else(|e| e.into_inner());
                if cache
                    .as_ref()
                    .is_none_or(|(at, _)| at.elapsed() > Duration::from_secs(60))
                {
                    *cache = Some((Instant::now(), native::fallback(&shared.stop)));
                }
                if let Some((_, files)) = &*cache {
                    entries.extend(files.iter().cloned());
                }
            }
        }
    }
    if shared.stop.stopped() {
        return Err("Command search is shutting down.".into());
    }
    let entries = model::search(entries, query, limit);
    let published = shared
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .publish(entries);
    let mut cache = shared.icons.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() > 1024 {
        cache.clear();
    }
    Ok(published
        .into_iter()
        .map(|(id, entry)| {
            let path = entry.launch.clone();
            let icon = cache.get(&path).cloned().flatten();
            if !cache.contains_key(&path) && icons.try_send(path.clone()).is_ok() {
                cache.insert(path, None);
            }
            CmdItem {
                id,
                kind: entry.kind,
                title: entry.title,
                subtitle: entry.subtitle,
                icon,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn cmd_search(
    handle: State<'_, CommandHandle>,
    query: String,
    limit: usize,
) -> Result<Vec<CmdItem>, String> {
    let shared = handle.shared.clone();
    let icons = handle.icons.clone();
    tauri::async_runtime::spawn_blocking(move || search(&shared, &icons, &query, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cmd_launch(
    handle: State<'_, CommandHandle>,
    id: String,
    mode: LaunchMode,
) -> Result<(), String> {
    let entry = handle
        .shared
        .registry
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .resolve(&id, mode)?;
    tauri::async_runtime::spawn_blocking(move || native::launch(&entry, mode))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cmd_currency_rates(
    handle: State<'_, CommandHandle>,
    base: String,
) -> Result<currency::CurrencyRates, String> {
    currency::get(handle.currency_dir.clone(), base, handle.client.clone()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_wakes_and_joins_its_worker_without_an_app_handle() {
        let shared = Arc::new(Shared::default());
        let worker_state = shared.clone();
        let (started, ready) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            while !worker_state.stop.stopped() {
                worker_state.stop.wait(Duration::from_secs(30));
            }
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        let (icons, _) = mpsc::sync_channel(1);
        let handle = CommandHandle {
            shared,
            icons,
            worker: Mutex::new(Some(worker)),
            currency_dir: PathBuf::new(),
            client: currency::client().unwrap(),
        };
        handle.stop();
        assert!(handle.worker.lock().unwrap().is_none());
        assert!(handle.shared.stop.stopped());
        handle.stop(); // idempotent exit + Drop
    }
    #[test]
    fn first_query_uses_available_apps_without_waiting_for_index_or_os() {
        let shared = Shared::default();
        shared
            .apps
            .write()
            .unwrap()
            .push(model::fixture("Editor", model::Kind::App));
        let (sender, receiver) = mpsc::sync_channel(10);
        let result = search(&shared, &sender, "EDIT", 10).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].icon.is_none());
        assert!(receiver.try_recv().is_ok());
        assert_eq!(
            search(&shared, &sender, "edit", 10).unwrap()[0].id,
            result[0].id
        );
        assert!(receiver.try_recv().is_err()); // extraction requested once
        search(&shared, &sender, "", 10).unwrap();
        assert!(
            shared
                .registry
                .lock()
                .unwrap()
                .resolve(&result[0].id, LaunchMode::Open)
                .is_err()
        );
        shared.stop.stop();
        assert!(search(&shared, &sender, "edit", 10).is_err());
    }
}
