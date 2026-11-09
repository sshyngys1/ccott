use serde::{Deserialize, Serialize};
use windows::core::GUID;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RadioKind {
    Wifi,
    Bluetooth,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RadioValue {
    On,
    Off,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RadioState {
    pub kind: RadioKind,
    pub state: RadioValue,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WifiInfo {
    pub connected: bool,
    pub ssid: Option<String>,
    pub signal: Option<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub battery: Option<u8>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PowerMode {
    Efficiency,
    Balanced,
    Performance,
}

const EFFICIENCY: GUID = GUID::from_u128(0x961cc777_2547_4f9d_8174_7d86181b8a7a);
const PERFORMANCE: GUID = GUID::from_u128(0xded574b5_45a0_4f42_8737_46345c09c238);

impl PowerMode {
    pub fn guid(self) -> GUID {
        match self {
            Self::Efficiency => EFFICIENCY,
            Self::Balanced => GUID::zeroed(),
            Self::Performance => PERFORMANCE,
        }
    }
    pub fn from_guid(guid: GUID) -> Option<Self> {
        [Self::Efficiency, Self::Balanced, Self::Performance]
            .into_iter()
            .find(|mode| mode.guid() == guid)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlState {
    pub wifi: RadioState,
    pub bluetooth: RadioState,
    pub wifi_info: WifiInfo,
    pub bt_devices: Vec<BtDevice>,
    pub dark_mode: bool,
    pub power_mode: Option<PowerMode>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn power_guid_roundtrip_and_unknown() {
        for (mode, text) in [
            (
                PowerMode::Efficiency,
                "961CC777-2547-4F9D-8174-7D86181B8A7A",
            ),
            (PowerMode::Balanced, "00000000-0000-0000-0000-000000000000"),
            (
                PowerMode::Performance,
                "DED574B5-45A0-4F42-8737-46345C09C238",
            ),
        ] {
            let guid = GUID::try_from(text).unwrap();
            assert_eq!(mode.guid(), guid);
            assert_eq!(PowerMode::from_guid(guid), Some(mode));
        }
        assert_eq!(PowerMode::from_guid(GUID::from_u128(1)), None);
        assert!(GUID::try_from("invalid").is_err());
    }
    #[test]
    fn contract_names() {
        assert_eq!(
            serde_json::to_string(&PowerMode::Efficiency).unwrap(),
            "\"efficiency\""
        );
        assert!(serde_json::from_str::<RadioKind>("\"other\"").is_err());
    }
}
