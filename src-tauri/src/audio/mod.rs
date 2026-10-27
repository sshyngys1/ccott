//! System volume and output devices through Core Audio. Owner: R2 (Rust-System).
//!
//! One dedicated COM (MTA) thread owns the `IMMDeviceEnumerator`, the endpoint of the default render
//! device and both notification callbacks (volume/mute and default-device change). Callbacks only post
//! a message to that thread; commands talk to it through a channel, so no COM object crosses threads.

mod policy;
mod volume;

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow, ERole, IMMDevice,
    IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator,
    eMultimedia, eRender,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ,
};
use windows::core::{PCWSTR, implement};

/// Minimum interval between two `audio://changed` emits (slider drags fire many notifications).
const EMIT_INTERVAL: Duration = Duration::from_millis(40);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub volume: u8,
    pub muted: bool,
    pub device: Option<AudioDevice>,
}

enum Msg {
    /// Volume/mute/default device/device list changed.
    Changed,
    /// The default device changed: re-bind the endpoint.
    DefaultChanged,
    Get(Sender<AudioState>),
    SetVolume(f32, Sender<Result<(), String>>),
    SetMuted(bool, Sender<Result<(), String>>),
    List(Sender<Result<Vec<AudioDevice>, String>>),
    SetDevice(String, Sender<Result<(), String>>),
}

/// Managed state: channel to the audio thread.
pub struct AudioHandle(Sender<Msg>);

impl AudioHandle {
    fn request<T: Send + 'static>(&self, make: impl FnOnce(Sender<T>) -> Msg) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.0
            .send(make(tx))
            .map_err(|_| "audio thread is not running")?;
        rx.recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "audio thread did not answer".to_string())
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel();
    app.manage(AudioHandle(tx.clone()));
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("audio-coreaudio".into())
        .spawn(move || {
            if let Err(e) = run(handle, tx, rx) {
                log::error!("audio: Core Audio thread stopped: {e}");
            }
        })?;
    Ok(())
}

// ───────────────────────────── COM callbacks ─────────────────────────────

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback(Sender<Msg>);

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        let _ = self.0.send(Msg::Changed);
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceNotify(Sender<Msg>);

impl IMMNotificationClient_Impl for DeviceNotify_Impl {
    fn OnDeviceStateChanged(
        &self,
        _id: &PCWSTR,
        _state: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(Msg::DefaultChanged); // default may have moved to/away from this device
        Ok(())
    }
    fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        let _ = self.0.send(Msg::DefaultChanged);
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _id: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender && role == eMultimedia {
            let _ = self.0.send(Msg::DefaultChanged);
        }
        Ok(())
    }
    fn OnPropertyValueChanged(
        &self,
        _id: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> windows::core::Result<()> {
        Ok(())
    }
}

// ───────────────────────────── worker thread ─────────────────────────────

struct Audio {
    enumerator: IMMDeviceEnumerator,
    volume_cb: IAudioEndpointVolumeCallback,
    /// Default render device + its volume interface (with our callback registered).
    endpoint: Option<(IMMDevice, IAudioEndpointVolume)>,
}

