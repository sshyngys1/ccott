//! Paired classic + LE endpoints. Read Windows' cached PnP battery property by container;
//! no BLE connection, pairing, elevation or active battery-service discovery is initiated.
use super::{model::BtDevice, native::wait};
use std::collections::HashMap;
use windows::{
    Devices::{
        Bluetooth::{BluetoothDevice, BluetoothLEDevice},
        Enumeration::{DeviceInformation, DeviceInformationKind},
    },
    Foundation::IPropertyValue,
    Win32::{
        Devices::{DeviceAndDriverInstallation::*, Properties::*},
        Foundation::DEVPROPKEY,
    },
    core::{GUID, HSTRING, Interface, PCWSTR},
};

const BATTERY: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5),
    pid: 2,
};

fn batteries(cancelled: &dyn Fn() -> bool) -> HashMap<GUID, u8> {
    let mut result = HashMap::new();
    // SAFETY: SetupAPI owns the info set; typed property buffers are checked for type and size
    // before decoding, and the info set is destroyed on the only exit after successful creation.
    unsafe {
        let Ok(set) =
            SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_ALLCLASSES | DIGCF_PRESENT)
        else {
            return result;
        };
        let mut index = 0;
        while !cancelled() {
            let mut device = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ..Default::default()
            };
            if SetupDiEnumDeviceInfo(set, index, &mut device).is_err() {
                break;
            }
            index += 1;
            let mut value = [0u8; 4];
            let mut kind = DEVPROPTYPE::default();
            let mut size = 0;
            if SetupDiGetDevicePropertyW(
                set,
                &device,
                &BATTERY,
                &mut kind,
                Some(&mut value),
                Some(&mut size),
                0,
            )
            .is_err()
            {
                continue;
            }
            let battery = decode_battery(kind, size, value);
            let Some(battery) = battery else {
                continue;
            };
            let mut container = [0u8; 16];
            if SetupDiGetDevicePropertyW(
                set,
                &device,
                &DEVPKEY_Device_ContainerId,
                &mut kind,
                Some(&mut container),
                Some(&mut size),
                0,
            )
            .is_ok()
                && kind == DEVPROP_TYPE_GUID
                && size == 16
            {
                result.insert(
                    GUID::from_values(
                        u32::from_le_bytes(container[0..4].try_into().unwrap_or_default()),
                        u16::from_le_bytes([container[4], container[5]]),
                        u16::from_le_bytes([container[6], container[7]]),
                        container[8..16].try_into().unwrap_or_default(),
                    ),
                    battery,
                );
            }
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
    }
    result
}

fn decode_battery(kind: DEVPROPTYPE, size: u32, value: [u8; 4]) -> Option<u8> {
    let percent = if kind == DEVPROP_TYPE_BYTE && size == 1 {
        u32::from(value[0])
    } else if kind == DEVPROP_TYPE_UINT32 && size == 4 {
        u32::from_le_bytes(value)
    } else {
        return None;
    };
    u8::try_from(percent).ok().filter(|value| *value <= 100)
}

pub fn devices(cancelled: &dyn Fn() -> bool) -> windows::core::Result<Vec<BtDevice>> {
    let battery = batteries(cancelled);
    let mut result: Vec<BtDevice> = Vec::new();
    for selector in [
        BluetoothDevice::GetDeviceSelectorFromPairingState(true),
        BluetoothLEDevice::GetDeviceSelectorFromPairingState(true),
    ] {
        if cancelled() {
            break;
        }
        let Ok(selector) = selector else {
            continue;
        };
        let properties: windows_collections::IIterable<HSTRING> = vec![
            HSTRING::from("System.Devices.Aep.IsConnected"),
            HSTRING::from("System.Devices.Aep.ContainerId"),
        ]
        .into();
        let endpoints = wait!(
            DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
                &selector,
                &properties,
                DeviceInformationKind::AssociationEndpoint
            ),
            cancelled
        );
        let Ok(endpoints) = endpoints else {
            continue;
        };
        for device in endpoints {
            let endpoint = (|| -> windows::core::Result<BtDevice> {
                let properties = device.Properties()?;
                let property = |name: &str| {
                    properties
                        .Lookup(&HSTRING::from(name))
                        .and_then(|value| value.cast::<IPropertyValue>())
                };
                let connected = property("System.Devices.Aep.IsConnected")
                    .and_then(|value| value.GetBoolean())
                    .unwrap_or(false);
                let container = property("System.Devices.Aep.ContainerId")
                    .and_then(|value| value.GetGuid())
                    .ok();
                let id = match container {
                    Some(id) => format!("{id:?}"),
                    None => device.Id()?.to_string(),
                };
                let level = container.and_then(|id| battery.get(&id).copied());
                Ok(BtDevice {
                    id,
                    name: device.Name()?.to_string(),
                    connected,
                    battery: level,
                })
            })();
            merge_endpoint(&mut result, endpoint);
        }
    }
    result.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(result)
}

// A disappearing or broken endpoint must not discard the other paired devices.
fn merge_endpoint(result: &mut Vec<BtDevice>, endpoint: windows::core::Result<BtDevice>) {
    let Ok(endpoint) = endpoint else {
        return;
    };
    if let Some(existing) = result.iter_mut().find(|item| item.id == endpoint.id) {
        existing.connected |= endpoint.connected;
        existing.battery = existing.battery.or(endpoint.battery);
    } else {
        result.push(endpoint);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn broken_endpoint_keeps_good_devices_and_classic_le_merge() {
        let mut result = Vec::new();
        let device = BtDevice {
            id: "a".into(),
            name: "Headphones".into(),
            connected: false,
            battery: None,
        };
        merge_endpoint(&mut result, Ok(device.clone()));
        merge_endpoint(
            &mut result,
            Err(windows::core::Error::from_hresult(
                windows::Win32::Foundation::E_FAIL,
            )),
        );
        merge_endpoint(
            &mut result,
            Ok(BtDevice {
                connected: true,
                battery: Some(42),
                ..device
            }),
        );
        merge_endpoint(
            &mut result,
            Ok(BtDevice {
                id: "b".into(),
                name: "Mouse".into(),
                connected: false,
                battery: None,
            }),
        );
        assert_eq!(result.len(), 2);
        assert!(result[0].connected);
        assert_eq!(result[0].battery, Some(42));
    }
    #[test]
    fn validates_pnp_battery_type_size_and_range() {
        assert_eq!(decode_battery(DEVPROP_TYPE_BYTE, 1, [0, 0, 0, 0]), Some(0));
        assert_eq!(
            decode_battery(DEVPROP_TYPE_UINT32, 4, 100u32.to_le_bytes()),
            Some(100)
        );
        assert_eq!(
            decode_battery(DEVPROP_TYPE_UINT32, 4, 101u32.to_le_bytes()),
            None
        );
        assert_eq!(decode_battery(DEVPROP_TYPE_BYTE, 4, [20, 0, 0, 0]), None);
        assert_eq!(decode_battery(DEVPROP_TYPE_GUID, 1, [20, 0, 0, 0]), None);
    }
}
