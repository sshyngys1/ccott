mod cache;
pub mod model;
mod provider;
#[cfg(test)]
mod tests;

use crate::system::worker::{Control, WorkerApp, with_app};
use model::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct Worker(Mutex<Option<(Arc<Control>, JoinHandle<()>)>>);
impl Worker {
    fn stop(&self) {
        if let Some((stop, thread)) = self.0.lock().unwrap().take() {
            stop.stop();
            let _ = thread.join();
        }
    }
    fn start(&self, run: impl FnOnce(Arc<Control>) + Send + 'static) -> std::io::Result<()> {
        let mut worker = self.0.lock().unwrap();
        if worker.is_none() {
            let stop = Arc::new(Control::default());
            let signal = stop.clone();
            *worker = Some((
                stop,
                std::thread::Builder::new()
                    .name("weather-refresh".into())
                    .spawn(move || run(signal))?,
            ));
        }
        Ok(())
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop();
    }
}

pub struct WeatherHandle {
    worker: Worker,
    app: WorkerApp,
    path: PathBuf,
    client: reqwest::Client,
    gate: Arc<tokio::sync::Mutex<()>>,
    configuration: Mutex<Option<WeatherLocation>>,
}

fn active_location(settings: crate::settings::Settings) -> Option<WeatherLocation> {
    if settings.disabled_features.iter().any(|f| f == "weather") {
        None
    } else {
        settings.weather_location
    }
}
pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(WeatherHandle {
        worker: Worker::default(),
        app: worker_app,
        path: app.path().app_data_dir()?.join("weather.json"),
        client: crate::cmd::currency::client()?,
        gate: Arc::new(tokio::sync::Mutex::new(())),
        configuration: Mutex::new(None),
    });
    configure(app.handle());
    Ok(())
}
pub fn configure(app: &AppHandle) {
    let Some(handle) = app.try_state::<WeatherHandle>() else {
        return;
    };
    let desired = active_location(crate::settings::current(app));
    let mut previous = handle.configuration.lock().unwrap();
    if *previous == desired {
        return;
    }
    handle.worker.stop();
    *previous = desired.clone();
    if let Some(location) = desired {
        let (app, path, client, gate) = (
            handle.app.clone(),
            handle.path.clone(),
            handle.client.clone(),
            handle.gate.clone(),
        );
        if handle
            .worker
            .start(move |stop| {
                while !stop.stopped() && app.strong_count() > 0 {
                    let result = tauri::async_runtime::block_on(async {
                        let _guard = gate.lock().await;
                        if stop.stopped() {
                            return Err("Weather disabled.".into());
                        }
                        cache::get(&path, location.clone(), false, now_ms(), |l| {
                            provider::fetch(&client, l)
                        })
                        .await
                    });
                    let wait = cache::next_refresh(
                        &path,
                        now_ms(),
                        match &result {
                            Ok(r) => r.stale,
                            Err(_) => true,
                        },
                    );
                    if !stop.stopped()
                        && let Ok(report) = result
                    {
                        with_app(&app, |app| {
                            let _ = app.emit("weather://changed", report);
                        });
                    }
                    stop.wait(wait);
                }
            })
            .is_err()
        {
            log::error!("weather: cannot start refresh worker");
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(h) = app.try_state::<WeatherHandle>() {
        h.worker.stop();
    }
}
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[tauri::command]
pub async fn weather_get(
    app: AppHandle,
    force: Option<bool>,
) -> Result<Option<WeatherReport>, String> {
    let handle = app.state::<WeatherHandle>();
    let _guard = handle.gate.lock().await;
    let settings = crate::settings::current(&app);
    if settings.disabled_features.iter().any(|f| f == "weather") {
        return Ok(None);
    }
    let Some(location) = settings.weather_location else {
        return Ok(None);
    };
    let report = cache::get(
        &handle.path,
        location.clone(),
        force.unwrap_or(false),
        now_ms(),
        |l| provider::fetch(&handle.client, l),
    )
    .await?;
    let current = crate::settings::current(&app);
    if current.weather_location.as_ref() != Some(&location)
        || current.disabled_features.iter().any(|f| f == "weather")
    {
        return Ok(None);
    }
    let _ = app.emit("weather://changed", &report);
    Ok(Some(report))
}
#[tauri::command]
pub async fn weather_search_location(
    app: AppHandle,
    query: String,
    lang: String,
) -> Result<Vec<WeatherLocation>, String> {
    provider::search(&app.state::<WeatherHandle>().client, query, lang).await
}

#[tauri::command]
pub async fn weather_locate(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<WeatherLocation, String> {
    // The island normally uses NOACTIVATE. A direct click on Locate must also be able to
    // request consent, without requiring the user to focus the city input first.
    let temporary_focus = window.label() == "island" && !window.is_focused().unwrap_or(false);
    if temporary_focus {
        crate::window::island_set_keyboard_focus(app.clone(), true).await?;
    }
    let result = locate(&app).await;
    if temporary_focus {
        let _ = crate::window::island_set_keyboard_focus(app, false).await;
    }
    result
}

async fn locate(app: &AppHandle) -> Result<WeatherLocation, String> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    // Consent must be requested on the foreground UI thread. Do not block it awaiting the result.
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(Geolocator::RequestAccessAsync().map_err(|_| {
            "Location permission is unavailable. Choose a city manually.".to_string()
        }));
    })
    .map_err(|_| "Could not request location permission.")?;
    let access = rx
        .await
        .map_err(|_| "Location permission is unavailable.")??;
    let access = tokio::time::timeout(Duration::from_secs(60), access)
        .await
        .map_err(|_| "Location permission timed out. Choose a city manually.")?
        .map_err(|_| "Location access is unavailable. Choose a city manually.")?;
    if access != GeolocationAccessStatus::Allowed {
        return Err("Location access was denied. Allow location in Windows Settings or choose a city manually.".into());
    }
    let locator = Geolocator::new().map_err(|_| "Windows location services are unavailable.")?;
    let operation = locator
        .GetGeopositionAsyncWithAgeAndTimeout(
            windows::Foundation::TimeSpan {
                Duration: 5 * 60 * 10_000_000,
            },
            windows::Foundation::TimeSpan {
                Duration: 15 * 10_000_000,
            },
        )
        .map_err(|_| "Windows could not determine your location. Choose a city manually.")?;
    let position = tokio::time::timeout(Duration::from_secs(20), operation)
        .await
        .map_err(|_| "Location request timed out. Choose a city manually.")?
        .map_err(|_| "Windows could not determine your location. Choose a city manually.")?;
    let point = position
        .Coordinate()
        .and_then(|c| c.Point())
        .and_then(|p| p.Position())
        .map_err(|_| "Windows returned an invalid location.")?;
    let language = crate::settings::current(app).language;
    let ru = match language {
        crate::settings::model::LanguageMode::Ru => true,
        crate::settings::model::LanguageMode::En => false,
        // SAFETY: GetUserDefaultUILanguage has no preconditions.
        _ => unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() & 0x3ff == 0x19 },
    };
    let location = WeatherLocation {
        name: if ru {
            "Моё местоположение"
        } else {
            "My location"
        }
        .into(),
        lat: point.Latitude,
        lon: point.Longitude,
    };
    if !location.valid() {
        return Err("Windows returned an invalid location.".into());
    }
    Ok(location)
}
