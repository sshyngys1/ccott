use super::model::{LyricsSettings, Settings};
use serde_json::json;

#[test]
fn lyrics_defaults_legacy_json_and_roundtrip() {
    let defaults = Settings::default();
    assert_eq!(
        defaults.lyrics,
        LyricsSettings {
            enabled: true,
            in_pill: true,
            announce: false,
            offset_ms: 0
        }
    );
    let mut legacy = serde_json::to_value(&defaults).unwrap();
    legacy.as_object_mut().unwrap().remove("lyrics");
    assert_eq!(Settings::from_json_lossy(&legacy), defaults);
    assert_eq!(
        serde_json::from_value::<Settings>(legacy).unwrap(),
        defaults
    );
    let mut settings = defaults;
    assert!(
        settings
            .merge_json(&json!({"lyrics":{"enabled":false,"announce":true,"offsetMs":-5000}}))
            .is_empty()
    );
    assert!(!settings.lyrics.enabled && settings.lyrics.in_pill && settings.lyrics.announce);
    assert_eq!(settings.lyrics.offset_ms, -5000);
    assert_eq!(
        serde_json::from_value::<Settings>(serde_json::to_value(&settings).unwrap()).unwrap(),
        settings
    );
}

#[test]
fn lyrics_rejects_invalid_values_keeping_previous_fields() {
    let mut settings = Settings::default();
    assert!(
        settings
            .merge_json(&json!({"lyrics":{"offsetMs":1200,"inPill":false}}))
            .is_empty()
    );
    for value in [
        json!(true),
        json!(null),
        json!([]),
        json!({"enabled":"yes"}),
        json!({"inPill":1}),
        json!({"announce":null}),
        json!({"offsetMs":5001}),
        json!({"offsetMs":-5001}),
        json!({"offsetMs":1.5}),
        json!({"offsetMs":"10"}),
        // One bad field rejects the whole object, even next to valid ones.
        json!({"enabled":false,"offsetMs":9000}),
    ] {
        let before = settings.clone();
        assert_eq!(settings.merge_json(&json!({"lyrics":value})), ["lyrics"]);
        assert_eq!(settings, before);
    }
    // Unknown keys are ignored; a bad lyrics field does not block other fields.
    let rejected = settings.merge_json(&json!({"lyrics":{"future":1},"liteMode":true}));
    assert!(rejected.is_empty() && settings.lite_mode);
}

#[test]
fn lyrics_offset_is_clamped_when_loaded_out_of_range() {
    let mut settings = Settings::default();
    settings.lyrics.offset_ms = 99_999;
    settings.clamp();
    assert_eq!(settings.lyrics.offset_ms, 5000);
}
