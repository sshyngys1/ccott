//! WASAPI loopback worker. Capture objects stay on its balanced MTA; PCM never leaves bounded RAM.
use super::{
    capture::{self, Format, Packet, PacketReader, Samples},
    dsp,
};
use crate::system::worker::{Control, WorkerApp, with_app};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, IAudioCaptureClient, IAudioClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEXTENSIBLE, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize,
};
use windows::core::{Error, HRESULT};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpectrum {
    pub available: bool,
    pub bands: [f32; 4],
    pub sampled_at: u64,
}

impl Default for AudioSpectrum {
    fn default() -> Self {
        Self {
            available: false,
            bands: [0.0, 0.0, 0.0, 0.0],
            sampled_at: 0,
        }
    }
}

pub struct VisualizerHandle {
    control: Arc<Control>,
    cached_spectrum: Arc<RwLock<AudioSpectrum>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl VisualizerHandle {
    pub fn set_enabled(&self, enabled: bool) {
        self.control.set_enabled(enabled);
    }
    #[allow(dead_code)]
    pub fn current_spectrum(&self) -> AudioSpectrum {
        self.cached_spectrum.read().unwrap().clone()
    }
    pub fn shutdown(&self) {
        self.control.stop();
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}
impl Drop for VisualizerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Apartment;
impl Apartment {
    fn enter() -> windows::core::Result<Self> {
        // SAFETY: this fresh dedicated worker initializes COM exactly once before any COM objects.
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: successful CoInitializeEx is balanced on the same thread after COM locals drop.
        unsafe {
            CoUninitialize();
        }
    }
}
struct TaskMem<T>(*mut T);
impl<T> Drop for TaskMem<T> {
    fn drop(&mut self) {
        // SAFETY: only pointers returned by GetMixFormat/GetId's COM task allocator enter this guard.
        unsafe {
            CoTaskMemFree(Some(self.0.cast()));
        }
    }
}
fn invalid_format() -> Error {
    Error::from_hresult(HRESULT(0x80070057u32 as i32))
}

struct Buffer<'a> {
    client: &'a IAudioCaptureClient,
    frames: u32,
    released: bool,
}
impl Buffer<'_> {
    fn release(mut self) -> windows::core::Result<()> {
        self.released = true;
        // SAFETY: balances exactly one successful nonempty GetBuffer on this thread.
        unsafe { self.client.ReleaseBuffer(self.frames) }
    }
}
impl Drop for Buffer<'_> {
    fn drop(&mut self) {
        if !self.released {
            // SAFETY: error paths still balance the outstanding GetBuffer; no data is accessed again.
            let _ = unsafe { self.client.ReleaseBuffer(self.frames) };
        }
    }
}

struct WasapiReader {
    client: IAudioCaptureClient,
    format: Format,
    buffer_frames: u32,
}
impl PacketReader for WasapiReader {
    type Error = Error;
    fn next_size(&mut self) -> windows::core::Result<u32> {
        // SAFETY: client belongs to this initialized MTA and no packet remains outstanding.
        unsafe { self.client.GetNextPacketSize() }
    }
    fn read(&mut self) -> windows::core::Result<Packet> {
        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        // SAFETY: all output pointers refer to initialized local storage; client stays on this MTA.
        unsafe {
            self.client
                .GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
        }
        if frames == 0 {
            return Ok(Packet {
                frames: 0,
                samples: Vec::new(),
                reset: false,
            });
        }
        let buffer = Buffer {
            client: &self.client,
            frames,
            released: false,
        };
        let byte_count = self
            .format
            .byte_count(frames, self.buffer_frames)
            .ok_or_else(invalid_format)?;
        let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
        let take_frames = (frames as usize).min(capture::MAX_SAMPLES);
        let samples = if silent {
            vec![0.0; take_frames]
        } else {
            if data.is_null() {
                return Err(invalid_format());
            }
            let take_bytes = take_frames
                .checked_mul(self.format.block_align)
                .ok_or_else(invalid_format)?;
            let offset = byte_count
                .checked_sub(take_bytes)
                .ok_or_else(invalid_format)?;
            // SAFETY: WASAPI owns byte_count bytes for frames until ReleaseBuffer. Both lengths are
            // validated against the endpoint buffer; only a bounded tail is borrowed, with no alignment cast.
            let bytes = unsafe { std::slice::from_raw_parts(data.add(offset), take_bytes) };
            dsp::parse_pcm_to_mono_f32(
                bytes,
                self.format.bits,
                self.format.channels,
                self.format.float,
            )
        };
        buffer.release()?;
        Ok(Packet {
            frames: frames as usize,
            samples,
            reset: silent || flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0,
        })
    }
}

