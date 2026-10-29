//! Battery status via Win32 GetSystemPowerStatus. Owner: R2 (Rust-System).

use serde::{Deserialize, Serialize};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

/// System power and battery status mirroring the IPC contract.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    pub has_battery: Option<bool>,
    pub percent: Option<u8>,
    pub charging: Option<bool>,
    pub ac_connected: Option<bool>,
    pub saver: Option<bool>,
    pub remaining_seconds: Option<u64>,
}

/// Pure parser from Win32 SYSTEM_POWER_STATUS into BatteryState according to contract §16.
pub fn parse_power_status(raw: SYSTEM_POWER_STATUS) -> BatteryState {
    // AC line status: 0 = offline, 1 = online, 255 = unknown.
    let ac_connected = match raw.ACLineStatus {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };

    // System status flag: 0 = saver off, 1 = saver on.
    let saver = match raw.SystemStatusFlag {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };

    // BatteryFlag:
    // Bit 0 = High (>66%), Bit 1 = Low (<33%), Bit 2 = Critical (<5%),
    // Bit 3 = Charging (8), Bit 7 = No system battery (128), 255 = Unknown.
    // IMPORTANT: check 255 FIRST before testing bit 128 (no-battery),
    // because 255 & 128 is non-zero and would erroneously register as "no battery".
    let (has_battery, charging, percent, remaining_seconds) = if raw.BatteryFlag == 255 {
        // Unknown battery status
        (None, None, None, None)
    } else if (raw.BatteryFlag & 128) != 0 {
        // System has no battery (e.g. desktop PC).
        // Percentage/charging/remaining are null, not 0.
        (Some(false), None, None, None)
    } else {
        // Has battery.
        let has = Some(true);
        let chg = Some((raw.BatteryFlag & 8) != 0);
        let pct = if raw.BatteryLifePercent <= 100 {
            Some(raw.BatteryLifePercent)
        } else {
            None // 255 or out of range
        };
        let rem = if raw.BatteryLifeTime == u32::MAX {
            None
        } else {
            Some(u64::from(raw.BatteryLifeTime))
        };
        (has, chg, pct, rem)
    };

    BatteryState {
        has_battery,
        percent,
        charging,
        ac_connected,
        saver,
        remaining_seconds,
    }
}

/// Reads the current system power status via Win32.
pub fn query_system_power_status() -> BatteryState {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: GetSystemPowerStatus takes a valid mutable pointer to SYSTEM_POWER_STATUS.
    let ok = unsafe { GetSystemPowerStatus(&mut status) }.is_ok();
    if !ok {
        return BatteryState::default();
    }
    parse_power_status(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn online_ac_does_not_imply_charging_and_full_percent_remains_valid() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 1,
            BatteryFlag: 1,
            BatteryLifePercent: 100,
            SystemStatusFlag: 0,
            BatteryLifeTime: u32::MAX,
            BatteryFullLifeTime: u32::MAX,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.percent, Some(100));
        assert_eq!(state.charging, Some(false));
        assert_eq!(state.ac_connected, Some(true));
    }

    #[test]
    fn parses_no_battery_system_desktop() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 1,         // AC online
            BatteryFlag: 128,        // No system battery
            BatteryLifePercent: 255, // Unknown
            SystemStatusFlag: 0,
            BatteryLifeTime: u32::MAX,
            BatteryFullLifeTime: u32::MAX,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.has_battery, Some(false));
        assert_eq!(state.ac_connected, Some(true));
        assert_eq!(state.percent, None); // Must NOT be 0%
        assert_eq!(state.charging, None);
        assert_eq!(state.saver, Some(false));
        assert_eq!(state.remaining_seconds, None);
    }

    #[test]
    fn parses_unknown_flag_255_not_no_battery() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 255,
            BatteryFlag: 255, // Unknown
            BatteryLifePercent: 50,
            SystemStatusFlag: 255,
            BatteryLifeTime: u32::MAX,
            BatteryFullLifeTime: u32::MAX,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.has_battery, None); // Must be None, not Some(false)
        assert_eq!(state.ac_connected, None);
        assert_eq!(state.percent, None);
        assert_eq!(state.charging, None);
        assert_eq!(state.saver, None);
    }

    #[test]
    fn parses_zero_percent_valid_battery() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 0,       // Disconnected
            BatteryFlag: 4,        // Critical
            BatteryLifePercent: 0, // 0% is valid!
            SystemStatusFlag: 1,   // Battery saver on
            BatteryLifeTime: 60,
            BatteryFullLifeTime: 3600,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.has_battery, Some(true));
        assert_eq!(state.percent, Some(0));
        assert_eq!(state.charging, Some(false));
        assert_eq!(state.ac_connected, Some(false));
        assert_eq!(state.saver, Some(true));
        assert_eq!(state.remaining_seconds, Some(60));
    }

    #[test]
    fn parses_charging_laptop_at_85_percent() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 1,    // AC online
            BatteryFlag: 1 | 8, // High + Charging
            BatteryLifePercent: 85,
            SystemStatusFlag: 0,
            BatteryLifeTime: u32::MAX, // AC connected, so lifetime unknown
            BatteryFullLifeTime: 18000,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.has_battery, Some(true));
        assert_eq!(state.percent, Some(85));
        assert_eq!(state.charging, Some(true));
        assert_eq!(state.ac_connected, Some(true));
        assert_eq!(state.saver, Some(false));
        assert_eq!(state.remaining_seconds, None);
    }

    #[test]
    fn parses_known_battery_unknown_percent() {
        let raw = SYSTEM_POWER_STATUS {
            ACLineStatus: 0,
            BatteryFlag: 0,          // neither high, low, charging, nor no-battery
            BatteryLifePercent: 255, // unknown percent
            SystemStatusFlag: 0,
            BatteryLifeTime: 7200,
            BatteryFullLifeTime: u32::MAX,
        };
        let state = parse_power_status(raw);
        assert_eq!(state.has_battery, Some(true));
        assert_eq!(state.percent, None); // Honest unknown percent
        assert_eq!(state.charging, Some(false));
        assert_eq!(state.ac_connected, Some(false));
        assert_eq!(state.remaining_seconds, Some(7200));
    }

    #[test]
    fn serializes_camel_case_matching_ts_contract() {
        let state = BatteryState {
            has_battery: Some(true),
            percent: Some(77),
            charging: Some(false),
            ac_connected: Some(true),
            saver: Some(false),
            remaining_seconds: Some(5400),
        };
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["hasBattery"], true);
        assert_eq!(json["percent"], 77);
        assert_eq!(json["charging"], false);
        assert_eq!(json["acConnected"], true);
        assert_eq!(json["saver"], false);
        assert_eq!(json["remainingSeconds"], 5400);

        let none_state = BatteryState::default();
        let none_json = serde_json::to_value(&none_state).unwrap();
        assert!(none_json["hasBattery"].is_null());
        assert!(none_json["percent"].is_null());
    }
}
