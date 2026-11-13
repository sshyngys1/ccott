//! §30. Synced lyrics from LRCLIB with a SQLite cache. Owner: R2.
//!
//! Privacy: the title/artist/album/duration of the playing track leave the computer only when
//! `Settings.lyrics.enabled` is on and the `lyrics` feature is not switched off. Track names are
//! never logged.

mod cache;
mod lrc;
mod normalize;
mod provider;
#[cfg(test)]
mod tests;

use crate::db::{Db, now_ms};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, future::Future, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub time_ms: i64,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Lrclib,
    Cache,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LyricsResult {
    Synced {
        lines: Vec<LyricsLine>,
        source: Source,
    },
    Plain {
        text: String,
        source: Source,
    },
    Instrumental,
    NotFound,
    Error {
        message: String,
    },
}

/// No more than one network lookup per track in this window (also after a failure).
const RETRY_AFTER_MS: i64 = 10 * 60 * 1000;
const MAX_FIELD_CHARS: usize = 300;

pub struct LyricsHandle {
    client: reqwest::Client,
    attempts: Mutex<HashMap<String, i64>>,
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(LyricsHandle {
        client: crate::cmd::currency::client()?,
        attempts: Mutex::new(HashMap::new()),
    });
    Ok(())
}

/// Pure core: cache -> rate limit -> lookup -> cache. The settings gate lives in the command so
/// that this stays testable with an in-memory database and a fake HTTP.
pub(crate) async fn resolve_with<F, Fut>(
    db: &Db,
    attempts: &Mutex<HashMap<String, i64>>,
    http: F,
    now: i64,
    (title, artist, album, duration_ms): (String, String, String, i64),
    force: bool,
) -> LyricsResult
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<(u16, String), String>>,
{
    let key = cache::key(&title, &artist, &album, duration_ms);
    if force {
        // "Retry": forget the cached answer and the 10-minute limit of this track only.
        attempts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        let key = key.clone();
        let _ = db
            .run(move |c| {
                cache::forget(c, &key);
                Ok(())
            })
            .await;
    }
    let cached = {
        let key = key.clone();
        db.run(move |c| Ok(cache::load(c, &key, now))).await
    };
    if let Ok(Some(hit)) = cached {
        return hit;
    }
    {
        let mut map = attempts.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, t| now - *t < RETRY_AFTER_MS);
        if map.contains_key(&key) {
            return LyricsResult::Error {
                message: "A lookup for this track was made recently. Try again later.".into(),
            };
        }
        map.insert(key.clone(), now);
    }
    let result = provider::lookup(http, &title, &artist, &album, duration_ms).await;
    if !matches!(result, LyricsResult::Error { .. }) {
        let stored = result.clone();
        let _ = db
            .run(move |c| {
                cache::store(c, &key, &stored, now);
                Ok(())
            })
            .await;
    }
    result
}

/// The privacy gate: lookups happen only with the setting on and the feature not switched off.
fn permitted(s: &crate::settings::model::Settings) -> bool {
    s.lyrics.enabled && !s.disabled_features.iter().any(|f| f == "lyrics")
}

#[cfg(test)]
pub(crate) async fn resolve<F, Fut>(
    db: &Db,
    attempts: &Mutex<HashMap<String, i64>>,
    http: F,
    now: i64,
    track: (String, String, String, i64),
) -> LyricsResult
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<(u16, String), String>>,
{
    resolve_with(db, attempts, http, now, track, false).await
}

fn allowed(app: &AppHandle) -> bool {
    permitted(&crate::settings::current(app))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri injects app/db/handle state alongside the five contract arguments.
pub async fn lyrics_get(
    app: AppHandle,
    db: State<'_, Db>,
    handle: State<'_, LyricsHandle>,
    title: String,
    artist: String,
    album: String,
    duration_ms: i64,
    force: Option<bool>,
) -> Result<LyricsResult, String> {
    // Never rejects: failures are a value, so the UI shows a state instead of an exception.
    // "Retry" (§30): forget the cached answer and the 10-minute limit for this track before looking it up.
    let force = force.unwrap_or(false);
    if !allowed(&app)
        || title.trim().is_empty()
        || [&title, &artist, &album]
            .iter()
            .any(|s| s.chars().count() > MAX_FIELD_CHARS)
    {
        return Ok(LyricsResult::NotFound);
    }
    let client = handle.client.clone();
    let result = resolve_with(
        &db,
        &handle.attempts,
        move |url| {
            let client = client.clone();
            async move { provider::fetch(&client, url).await }
        },
        now_ms(),
        (title, artist, album, duration_ms.clamp(0, 6 * 3600 * 1000)),
        force,
    )
    .await;
    // The setting may have been switched off while the request was in flight.
    Ok(if allowed(&app) {
        result
    } else {
        LyricsResult::NotFound
    })
}
