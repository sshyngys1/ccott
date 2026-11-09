//! All lyrics in this file are invented placeholder text; no real song text is allowed in the repository.

use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

const LRC: &str = "[ar:Test Artist]\n[ti:Test Title]\n[offset:+500]\n\
[00:10.00]First invented line\n\
[00:05.5][00:30.25]Shared invented line\n\
[00:20]\n\
[01:02.123]<01:02.12>Word <01:02.50>tags\n\
no tag here\n\
[bad]Broken\n";

fn texts(lines: &[LyricsLine]) -> Vec<(i64, &str)> {
    lines.iter().map(|l| (l.time_ms, l.text.as_str())).collect()
}

#[test]
fn lrc_parses_tags_offset_order_and_breaks() {
    let lines = lrc::parse(LRC);
    // offset +500 shifts every line 500 ms earlier; sorted by time; empty line = break.
    assert_eq!(
        texts(&lines),
        [
            (5000, "Shared invented line"),
            (9500, "First invented line"),
            (19500, ""),
            (29750, "Shared invented line"),
            (61623, "Word tags"),
        ]
    );
}

#[test]
fn lrc_negative_offset_clamps_and_fraction_digits_scale() {
    let lines = lrc::parse("[offset:-250]\n[00:00.1]a\n[00:01.12]b\n[00:02.123456]c\n[0:03]d");
    assert_eq!(
        texts(&lines),
        [(350, "a"), (1370, "b"), (2373, "c"), (3250, "d")]
    );
    assert_eq!(lrc::parse("[offset:+9000]\n[00:01.00]x")[0].time_ms, 0);
    assert!(lrc::parse("no times\n[ti:x]").is_empty());
}

fn record(synced: Option<&str>, plain: Option<&str>, duration: f64) -> serde_json::Value {
    json!({"duration": duration, "instrumental": false, "trackName": "Invented Title",
        "artistName": "Invented Artist", "syncedLyrics": synced, "plainLyrics": plain})
}

#[test]
fn pick_uses_duration_window_and_prefers_synced() {
    let list = json!([
        record(Some("[00:01.00]far away"), None, 300.0),
        record(None, Some("plain near"), 200.0),
        record(Some("[00:01.00]synced edge"), None, 202.9),
        record(Some("[00:01.00]synced exact"), None, 200.2),
    ]);
    match provider::pick(&list, "Invented Title", "Invented Artist", 200_000) {
        Some(LyricsResult::Synced { lines, .. }) => assert_eq!(lines[0].text, "synced exact"),
        other => panic!("{other:?}"),
    }
    let only_far = json!([record(Some("[00:01.00]x"), None, 203.5)]);
    assert_eq!(
        provider::pick(&only_far, "Invented Title", "Invented Artist", 200_000),
        None
    );
    let plain = json!([record(None, Some("plain near"), 198.5)]);
    assert!(matches!(
        provider::pick(&plain, "Invented Title", "Invented Artist", 200_000),
        Some(LyricsResult::Plain { .. })
    ));
}

#[test]
fn url_is_percent_encoded_and_rounds_duration() {
    let url = provider::get_url("Тест & co", "A B", "", 200_499);
    assert_eq!(
        url,
        "https://lrclib.net/api/get?track_name=%D0%A2%D0%B5%D1%81%D1%82%20%26%20co&artist_name=A%20B&duration=200"
    );
    assert!(provider::get_url("t", "a", "alb", 0).ends_with("&album_name=alb"));
    assert!(provider::user_agent().starts_with("CCOTT/"));
}

fn db() -> Db {
    Db::new(crate::db::open_in_memory())
}
fn track() -> (String, String, String, i64) {
    (
        "Invented Title".into(),
        "Invented Artist".into(),
        "Album".into(),
        200_000,
    )
}