struct LoopbackSession {
    audio_client: IAudioClient,
    reader: WasapiReader,
    samples: Samples,
}
impl Drop for LoopbackSession {
    fn drop(&mut self) {
        // SAFETY: this started client is stopped on its owning MTA before interfaces are released.
        let _ = unsafe { self.audio_client.Stop() };
    }
}
fn default_endpoint(
    enumerator: &IMMDeviceEnumerator,
) -> windows::core::Result<(IMMDevice, String)> {
    // SAFETY: enumerator belongs to this MTA; GetId's allocation is guarded on every path.
    unsafe {
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let id = device.GetId()?;
        let _allocation = TaskMem(id.0);
        let text = id.to_string()?;
        Ok((device, text))
    }
}
fn open_loopback_session(device: &IMMDevice) -> windows::core::Result<LoopbackSession> {
    // SAFETY: all COM calls run on this worker's MTA. The format allocation remains live throughout
    // Initialize and is freed even on validation/activation/initialization failures.
    unsafe {
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let allocation = TaskMem(client.GetMixFormat()?);
        if allocation.0.is_null() {
            return Err(invalid_format());
        }
        let raw = allocation.0.read_unaligned();
        let (subtype, valid_bits) = if raw.wFormatTag == 0xFFFE {
            if raw.cbSize < 22 {
                return Err(invalid_format());
            }
            let extended = allocation.0.cast::<WAVEFORMATEXTENSIBLE>().read_unaligned();
            (
                Some(std::ptr::addr_of!(extended.SubFormat).read_unaligned()),
                extended.Samples.wValidBitsPerSample,
            )
        } else {
            (None, raw.wBitsPerSample)
        };
        let float = capture::encoding(raw.wFormatTag, subtype).ok_or_else(invalid_format)?;
        let format = Format::validate(
            raw.nSamplesPerSec,
            raw.nChannels,
            raw.wBitsPerSample,
            valid_bits,
            raw.nBlockAlign,
            raw.nAvgBytesPerSec,
            float,
        )
        .ok_or_else(invalid_format)?;
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            10_000_000,
            0,
            allocation.0,
            None,
        )?;
        let buffer_frames = client.GetBufferSize()?;
        if buffer_frames == 0
            || buffer_frames > format.rate.checked_mul(2).ok_or_else(invalid_format)?
        {
            return Err(invalid_format());
        }
        let capture = client.GetService()?;
        client.Start()?;
        Ok(LoopbackSession {
            audio_client: client,
            reader: WasapiReader {
                client: capture,
                format,
                buffer_frames,
            },
            samples: Samples::default(),
        })
    }
}
fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn is_island_visible(app: &WorkerApp) -> bool {
    with_app(app, |app| {
        let Some(state) = app.try_state::<crate::window::IslandState>() else {
            return false;
        };
        let hwnd = state.hwnd.load(Ordering::Relaxed);
        if hwnd == 0 || state.fullscreen_hidden.load(Ordering::Relaxed) {
            return false;
        }
        // SAFETY: IsWindowVisible accepts this borrowed HWND without changing window state.
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(
                windows::Win32::Foundation::HWND(hwnd as *mut _),
            )
            .as_bool()
        }
    })
    .unwrap_or(false)
}
fn publish(app: &WorkerApp, cached: &RwLock<AudioSpectrum>, spectrum: AudioSpectrum) {
    let mut previous = cached.write().unwrap();
    let changed = previous.available != spectrum.available || previous.bands != spectrum.bands;
    *previous = spectrum.clone();
    drop(previous);
    if changed || spectrum.available {
        with_app(app, |app| {
            let _ = app.emit("audio://spectrum", &spectrum);
        });
    }
}
pub fn spawn_visualizer(app: WorkerApp) -> std::io::Result<VisualizerHandle> {
    let control = Arc::new(Control::default());
    let cached_spectrum = Arc::new(RwLock::new(AudioSpectrum::default()));
    let worker_control = control.clone();
    let worker_cached = cached_spectrum.clone();
    let thread = std::thread::Builder::new()
        .name("audio-visualizer-loopback".into())
        .spawn(move || {
            if run_visualizer_worker(&app, &worker_control, &worker_cached).is_err() {
                publish(&app, &worker_cached, AudioSpectrum::default());
                // COM startup failure is terminal for this worker, not an endless retry/log loop.
            }
        })?;
    Ok(VisualizerHandle {
        control,
        cached_spectrum,
        thread: Mutex::new(Some(thread)),
    })
}
fn run_visualizer_worker(
    app: &WorkerApp,
    control: &Control,
    cached: &RwLock<AudioSpectrum>,
) -> windows::core::Result<()> {
    let _apartment = Apartment::enter()?;
    // SAFETY: COM is initialized; the enumerator is used and dropped only on this MTA.
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let mut session: Option<LoopbackSession> = None;
    let mut endpoint: Option<(IMMDevice, String)> = None;
    let mut active = false;
    let mut endpoint_tracker = capture::EndpointTracker::default();
    let mut unsupported_endpoint: Option<String> = None;
    let mut next_probe = Instant::now();
    let mut next_open = Instant::now();
    let mut retry_delay = Duration::from_millis(500);
    while !control.stopped() && app.strong_count() > 0 {
        let want = control.enabled() && is_island_visible(app);
        if !want {
            session = None;
            endpoint = None;
            endpoint_tracker.update(None);
            unsupported_endpoint = None;
            publish(
                app,
                cached,
                AudioSpectrum {
                    sampled_at: now_epoch_ms(),
                    ..Default::default()
                },
            );
            active = false;
            retry_delay = Duration::from_millis(500);
            next_probe = Instant::now();
            next_open = Instant::now();
            if control.enabled() {
                control.wait(Duration::from_millis(200));
            } else {
                control.wait_enabled();
            }
            continue;
        }
        if !active {
            next_probe = Instant::now();
            next_open = Instant::now();
            active = true;
        }
        let now = Instant::now();
        if now >= next_probe {
            next_probe = now + Duration::from_secs(1);
            endpoint = default_endpoint(&enumerator).ok();
            let switched = endpoint_tracker.update(endpoint.as_ref().map(|(_, id)| id.as_str()));
            if switched {
                unsupported_endpoint = None;
                session = None;
                next_open = now;
                retry_delay = Duration::from_millis(500);
                publish(
                    app,
                    cached,
                    AudioSpectrum {
                        sampled_at: now_epoch_ms(),
                        ..Default::default()
                    },
                );
            }
        }
        if session.is_none()
            && now >= next_open
            && let Some((device, id)) = &endpoint
            && unsupported_endpoint.as_ref() != Some(id)
        {
            match open_loopback_session(device) {
                Ok(opened) => {
                    session = Some(opened);
                    retry_delay = Duration::from_millis(500);
                }
                Err(error) => {
                    if error.code() == invalid_format().code()
                        || error.code()
                            == windows::Win32::Media::Audio::AUDCLNT_E_UNSUPPORTED_FORMAT
                    {
                        // Unsupported formats are not transient: wait for endpoint/activation change.
                        unsupported_endpoint = Some(id.clone());
                    }
                    next_open = now + retry_delay;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                    publish(
                        app,
                        cached,
                        AudioSpectrum {
                            sampled_at: now_epoch_ms(),
                            ..Default::default()
                        },
                    );
                }
            }
        }
        if let Some(capture) = session.as_mut() {
            let rate = capture.reader.format.rate;
            let result = capture.samples.drain(&mut capture.reader, rate, || {
                !control.stopped() && control.enabled() && is_island_visible(app)
            });
            match result {
                Ok(Some(bands)) => publish(
                    app,
                    cached,
                    AudioSpectrum {
                        available: true,
                        bands,
                        sampled_at: now_epoch_ms(),
                    },
                ),
                Ok(None) => {
                    session = None;
                    publish(
                        app,
                        cached,
                        AudioSpectrum {
                            sampled_at: now_epoch_ms(),
                            ..Default::default()
                        },
                    );
                }
                Err(_) => {
                    session = None;
                    next_open = Instant::now() + retry_delay;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                    publish(
                        app,
                        cached,
                        AudioSpectrum {
                            sampled_at: now_epoch_ms(),
                            ..Default::default()
                        },
                    );
                }
            }
        }
        control.wait(Duration::from_millis(if session.is_some() {
            50
        } else {
            200
        }));
    }
    drop(session);
    publish(
        app,
        cached,
        AudioSpectrum {
            sampled_at: now_epoch_ms(),
            ..Default::default()
        },
    );
    Ok(())
}
