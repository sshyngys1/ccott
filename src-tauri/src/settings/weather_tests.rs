use super::model::{Settings, WeatherUnits};
use serde_json::json;

#[test]
fn weather_defaults_legacy_json_and_roundtrip() {
    let defaults = Settings::default();
    assert!(defaults.weather_location.is_none());
    assert_eq!(defaults.weather_units, WeatherUnits::C);
    let mut legacy = serde_json::to_value(&defaults).unwrap();
    legacy.as_object_mut().unwrap().remove("weatherLocation");
    legacy.as_object_mut().unwrap().remove("weatherUnits");
    assert_eq!(Settings::from_json_lossy(&legacy), defaults);
    assert_eq!(
        serde_json::from_value::<Settings>(legacy).unwrap(),
        defaults
    );
    let mut settings = defaults;
    assert!(
        settings
            .merge_json(
                &json!({"weatherLocation":{"lat":-90,"lon":180,"name":"City"},"weatherUnits":"f"})
            )
            .is_empty()
    );
    assert_eq!(settings.weather_units, WeatherUnits::F);
    assert_eq!(
        serde_json::from_value::<Settings>(serde_json::to_value(&settings).unwrap()).unwrap(),
        settings
    );
    assert!(
        settings
            .merge_json(&json!({"weatherLocation":null}))
            .is_empty()
    );
    assert!(settings.weather_location.is_none());
}

#[test]
fn weather_rejects_invalid_values_preserving_previous_fields() {
    let mut settings = Settings::default();
    for value in [
        json!(true),
        json!([]),
        json!({}),
        json!({"lat":91,"lon":0,"name":"City"}),
        json!({"lat":0,"lon":-181,"name":"City"}),
        json!({"lat":"1","lon":0,"name":"City"}),
        json!({"lat":0,"lon":0,"name":""}),
        json!({"lat":0,"lon":0,"name":"  "}),
        json!({"lat":0,"lon":0,"name":"a".repeat(121)}),
    ] {
        let before = settings.clone();
        assert_eq!(
            settings.merge_json(&json!({"weatherLocation":value})),
            ["weatherLocation"]
        );
        assert_eq!(settings, before);
    }
    for value in [
        json!(null),
        json!(true),
        json!("C"),
        json!("kelvin"),
        json!(0),
    ] {
        assert_eq!(
            settings.merge_json(&json!({"weatherUnits":value})),
            ["weatherUnits"]
        );
        assert_eq!(settings.weather_units, WeatherUnits::C);
    }
    for (lat, lon) in [(-90.0, -180.0), (90.0, 180.0), (0.0, 0.0)] {
        assert!(
            settings
                .merge_json(
                    &json!({"weatherLocation":{"lat":lat,"lon":lon,"name":"я".repeat(120)}})
                )
                .is_empty()
        );
    }
}

#[test]
fn weather_disk_roundtrip_and_lossy_invalid_fields() {
    let mut settings = Settings::default();
    settings.merge_json(
        &json!({"weatherLocation":{"lat":43.25,"lon":76.95,"name":"City"},"weatherUnits":"f"}),
    );
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("weather-settings-{}.json", std::process::id()));
    super::store::save(&path, &settings).unwrap();
    assert_eq!(super::store::load(&path).0, settings);
    std::fs::write(&path, r#"{"weatherLocation":{"lat":999,"lon":0,"name":"City"},"weatherUnits":"bad","doNotDisturb":true}"#).unwrap();
    let loaded = super::store::load(&path).0;
    assert!(loaded.weather_location.is_none());
    assert_eq!(loaded.weather_units, WeatherUnits::C);
    assert!(loaded.do_not_disturb);
    std::fs::remove_file(path).unwrap();
}