/// Fake HTTP: counts calls; `routes` map a URL fragment to (status, body).
fn http(
    calls: &'static AtomicUsize,
    routes: Vec<(&'static str, u16, String)>,
) -> impl Fn(String) -> std::future::Ready<Result<(u16, String), String>> {
    move |url: String| {
        calls.fetch_add(1, Ordering::SeqCst);
        let hit = routes.iter().find(|(frag, ..)| url.contains(frag));
        std::future::ready(match hit {
            Some((_, status, body)) => Ok((*status, body.clone())),
            None => Err("offline".into()),
        })
    }
}

fn run<T>(f: impl Future<Output = T>) -> T {
    tauri::async_runtime::block_on(f)
}

#[test]
fn get_hit_is_cached_and_second_call_uses_no_network() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let body = record(Some("[00:01.00]one\n[00:02.00]two"), None, 200.0).to_string();
    let routes = vec![("/api/get", 200, body)];
    let first = run(resolve(
        &db,
        &attempts,
        http(&CALLS, routes.clone()),
        1_000,
        track(),
    ));
    assert!(
        matches!(&first, LyricsResult::Synced { source: Source::Lrclib, lines } if lines.len() == 2)
    );
    assert_eq!(CALLS.load(Ordering::SeqCst), 1);
    let second = run(resolve(
        &db,
        &attempts,
        http(&CALLS, routes),
        2_000,
        track(),
    ));
    assert!(matches!(
        second,
        LyricsResult::Synced {
            source: Source::Cache,
            ..
        }
    ));
    assert_eq!(CALLS.load(Ordering::SeqCst), 1);
}

#[test]
fn get_404_falls_back_to_search_with_duration_match() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let search = json!([
        record(Some("[00:01.00]wrong cut"), None, 260.0),
        record(Some("[00:01.00]right cut"), None, 201.0),
    ])
    .to_string();
    let routes = vec![("/api/get", 404, "{}".into()), ("/api/search", 200, search)];
    match run(resolve(&db, &attempts, http(&CALLS, routes), 1, track())) {
        LyricsResult::Synced { lines, .. } => assert_eq!(lines[0].text, "right cut"),
        other => panic!("{other:?}"),
    }
    assert_eq!(CALLS.load(Ordering::SeqCst), 3); // get, get without album, search
}

#[test]
fn instrumental_and_plain_are_recognised_and_cached() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let inst = json!({"instrumental": true, "duration": 200}).to_string();
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 200, inst)]),
        1,
        track(),
    ));
    assert_eq!(r, LyricsResult::Instrumental);
    assert_eq!(
        run(resolve(&db, &attempts, http(&CALLS, vec![]), 2, track())),
        LyricsResult::Instrumental
    );
    let plain = record(None, Some("  invented plain text \n"), 200.0).to_string();
    let other = (
        "Second".to_string(),
        "Invented Artist".to_string(),
        String::new(),
        200_000,
    );
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 200, plain)]),
        3,
        other,
    ));
    assert!(matches!(r, LyricsResult::Plain { ref text, .. } if text == "invented plain text"));
}

#[test]
fn not_found_is_cached_for_one_day_then_asked_again() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let routes = vec![
        ("/api/get", 404, "{}".into()),
        ("/api/search", 200, "[]".into()),
    ];
    let day = 24 * 3600 * 1000;
    assert_eq!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, routes.clone()),
            0,
            track()
        )),
        LyricsResult::NotFound
    );
    assert_eq!(CALLS.load(Ordering::SeqCst), 4); // 2x get, 2x search
    assert_eq!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, routes.clone()),
            day * 9 / 10,
            track()
        )),
        LyricsResult::NotFound
    );
    assert_eq!(CALLS.load(Ordering::SeqCst), 4, "still fresh");
    run(resolve(
        &db,
        &attempts,
        http(&CALLS, routes),
        day + 1,
        track(),
    ));
    assert_eq!(CALLS.load(Ordering::SeqCst), 8, "expired -> asked again");
}