fn run(app: AppHandle, tx: Sender<Msg>, rx: Receiver<Msg>) -> windows::core::Result<()> {
    // SAFETY: initialises COM for this dedicated thread (MTA); called once at thread start.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    // SAFETY: standard COM activation of a system class on an initialised thread.
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let notify: IMMNotificationClient = DeviceNotify(tx.clone()).into();
    // SAFETY: `notify` is a valid COM object that outlives the registration (this function never returns
    // before the process ends, and the enumerator is dropped together with it).
    unsafe { enumerator.RegisterEndpointNotificationCallback(&notify)? };
    let mut audio = Audio {
        enumerator,
        volume_cb: VolumeCallback(tx).into(),
        endpoint: None,
    };
    audio.bind_default();
    log::info!("audio: Core Audio ready");

    let mut last_emitted = audio.state();
    let mut last_emit_at = Instant::now() - EMIT_INTERVAL;
    let mut dirty = false;
    loop {
        let msg = if dirty {
            let wait = (last_emit_at + EMIT_INTERVAL).saturating_duration_since(Instant::now());
            rx.recv_timeout(wait)
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match msg {
            Ok(Msg::Changed) => dirty = true,
            Ok(Msg::DefaultChanged) => {
                audio.bind_default();
                dirty = true;
            }
            Ok(Msg::Get(reply)) => {
                let _ = reply.send(audio.state());
            }
            Ok(Msg::SetVolume(v, reply)) => {
                let _ = reply.send(audio.set_volume(v));
            }
            Ok(Msg::SetMuted(m, reply)) => {
                let _ = reply.send(audio.set_muted(m));
            }
            Ok(Msg::List(reply)) => {
                let _ = reply.send(audio.list_devices().map_err(|e| e.to_string()));
            }
            Ok(Msg::SetDevice(id, reply)) => {
                let result = audio.set_default_device(&id);
                audio.bind_default();
                dirty = true;
                let _ = reply.send(result);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
        if dirty && last_emit_at.elapsed() >= EMIT_INTERVAL {
            dirty = false;
            last_emit_at = Instant::now();
            let state = audio.state();
            if state != last_emitted {
                last_emitted = state.clone();
                let _ = app.emit("audio://changed", &state);
            }
        }
    }
}

/// Reads a COM-allocated wide string and frees it.
fn take_pwstr(p: windows::core::PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: `p` is a NUL-terminated string allocated by COM (CoTaskMemAlloc); freed exactly once here.
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

fn device_id(device: &IMMDevice) -> String {
    // SAFETY: GetId returns a CoTaskMemAlloc'ed string, consumed by take_pwstr.
    unsafe { device.GetId() }
        .map(take_pwstr)
        .unwrap_or_default()
}

fn device_name(device: &IMMDevice) -> String {
    // SAFETY: property-store read; the PROPVARIANT is cleared and the returned string freed.
    unsafe {
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
            return String::new();
        };
        let Ok(mut value) = store.GetValue(&PKEY_Device_FriendlyName) else {
            return String::new();
        };
        let name = PropVariantToStringAlloc(&value)
            .map(take_pwstr)
            .unwrap_or_default();
        let _ = PropVariantClear(&mut value);
        name
    }
}

impl Audio {
    /// (Re)binds to the current default render device and registers the volume callback on it.
    fn bind_default(&mut self) {
        if let Some((_, ep)) = self.endpoint.take() {
            // SAFETY: unregistering the callback registered in a previous bind.
            let _ = unsafe { ep.UnregisterControlChangeNotify(&self.volume_cb) };
        }
        // SAFETY: COM calls on this MTA thread with valid interfaces.
        let bound = unsafe {
            (|| -> windows::core::Result<(IMMDevice, IAudioEndpointVolume)> {
                let device = self
                    .enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)?;
                let ep: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
                ep.RegisterControlChangeNotify(&self.volume_cb)?;
                Ok((device, ep))
            })()
        };
        match bound {
            Ok(b) => self.endpoint = Some(b),
            Err(e) => log::debug!("audio: no default render device: {e}"),
        }
    }

    fn state(&self) -> AudioState {
        let Some((device, ep)) = &self.endpoint else {
            return AudioState {
                volume: 0,
                muted: false,
                device: None,
            };
        };
        // SAFETY: simple getters on a valid endpoint interface.
        let (scalar, muted) = unsafe {
            (
                ep.GetMasterVolumeLevelScalar().unwrap_or(0.0),
                ep.GetMute().map(|b| b.as_bool()).unwrap_or(false),
            )
        };
        AudioState {
            volume: volume::scalar_to_percent(scalar),
            muted,
            device: Some(AudioDevice {
                id: device_id(device),
                name: device_name(device),
                is_default: true,
            }),
        }
    }

    fn endpoint(&self) -> Result<&IAudioEndpointVolume, String> {
        self.endpoint
            .as_ref()
            .map(|(_, ep)| ep)
            .ok_or_else(|| "no audio output device".to_string())
    }

    fn set_volume(&self, scalar: f32) -> Result<(), String> {
        let ep = self.endpoint()?;
        // SAFETY: valid endpoint; the context GUID is optional.
        unsafe { ep.SetMasterVolumeLevelScalar(scalar, std::ptr::null()) }
            .map_err(|e| e.to_string())
    }

    fn set_muted(&self, muted: bool) -> Result<(), String> {
        let ep = self.endpoint()?;
        // SAFETY: valid endpoint; the context GUID is optional.
        unsafe { ep.SetMute(muted, std::ptr::null()) }.map_err(|e| e.to_string())
    }

    fn list_devices(&self) -> windows::core::Result<Vec<AudioDevice>> {
        let default_id = self
            .endpoint
            .as_ref()
            .map(|(d, _)| device_id(d))
            .unwrap_or_default();
        // SAFETY: enumeration of active render endpoints with valid interfaces.
        unsafe {
            let devices = self
                .enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            let mut out = Vec::new();
            for i in 0..devices.GetCount()? {
                let device = devices.Item(i)?;
                let id = device_id(&device);
                out.push(AudioDevice {
                    is_default: id == default_id,
                    name: device_name(&device),
                    id,
                });
            }
            Ok(out)
        }
    }

    fn set_default_device(&self, id: &str) -> Result<(), String> {
        // Only ids of currently active render devices are accepted.
        let known = self.list_devices().map_err(|e| e.to_string())?;
        if !known.iter().any(|d| d.id == id) {
            return Err(format!("unknown audio device: {id}"));
        }
        policy::set_default_endpoint(id)
    }
}

// ───────────────────────────── commands ─────────────────────────────

async fn ask<T: Send + 'static>(
    handle: &State<'_, AudioHandle>,
    make: impl FnOnce(Sender<T>) -> Msg + Send + 'static,
) -> Result<T, String> {
    let tx = handle.0.clone();
    tauri::async_runtime::spawn_blocking(move || AudioHandle(tx).request(make))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn audio_get_state(handle: State<'_, AudioHandle>) -> Result<AudioState, String> {
    ask(&handle, Msg::Get).await
}

#[tauri::command]
pub async fn audio_set_volume(handle: State<'_, AudioHandle>, volume: f64) -> Result<(), String> {
    let scalar = volume::percent_to_scalar(volume)?;
    ask(&handle, move |r| Msg::SetVolume(scalar, r)).await?
}

#[tauri::command]
pub async fn audio_set_muted(handle: State<'_, AudioHandle>, muted: bool) -> Result<(), String> {
    ask(&handle, move |r| Msg::SetMuted(muted, r)).await?
}

#[tauri::command]
pub async fn audio_list_devices(
    handle: State<'_, AudioHandle>,
) -> Result<Vec<AudioDevice>, String> {
    ask(&handle, Msg::List).await?
}

#[tauri::command]
pub async fn audio_set_device(handle: State<'_, AudioHandle>, id: String) -> Result<(), String> {
    ask(&handle, move |r| Msg::SetDevice(id, r)).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_camel_case() {
        let s = AudioState {
            volume: 42,
            muted: true,
            device: Some(AudioDevice {
                id: "{x}".into(),
                name: "Speakers".into(),
                is_default: true,
            }),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["volume"], 42);
        assert_eq!(v["device"]["isDefault"], true);
        let none = serde_json::to_value(AudioState {
            volume: 0,
            muted: false,
            device: None,
        })
        .unwrap();
        assert!(none["device"].is_null());
    }
}
