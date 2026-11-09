use super::model::*;
use serde::{Deserialize, Serialize};
use std::{future::Future, path::Path};
pub const FRESH_MS: i64 = 30 * 60 * 1000;
#[derive(Serialize, Deserialize)]
struct Cached {
    fetched_at: i64,
    report: WeatherReport,
}

pub fn next_refresh(path: &Path, now: i64, stale: bool) -> std::time::Duration {
    let remaining = if stale {
        FRESH_MS
    } else {
        std::fs::File::open(path)
            .ok()
            .and_then(|f| serde_json::from_reader::<_, Cached>(f).ok())
            .map_or(FRESH_MS, |c| {
                (c.fetched_at + FRESH_MS - now).clamp(1, FRESH_MS)
            })
    };
    std::time::Duration::from_millis(remaining as u64)
}

pub async fn get<F, Fut>(
    path: &Path,
    location: WeatherLocation,
    force: bool,
    now: i64,
    fetch: F,
) -> Result<WeatherReport, String>
where
    F: FnOnce(WeatherLocation) -> Fut,
    Fut: Future<Output = Result<WeatherReport, String>>,
{
    let cached = std::fs::File::open(path)
        .ok()
        .filter(|f| f.metadata().is_ok_and(|m| m.len() < 512 * 1024))
        .and_then(|f| serde_json::from_reader::<_, Cached>(f).ok())
        .filter(|c| {
            c.report.location == location && c.report.hours.len() == 24 && c.report.days.len() == 7
        });
    if !force
        && let Some(c) = &cached
        && (0..FRESH_MS).contains(&(now - c.fetched_at))
    {
        let mut report = c.report.clone();
        report.stale = false;
        return Ok(report);
    }
    match fetch(location).await {
        Ok(mut report) => {
            report.stale = false;
            let cached = Cached { fetched_at: now, report: report.clone() };
            // Serialized by the weather request gate; an atomic replace keeps the last good report.
            let temp = path.with_extension("json.tmp");
            let save = || -> std::io::Result<()> {
                use std::io::Write;
                if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
                let mut file = std::fs::File::create(&temp)?;
                file.write_all(&serde_json::to_vec(&cached)?)?; file.sync_all()?;
                std::fs::rename(&temp, path)
            };
            if save().is_err() { let _ = std::fs::remove_file(temp); }
            Ok(report)
        }
        Err(_) => cached.map(|mut c| { c.report.stale = true; c.report })
            .ok_or_else(|| "Weather is unavailable: no internet connection and no saved forecast for this place.".into()),
    }
}