#[test]
fn errors_are_values_not_cached_and_rate_limited_to_one_request_per_ten_minutes() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let minute = 60_000;
    let r = run(resolve(&db, &attempts, http(&CALLS, vec![]), 0, track()));
    assert!(matches!(r, LyricsResult::Error { .. }));
    assert_eq!(CALLS.load(Ordering::SeqCst), 1);
    // Within 10 minutes: no new request, still an error value.
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![]),
        9 * minute,
        track(),
    ));
    assert!(matches!(r, LyricsResult::Error { .. }));
    assert_eq!(CALLS.load(Ordering::SeqCst), 1);
    // After 10 minutes the lookup is tried again and can succeed (error was not cached).
    let body = record(Some("[00:01.00]late"), None, 200.0).to_string();
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 200, body)]),
        10 * minute,
        track(),
    ));
    assert!(matches!(r, LyricsResult::Synced { .. }));
    assert_eq!(CALLS.load(Ordering::SeqCst), 2);
    // Server errors and garbage are errors too.
    let other = ("Other".to_string(), "X".to_string(), String::new(), 1000);
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 500, "".into())]),
        0,
        other,
    ));
    assert!(matches!(r, LyricsResult::Error { .. }));
    let other = ("Other2".to_string(), "X".to_string(), String::new(), 1000);
    let r = run(resolve(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 200, "<html>".into())]),
        0,
        other,
    ));
    assert!(matches!(r, LyricsResult::Error { .. }));
}

#[test]
fn cache_key_normalises_text_and_buckets_duration() {
    let a = cache::key("  Some   Title ", "ARTIST", "Al", 200_000);
    assert_eq!(a, "some title|artist|al|100");
    assert_eq!(cache::key("some title", "artist", "al", 200_900), a);
    assert_ne!(cache::key("some title", "artist", "al", 204_000), a);
}

#[test]
fn serializes_to_the_contract_shape() {
    let synced = LyricsResult::Synced {
        lines: vec![LyricsLine {
            time_ms: 1,
            text: "a".into(),
        }],
        source: Source::Cache,
    };
    assert_eq!(
        serde_json::to_value(synced).unwrap(),
        json!({"status":"synced","lines":[{"timeMs":1,"text":"a"}],"source":"cache"})
    );
    assert_eq!(
        serde_json::to_value(LyricsResult::NotFound).unwrap(),
        json!({"status":"notFound"})
    );
    assert_eq!(
        serde_json::to_value(LyricsResult::Plain {
            text: "t".into(),
            source: Source::Lrclib
        })
        .unwrap(),
        json!({"status":"plain","text":"t","source":"lrclib"})
    );
    assert_eq!(
        serde_json::to_value(LyricsResult::Error {
            message: "m".into()
        })
        .unwrap(),
        json!({"status":"error","message":"m"})
    );
}

#[test]
fn disabled_setting_or_feature_means_no_lookup() {
    use crate::settings::model::Settings;
    let mut s = Settings::default();
    assert!(permitted(&s));
    s.lyrics.enabled = false;
    assert!(!permitted(&s));
    s.lyrics.enabled = true;
    s.disabled_features = vec!["lyrics".into()];
    assert!(!permitted(&s));
}

