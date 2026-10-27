//! `MediaState` and the pure helpers that map SMTC values to it (no WinRT here, so it is testable).

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
    Unknown,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub has_session: bool,
    pub source_app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: Option<String>,
    pub status: PlaybackStatus,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub position_sampled_at: i64,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
}

impl MediaState {
    /// "No session" state.
    pub fn none(now: i64) -> Self {
        Self {
            has_session: false,
            source_app: String::new(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            artwork: None,
            status: PlaybackStatus::Stopped,
            position_ms: 0,
            duration_ms: 0,
            position_sampled_at: now,
            can_play_pause: false,
            can_next: false,
            can_previous: false,
            can_seek: false,
        }
    }
}

/// `GlobalSystemMediaTransportControlsSessionPlaybackStatus` value → [`PlaybackStatus`].
/// (0 Closed, 1 Opened, 2 Changing, 3 Stopped, 4 Playing, 5 Paused)
pub fn map_status(value: i32) -> PlaybackStatus {
    match value {
        4 => PlaybackStatus::Playing,
        5 => PlaybackStatus::Paused,
        3 => PlaybackStatus::Stopped,
        _ => PlaybackStatus::Unknown,
    }
}

/// 100-ns ticks → milliseconds.
pub fn ticks_to_ms(ticks: i64) -> i64 {
    ticks / 10_000
}

/// Milliseconds → 100-ns ticks.
pub fn ms_to_ticks(ms: i64) -> i64 {
    ms.saturating_mul(10_000)
}

/// Windows `DateTime.UniversalTime` (100-ns ticks since 1601-01-01) → epoch ms.
pub fn universal_ticks_to_epoch_ms(ticks: i64) -> i64 {
    const EPOCH_DIFF_MS: i64 = 11_644_473_600_000;
    ticks_to_ms(ticks) - EPOCH_DIFF_MS
}

/// Current position. SMTC reports `position` as of `updated_at`; while playing the real position keeps
/// moving, so extrapolate (clamped to the duration). Unusable timestamps → no extrapolation.
pub fn current_position_ms(
    position_ms: i64,
    updated_at_ms: i64,
    now_ms: i64,
    rate: f64,
    playing: bool,
    duration_ms: i64,
) -> i64 {
    let mut pos = position_ms.max(0);
    let elapsed = now_ms - updated_at_ms;
    if playing && updated_at_ms > 0 && (0..=6 * 3600 * 1000).contains(&elapsed) {
        let rate = if rate.is_finite() && rate > 0.0 {
            rate
        } else {
            1.0
        };
        pos += (elapsed as f64 * rate) as i64;
    }
    if duration_ms > 0 {
        pos = pos.min(duration_ms);
    }
    pos
}

/// Allowed drift between the extrapolated and the freshly sampled position.
const POSITION_TOLERANCE_MS: i64 = 1500;

/// Should `new` be emitted given that `old` was the last emitted state?
/// Position changes that are just normal playback progress do not count.
pub fn state_changed(old: &MediaState, new: &MediaState) -> bool {
    let mut a = old.clone();
    let mut b = new.clone();
    // Compare everything except the position fields.
    a.position_ms = 0;
    b.position_ms = 0;
    a.position_sampled_at = 0;
    b.position_sampled_at = 0;
    if a != b {
        return true;
    }
    let expected = if old.status == PlaybackStatus::Playing {
        let mut p = old.position_ms + (new.position_sampled_at - old.position_sampled_at).max(0);
        if old.duration_ms > 0 {
            p = p.min(old.duration_ms);
        }
        p
    } else {
        old.position_ms
    };
    (new.position_ms - expected).abs() > POSITION_TOLERANCE_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing(pos: i64, at: i64) -> MediaState {
        MediaState {
            has_session: true,
            source_app: "Spotify.exe".into(),
            title: "T".into(),
            artist: "A".into(),
            album: "B".into(),
            artwork: None,
            status: PlaybackStatus::Playing,
            position_ms: pos,
            duration_ms: 200_000,
            position_sampled_at: at,
            can_play_pause: true,
            can_next: true,
            can_previous: true,
            can_seek: true,
        }
    }

    #[test]
    fn status_mapping() {
        assert_eq!(map_status(4), PlaybackStatus::Playing);
        assert_eq!(map_status(5), PlaybackStatus::Paused);
        assert_eq!(map_status(3), PlaybackStatus::Stopped);
        for v in [0, 1, 2, 99, -1] {
            assert_eq!(map_status(v), PlaybackStatus::Unknown);
        }
    }

    #[test]
    fn time_conversions() {
        assert_eq!(ticks_to_ms(10_000_000), 1000);
        assert_eq!(ms_to_ticks(1000), 10_000_000);
        // 1970-01-01 in Windows ticks
        assert_eq!(universal_ticks_to_epoch_ms(116_444_736_000_000_000), 0);
        assert_eq!(universal_ticks_to_epoch_ms(116_444_736_010_000_000), 1000);
    }

    #[test]
    fn position_extrapolates_only_while_playing() {
        assert_eq!(
            current_position_ms(10_000, 1_000, 3_000, 1.0, true, 100_000),
            12_000
        );
        assert_eq!(
            current_position_ms(10_000, 1_000, 3_000, 1.0, false, 100_000),
            10_000
        );
        assert_eq!(
            current_position_ms(10_000, 1_000, 3_000, 2.0, true, 100_000),
            14_000
        );
        // clamped to the duration
        assert_eq!(
            current_position_ms(99_000, 1, 10_000, 1.0, true, 100_000),
            100_000
        );
        // bogus timestamps (never updated / in the future) → no extrapolation
        assert_eq!(current_position_ms(5_000, 0, 9_000, 1.0, true, 0), 5_000);
        assert_eq!(
            current_position_ms(5_000, 9_000, 3_000, 1.0, true, 0),
            5_000
        );
        // negative position clamps to 0
        assert_eq!(current_position_ms(-5, 0, 0, 1.0, false, 0), 0);
        // bad rate falls back to 1.0
        assert_eq!(current_position_ms(0, 1, 1_001, f64::NAN, true, 0), 1_000);
    }

    #[test]
    fn normal_progress_is_not_a_change() {
        let old = playing(10_000, 1_000_000);
        let new = playing(15_100, 1_005_000); // 5 s later, +5.1 s
        assert!(!state_changed(&old, &new));
    }

    #[test]
    fn seek_or_metadata_change_is_a_change() {
        let old = playing(10_000, 1_000_000);
        assert!(state_changed(&old, &playing(60_000, 1_005_000)), "seek");
        let mut t = playing(15_000, 1_005_000);
        t.title = "Other".into();
        assert!(state_changed(&old, &t), "title");
        let mut p = playing(15_000, 1_005_000);
        p.status = PlaybackStatus::Paused;
        assert!(state_changed(&old, &p), "status");
    }

    #[test]
    fn paused_position_must_not_drift() {
        let mut old = playing(10_000, 1_000_000);
        old.status = PlaybackStatus::Paused;
        let mut new = old.clone();
        new.position_sampled_at += 60_000;
        assert!(!state_changed(&old, &new));
        new.position_ms = 40_000;
        assert!(state_changed(&old, &new));
    }

    #[test]
    fn serializes_camel_case() {
        let v = serde_json::to_value(MediaState::none(5)).unwrap();
        assert_eq!(v["hasSession"], false);
        assert_eq!(v["positionSampledAt"], 5);
        assert_eq!(v["status"], "stopped");
        assert!(v["artwork"].is_null());
    }
}
