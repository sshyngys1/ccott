use super::*;
use serde_json::{Value, json};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};

fn location() -> WeatherLocation {
    WeatherLocation {
        name: "Test city".into(),
        lat: 43.25,
        lon: 76.95,
    }
}
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/open-meteo.json")).unwrap()
}
fn report() -> WeatherReport {
    provider::parse(fixture(), location()).unwrap()
}

#[test]
fn parses_fixture_metric_epoch_local_dates_and_optional_probabilities() {
    let report = report();
    assert_eq!(report.now.temp_c, 18.0);
    assert_eq!(report.now.feels_like_c, 17.0);
    assert_eq!(report.now.wind_kmh, 16.0);
    assert_eq!(report.now.humidity, 68.0);
    assert_eq!(report.now.code, WeatherCode::Partly);
    assert!(report.now.is_day);
    assert_eq!(report.hours.len(), 24);
    assert_eq!(report.days.len(), 7);
    assert_eq!(report.days[0].date, "2026-11-08");
    assert_eq!(report.days[6].date, "2026-11-14");
    assert_eq!(report.hours[0].time, report.updated_at);
    assert_eq!(report.hours[3].precip_prob, None);
    assert_eq!(report.precip_in_min, Some(15));
    assert_eq!(report.precip_kind.as_deref(), Some("rain"));
    assert!(!report.stale);
}

#[test]
fn all_wmo_codes_and_unknown() {
    use WeatherCode::*;
    for (codes, expected) in [
        (vec![0], Clear),
        (vec![1, 2], Partly),
        (vec![3], Cloudy),
        (vec![45, 48], Fog),
        (vec![51, 53, 55], Drizzle),
        (vec![56, 57, 66, 67], Sleet),
        (vec![61, 63, 65, 80, 81, 82], Rain),
        (vec![71, 73, 75, 77, 85, 86], Snow),
        (vec![95, 96, 99], Thunder),
    ] {
        for code in codes {
            assert_eq!(model::wmo(code).unwrap(), expected);
        }
    }
    assert!(model::wmo(4).is_err());
    assert!(model::wmo(1000).is_err());
}

#[test]
fn precipitation_threshold_window_first_interval_and_snow() {
    let mut f = fixture();
    f["minutely_15"]["precipitation"] = json!([0.09, 0.1, 2, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        provider::parse(f.clone(), location())
            .unwrap()
            .precip_in_min,
        Some(0)
    );
    f["hourly"]["weather_code"][0] = json!(71);
    assert_eq!(
        provider::parse(f.clone(), location())
            .unwrap()
            .precip_kind
            .as_deref(),
        Some("snow")
    );
    f["hourly"]["weather_code"][0] = json!(61);
    f["hourly"]["temperature_2m"][0] = json!(-1);
    assert_eq!(
        provider::parse(f.clone(), location())
            .unwrap()
            .precip_kind
            .as_deref(),
        Some("snow")
    );
    f["minutely_15"]["precipitation"] = json!([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let dry = provider::parse(f.clone(), location()).unwrap();
    assert_eq!(dry.precip_in_min, None);
    assert_eq!(dry.precip_kind, None);
    f["minutely_15"]["time"] = json!([f["current"]["time"].as_i64().unwrap() + 9000]);
    f["minutely_15"]["precipitation"] = json!([10]);
    assert_eq!(provider::parse(f, location()).unwrap().precip_in_min, None);
}

#[test]
fn rejects_partial_and_invalid_provider_data() {
    for (section, field, invalid) in [
        ("current", "temperature_2m", Value::Null),
        ("current", "relative_humidity_2m", json!(101)),
        ("hourly", "temperature_2m", json!([1])),
        ("daily", "time", json!([])),
        ("minutely_15", "precipitation", Value::Null),
    ] {
        let mut f = fixture();
        f[section][field] = invalid;
        assert!(provider::parse(f, location()).is_err(), "{section}.{field}");
    }
}

#[test]
fn cache_fresh_force_expiry_offline_missing_corrupt_and_location() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("weather-cache-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("weather.json");
    let calls = AtomicUsize::new(0);
    let now = 100_000_000;
    tauri::async_runtime::block_on(async {
        let fresh = cache::get(&path, location(), false, now, |_| async {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(report())
        })
        .await
        .unwrap();
        assert!(!fresh.stale);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        let cached = cache::get(
            &path,
            location(),
            false,
            now + cache::FRESH_MS - 1,
            |_| async { panic!("fresh cache must avoid HTTP") },
        )
        .await
        .unwrap();
        assert!(!cached.stale);
        assert_eq!(
            cache::next_refresh(&path, now + cache::FRESH_MS - 1, false),
            Duration::from_millis(1)
        );
        assert!(
            cache::get(&path, location(), true, now + 1, |_| async {
                Err("offline".into())
            })
            .await
            .unwrap()
            .stale
        );
        assert!(
            cache::get(&path, location(), false, now + cache::FRESH_MS, |_| async {
                Err("offline".into())
            })
            .await
            .unwrap()
            .stale
        );
        let mut changed = location();
        changed.lon = -1.0;
        assert!(
            cache::get(&path, changed, false, now, |_| async {
                Err("offline".into())
            })
            .await
            .is_err()
        );
        let updated = cache::get(&path, location(), true, now + 2, |_| async {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(report())
        })
        .await
        .unwrap();
        assert!(!updated.stale);
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        std::fs::write(&path, b"broken").unwrap();
        assert!(
            cache::get(&path, location(), false, now, |_| async {
                Err("offline".into())
            })
            .await
            .is_err()
        );
        std::fs::remove_file(&path).unwrap();
        assert!(
            cache::get(&path, location(), false, now, |_| async {
                Err("offline".into())
            })
            .await
            .is_err()
        );
    });
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn worker_starts_once_stops_joins_and_restarts_without_network() {
    let worker = Worker::default();
    for _ in 0..3 {
        let (tx, rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        worker
            .start(move |stop| {
                tx.send(()).unwrap();
                stop.wait(Duration::from_secs(1800));
                done_tx.send(()).unwrap();
            })
            .unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.start(|_| panic!("duplicate worker")).unwrap();
        worker.stop();
        done_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(worker.0.lock().unwrap().is_none());
        worker.stop();
    }
}

#[test]
fn location_debug_redacts_coordinates() {
    let debug = format!("{:?}", location());
    assert!(!debug.contains("43.25"));
    assert!(!debug.contains("76.95"));
}

#[test]
fn refresh_configuration_requires_enabled_feature_and_a_location() {
    let mut settings = crate::settings::Settings::default();
    assert_eq!(active_location(settings.clone()), None);
    settings.weather_location = Some(location());
    assert_eq!(active_location(settings.clone()), Some(location()));
    settings.disabled_features = vec!["weather".into()];
    assert_eq!(active_location(settings.clone()), None);
    settings.disabled_features = vec!["battery".into()];
    assert_eq!(active_location(settings), Some(location()));
}