/// Records every requested URL; answers with the first route whose fragment the URL contains.
fn recording_http(
    urls: &'static Mutex<Vec<String>>,
    routes: Vec<(&'static str, u16, String)>,
) -> impl Fn(String) -> std::future::Ready<Result<(u16, String), String>> {
    move |url: String| {
        urls.lock().unwrap().push(url.clone());
        let hit = routes.iter().find(|(frag, ..)| url.contains(frag));
        std::future::ready(match hit {
            Some((_, status, body)) => Ok((*status, body.clone())),
            None => Err("offline".into()),
        })
    }
}

fn named(title: &str, artist: &str, synced: &str, duration: f64) -> serde_json::Value {
    json!({"trackName": title, "artistName": artist, "duration": duration,
        "instrumental": false, "syncedLyrics": synced, "plainLyrics": null})
}

#[test]
fn chain_cleans_the_names_and_falls_through_to_the_free_text_search() {
    static URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let q_hits = json!([
        named(
            "Night Signal (Instrumental)",
            "Someone Else",
            "[00:01.00]wrong",
            200.0
        ),
        named("night signal", "INVENTED ARTIST", "[00:01.00]right", 202.5),
    ])
    .to_string();
    let routes = vec![
        ("/api/get", 404, "{}".into()),
        ("search?track_name=", 200, "[]".into()),
        ("search?q=", 200, q_hits),
    ];
    let track = (
        "Night Signal (feat. Guest) - Remastered 2020".to_string(),
        "Invented Artist, Guest".to_string(),
        "Night Shift (Deluxe)".to_string(),
        200_000,
    );
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let result = run(resolve(
        &db,
        &attempts,
        recording_http(&URLS, routes),
        0,
        track,
    ));
    match result {
        LyricsResult::Synced { lines, .. } => assert_eq!(lines[0].text, "right"),
        other => panic!("{other:?}"),
    }
    let urls = URLS.lock().unwrap().clone();
    let base = "https://lrclib.net/api";
    assert_eq!(
        urls,
        [
            // 1. get with cleaned title, first artist, cleaned album, duration
            format!(
                "{base}/get?track_name=Night%20Signal&artist_name=Invented%20Artist&album_name=Night%20Shift&duration=200"
            ),
            // 2. get without album
            format!(
                "{base}/get?track_name=Night%20Signal&artist_name=Invented%20Artist&duration=200"
            ),
            // 3. get exactly as the player reported it
            format!(
                "{base}/get?track_name=Night%20Signal%20%28feat.%20Guest%29%20-%20Remastered%202020&artist_name=Invented%20Artist%2C%20Guest&album_name=Night%20Shift%20%28Deluxe%29&duration=200"
            ),
            // 4. search by track + artist
            format!("{base}/search?track_name=Night%20Signal&artist_name=Invented%20Artist"),
            // 5. free text "artist title"
            format!("{base}/search?q=Invented%20Artist%20Night%20Signal"),
        ]
    );
}

#[test]
fn chain_stops_at_the_first_hit() {
    static URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let body = named("Night Signal", "Invented Artist", "[00:01.00]first", 200.0).to_string();
    // The strict get misses (404), the album-less get hits.
    let routes = vec![("album_name=", 404, "{}".into()), ("/api/get", 200, body)];
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let r = run(resolve(
        &db,
        &attempts,
        recording_http(&URLS, routes),
        0,
        track(),
    ));
    assert!(matches!(r, LyricsResult::Synced { .. }));
    assert_eq!(URLS.lock().unwrap().len(), 2);
}

#[test]
fn a_get_record_without_lyrics_does_not_end_the_chain() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let empty = json!({"trackName":"Invented Title","artistName":"Invented Artist","duration":200,
        "instrumental":false,"syncedLyrics":null,"plainLyrics":null})
    .to_string();
    let hit = json!([named(
        "Invented Title",
        "Invented Artist",
        "[00:01.00]found",
        199.0
    )])
    .to_string();
    let routes = vec![("/api/get", 200, empty), ("search?track_name=", 200, hit)];
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let r = run(resolve(&db, &attempts, http(&CALLS, routes), 0, track()));
    assert!(matches!(r, LyricsResult::Synced { .. }));
}

#[test]
fn search_rejects_unrelated_names_and_prefers_synced_over_plain() {
    let list = json!([
        named(
            "Completely Different",
            "Invented Artist",
            "[00:01.00]no",
            200.0
        ),
        named("Invented Title", "Somebody Else", "[00:01.00]no", 200.0),
        json!({"trackName":"Invented Title","artistName":"Invented Artist","duration":200.0,
            "instrumental":false,"syncedLyrics":null,"plainLyrics":"plain only"}),
        named("Invented Title!", "invented artist", "[00:01.00]yes", 202.9),
    ]);
    match provider::pick(&list, "Invented Title", "Invented Artist", 200_000) {
        Some(LyricsResult::Synced { lines, .. }) => assert_eq!(lines[0].text, "yes"),
        other => panic!("{other:?}"),
    }
    let only_wrong = json!([named(
        "Completely Different",
        "Invented Artist",
        "[00:01.00]no",
        200.0
    )]);
    assert_eq!(
        provider::pick(&only_wrong, "Invented Title", "Invented Artist", 200_000),
        None
    );
}

