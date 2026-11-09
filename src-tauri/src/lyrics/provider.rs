//! LRCLIB lookup. The HTTP layer is injected as `Fn(url) -> (status, body)` so tests need no network.

use super::{LyricsResult, Source, lrc, normalize};
use serde_json::Value;
use std::future::Future;

const BASE: &str = "https://lrclib.net/api";
const MAX_BODY: usize = 2 * 1024 * 1024;
/// Search candidates are accepted within this distance of the playing track.
pub const DURATION_TOLERANCE_S: f64 = 3.0;

pub fn user_agent() -> String {
    format!(
        "CCOTT/{} (+https://github.com/sshyngys1/ccott)",
        env!("CARGO_PKG_VERSION")
    )
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(b))
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn get_url(title: &str, artist: &str, album: &str, duration_ms: i64) -> String {
    let mut url = format!(
        "{BASE}/get?track_name={}&artist_name={}",
        encode(title),
        encode(artist)
    );
    if !album.trim().is_empty() {
        url.push_str(&format!("&album_name={}", encode(album)));
    }
    if duration_ms > 0 {
        url.push_str(&format!("&duration={}", (duration_ms + 500) / 1000));
    }
    url
}

pub fn search_url(title: &str, artist: &str) -> String {
    format!(
        "{BASE}/search?track_name={}&artist_name={}",
        encode(title),
        encode(artist)
    )
}

/// Free-text search: `q` = "artist title".
pub fn search_q_url(artist: &str, title: &str) -> String {
    format!("{BASE}/search?q={}", encode(&format!("{artist} {title}")))
}

/// One LRCLIB record → result. `None` = the record carries no lyrics.
fn from_record(v: &Value) -> Option<LyricsResult> {
    if v["instrumental"].as_bool() == Some(true) {
        return Some(LyricsResult::Instrumental);
    }
    if let Some(synced) = v["syncedLyrics"].as_str() {
        let lines = lrc::parse(synced);
        if lines.iter().any(|l| !l.text.is_empty()) {
            return Some(LyricsResult::Synced {
                lines,
                source: Source::Lrclib,
            });
        }
    }
    let plain = v["plainLyrics"].as_str().map(str::trim)?;
    (!plain.is_empty()).then(|| LyricsResult::Plain {
        text: plain.to_string(),
        source: Source::Lrclib,
    })
}

/// Picks the best search candidate: duration within +-3 s (when both are known), title and artist
/// similar (case, diacritics, punctuation ignored); synced before plain before instrumental, then the
/// closer names, then the nearer duration.
pub fn pick(
    candidates: &Value,
    title: &str,
    artist: &str,
    duration_ms: i64,
) -> Option<LyricsResult> {
    let wanted = duration_ms as f64 / 1000.0;
    let mut best: Option<((u8, u8, u8), f64, LyricsResult)> = None;
    for c in candidates.as_array()? {
        let diff = match c["duration"].as_f64() {
            Some(d) if duration_ms > 0 => (d - wanted).abs(),
            _ => 0.0,
        };
        if diff > DURATION_TOLERANCE_S {
            continue;
        }
        let name = normalize::similarity(title, c["trackName"].as_str().unwrap_or_default());
        let by = if artist.is_empty() {
            2
        } else {
            normalize::similarity(artist, c["artistName"].as_str().unwrap_or_default())
        };
        if name == 0 || by == 0 {
            continue;
        }
        let Some(result) = from_record(c) else {
            continue;
        };
        let rank = match &result {
            LyricsResult::Synced { .. } => 0,
            LyricsResult::Plain { .. } => 1,
            _ => 2,
        };
        // Lower is better: kind, then (2 - name) / (2 - artist) closeness.
        let key = (rank, 2 - name, 2 - by);
        if best.as_ref().is_none_or(|(k, d, _)| (key, diff) < (*k, *d)) {
            best = Some((key, diff, result));
        }
    }
    best.map(|(_, _, r)| r)
}

/// The attempt chain, stopping at the first record that carries lyrics:
/// 1. `get` (normalized title / artist / album / duration), 2. `get` without album,
/// 3. `get` with the title as sent by the player (when cleaning changed it),
/// 4. `search` by track + artist, 5. `search` by `q = "artist title"`.
///
/// A network failure is an `Error`; "nothing anywhere" is `NotFound`.
pub async fn lookup<F, Fut>(
    http: F,
    title: &str,
    artist: &str,
    album: &str,
    duration_ms: i64,
) -> LyricsResult
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<(u16, String), String>>,
{
    let error = |m: &str| LyricsResult::Error { message: m.into() };
    let (clean, by, alb) = (
        normalize::clean_title(title),
        normalize::first_artist(artist),
        normalize::clean_album(album),
    );
    let raw_artist = artist.trim().to_string();
    let mut gets = vec![get_url(&clean, &by, &alb, duration_ms)];
    for url in [
        get_url(&clean, &by, "", duration_ms),
        get_url(title.trim(), &raw_artist, album.trim(), duration_ms),
    ] {
        if !gets.contains(&url) {
            gets.push(url);
        }
    }
    for url in gets {
        let (status, body) = match http(url).await {
            Ok(r) => r,
            Err(m) => return error(&m),
        };
        match status {
            200 => {
                let Ok(v) = serde_json::from_str::<Value>(&body) else {
                    return error("Lyrics provider returned invalid data.");
                };
                if let Some(found) = from_record(&v) {
                    return found;
                }
            }
            404 => {}
            _ => return error("Lyrics provider is unavailable."),
        }
    }
    // A failed search step (network, status, bad JSON) does not end the chain: the next step may still answer.
    let mut failed = false;
    for url in [search_url(&clean, &by), search_q_url(&by, &clean)] {
        let body = match http(url).await {
            Ok((200, body)) => body,
            _ => {
                failed = true;
                continue;
            }
        };
        let Ok(v) = serde_json::from_str::<Value>(&body) else {
            failed = true;
            continue;
        };
        if let Some(found) = pick(&v, &clean, &by, duration_ms) {
            return found;
        }
    }
    if failed {
        return error("Lyrics provider is unavailable.");
    }
    LyricsResult::NotFound
}

/// Real HTTP: one GET, 5 s timeout (set on the shared client), body capped at 2 MB.
pub async fn fetch(client: &reqwest::Client, url: String) -> Result<(u16, String), String> {
    let mut response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, user_agent())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| "Lyrics provider is unreachable.".to_string())?;
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the lyrics response.".to_string())?
    {
        if body.len() + chunk.len() > MAX_BODY {
            return Err("Lyrics response is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}