#[test]
fn retry_forgets_the_cache_and_the_ten_minute_limit_of_that_track() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let miss = vec![
        ("/api/get", 404, "{}".into()),
        ("/api/search", 200, "[]".into()),
    ];
    assert_eq!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, miss.clone()),
            0,
            track()
        )),
        LyricsResult::NotFound
    );
    assert_eq!(CALLS.load(Ordering::SeqCst), 4);
    // Normal call: still cached as notFound, no network.
    assert_eq!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, miss.clone()),
            1000,
            track()
        )),
        LyricsResult::NotFound
    );
    assert_eq!(CALLS.load(Ordering::SeqCst), 4);
    // Retry: the lookup runs again and can now succeed.
    let body = record(Some("[00:01.00]now"), None, 200.0).to_string();
    let r = run(resolve_with(
        &db,
        &attempts,
        http(&CALLS, vec![("/api/get", 200, body)]),
        2000,
        track(),
        true,
    ));
    assert!(matches!(r, LyricsResult::Synced { .. }));
    assert_eq!(CALLS.load(Ordering::SeqCst), 5);
    // After an error the 10-minute limit is also lifted by a retry.
    let other = ("Other".to_string(), "X".to_string(), String::new(), 1000);
    assert!(matches!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, vec![]),
            0,
            other.clone()
        )),
        LyricsResult::Error { .. }
    ));
    assert!(matches!(
        run(resolve(
            &db,
            &attempts,
            http(&CALLS, vec![]),
            1,
            other.clone()
        )),
        LyricsResult::Error { .. }
    ));
    assert_eq!(CALLS.load(Ordering::SeqCst), 6, "limited");
    run(resolve_with(
        &db,
        &attempts,
        http(&CALLS, vec![]),
        2,
        other,
        true,
    ));
    assert_eq!(CALLS.load(Ordering::SeqCst), 7, "retry bypasses the limit");
}

#[test]
fn a_failed_search_step_does_not_end_the_chain() {
    static URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let hit = json!([named(
        "Invented Title",
        "Invented Artist",
        "[00:01.00]found",
        200.0
    )])
    .to_string();
    // Gets miss, the first search fails (no route = network error), the free-text search answers.
    let routes = vec![("/api/get", 404, "{}".into()), ("search?q=", 200, hit)];
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    let r = run(resolve(
        &db,
        &attempts,
        recording_http(&URLS, routes),
        0,
        track(),
    ));
    assert!(matches!(r, LyricsResult::Synced { .. }), "{r:?}");
    assert_eq!(URLS.lock().unwrap().len(), 4);
}

#[test]
fn error_only_when_no_search_answered_and_one_failed() {
    static URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let (db, attempts) = (db(), Mutex::new(HashMap::new()));
    // First search fails, second answers with nothing: still an error (the first one was never answered).
    let routes = vec![
        ("/api/get", 404, "{}".into()),
        ("search?q=", 200, "[]".into()),
    ];
    let r = run(resolve(
        &db,
        &attempts,
        recording_http(&URLS, routes),
        0,
        track(),
    ));
    assert!(matches!(r, LyricsResult::Error { .. }), "{r:?}");
    assert_eq!(URLS.lock().unwrap().len(), 4);
    // Both answer with nothing: notFound.
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let other = ("Other".to_string(), "X".to_string(), String::new(), 1000);
    let routes = vec![
        ("/api/get", 404, "{}".into()),
        ("/api/search", 200, "[]".into()),
    ];
    let r = run(resolve(&db, &attempts, http(&CALLS, routes), 0, other));
    assert_eq!(r, LyricsResult::NotFound);
}
