//! Media control through SMTC (`GlobalSystemMediaTransportControlsSessionManager`).
//! Owner: R2 (Rust-System).
//!
//! One dedicated MTA thread owns the session manager and the current session. WinRT event handlers
//! only post a message to that thread; bursts are debounced (~100 ms) and `media://changed` is
//! emitted only when something relevant changed (see [`state::state_changed`]).

mod artwork;
mod state;

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager_,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

use crate::db::now_ms;
use state::{MediaState, PlaybackStatus};

/// Quiet period after the last event before the state is rebuilt.
const DEBOUNCE: Duration = Duration::from_millis(100);
/// A burst of events never delays the update longer than this.
const MAX_DEBOUNCE: Duration = Duration::from_millis(300);
/// Some apps (Spotify) update the thumbnail later than the title: re-read it once after a track change.
const ARTWORK_RECHECK: Duration = Duration::from_millis(1500);
/// How long a command waits for the media thread.
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
const WINRT_TIMEOUT: Duration = Duration::from_secs(2);

/// Bound the wait without moving apartment-bound WinRT stream interfaces off the SMTC thread.
/// GetResults is called only after Status leaves Started; no unbounded join/get is used.
fn wait_for_winrt<T>(
    timeout: Duration,
    mut poll: impl FnMut() -> windows::core::Result<Option<T>>,
    cancel: impl FnOnce() -> windows::core::Result<()>,
) -> windows::core::Result<T> {
    let start = Instant::now();
    loop {
        if let Some(result) = poll()? {
            return Ok(result);
        }
        if start.elapsed() >= timeout {
            let _ = cancel();
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x8007_05B4u32 as i32),
                format!("WinRT operation did not complete within {timeout:?}"),
            ));
        }
        std::thread::sleep(Duration::from_millis(5).min(timeout.saturating_sub(start.elapsed())));
    }
}

macro_rules! wait_winrt {
    ($op:expr) => {{
        let op = &$op;
        wait_for_winrt(WINRT_TIMEOUT, || {
            // AsyncStatus::Started = 0. Read the result only after completion/error/cancellation.
            if op.Status()?.0 == 0 { Ok(None) } else { op.GetResults().map(Some) }
        }, || op.Cancel())
    }};
}

#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
}

enum Msg {
    /// The current session changed (re-subscribe, then refresh).
    SessionChanged,
    /// Something in the current session changed.
    Refresh,
    Query(Sender<MediaState>),
    Action(MediaAction, Sender<Result<(), String>>),
    Seek(i64, Sender<Result<(), String>>),
}

/// Managed state: channel to the media thread.
pub struct MediaHandle(Sender<Msg>);

impl MediaHandle {
    fn request<T: Send + 'static>(&self, make: impl FnOnce(Sender<T>) -> Msg) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.0
            .send(make(tx))
            .map_err(|_| "media thread is not running")?;
        rx.recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "media thread did not answer".to_string())
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel();
    app.manage(MediaHandle(tx.clone()));
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("media-smtc".into())
        .spawn(move || {
            if let Err(e) = run(handle, tx, rx) {
                log::error!("media: SMTC thread stopped: {e}");
            }
        })?;
    Ok(())
}

// ───────────────────────────── worker thread ─────────────────────────────

struct Tokens {
    media: i64,
    playback: i64,
    timeline: i64,
}

struct Worker {
    app: AppHandle,
    tx: Sender<Msg>,
    manager: Manager_,
    session: Option<(Session, Tokens)>,
    last_emitted: Option<MediaState>,
    art: artwork::Cache,
    recheck_at: Option<Instant>,
}

fn run(app: AppHandle, tx: Sender<Msg>, rx: Receiver<Msg>) -> windows::core::Result<()> {
    // SAFETY: initialises COM for this dedicated thread (MTA); called once at thread start.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let op = Manager_::RequestAsync()?;
    let manager = wait_winrt!(op)?;
    let mut w = Worker {
        app,
        tx: tx.clone(),
        manager: manager.clone(),
        session: None,
        last_emitted: None,
        art: artwork::Cache::default(),
        recheck_at: None,
    };
    let sender = tx.clone();
    manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        let _ = sender.send(Msg::SessionChanged);
        Ok(())
    }))?;
    log::info!("media: SMTC session manager ready");
    w.attach_current();
    w.refresh(false);

    let mut first_dirty: Option<Instant> = None;
    let mut last_dirty = Instant::now();
    loop {
        // Wake up for the debounce deadline or the artwork re-check, whichever is first.
        let mut deadline = None::<Instant>;
        if let Some(first) = first_dirty {
            deadline = Some((last_dirty + DEBOUNCE).min(first + MAX_DEBOUNCE));
        }
        if let Some(at) = w.recheck_at {
            deadline = Some(deadline.map_or(at, |d| d.min(at)));
        }
        let msg = match deadline {
            Some(d) => rx.recv_timeout(d.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match msg {
            Ok(Msg::SessionChanged) => {
                w.attach_current();
                first_dirty.get_or_insert_with(Instant::now);
                last_dirty = Instant::now();
            }
            Ok(Msg::Refresh) => {
                first_dirty.get_or_insert_with(Instant::now);
                last_dirty = Instant::now();
            }
            Ok(Msg::Query(reply)) => {
                first_dirty = None;
                let _ = reply.send(w.refresh(false));
            }
            Ok(Msg::Action(action, reply)) => {
                let _ = reply.send(w.action(action));
            }
            Ok(Msg::Seek(ms, reply)) => {
                let _ = reply.send(w.seek(ms));
            }
            Err(RecvTimeoutError::Timeout) => {
                let now = Instant::now();
                let recheck_due = w.recheck_at.is_some_and(|at| now >= at);
                let debounce_due = first_dirty
                    .is_some_and(|f| now >= (last_dirty + DEBOUNCE).min(f + MAX_DEBOUNCE));
                if recheck_due {
                    w.recheck_at = None;
                }
                if recheck_due || debounce_due {
                    first_dirty = None;
                    w.refresh(recheck_due);
                }
            }
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

impl Worker {
    /// Unsubscribes from the old session and subscribes to the current one (if any).
    fn attach_current(&mut self) {
        self.art = artwork::Cache::default();
        self.recheck_at = None;
        if let Some((old, t)) = self.session.take() {
            let _ = old.RemoveMediaPropertiesChanged(t.media);
            let _ = old.RemovePlaybackInfoChanged(t.playback);
            let _ = old.RemoveTimelinePropertiesChanged(t.timeline);
        }
        let Ok(session) = self.manager.GetCurrentSession() else {
            return; // no session
        };
        let subscribe = || -> windows::core::Result<Tokens> {
            let (a, b, c) = (self.tx.clone(), self.tx.clone(), self.tx.clone());
            Ok(Tokens {
                media: session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = a.send(Msg::Refresh);
                    Ok(())
                }))?,
                playback: session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = b.send(Msg::Refresh);
                    Ok(())
                }))?,
                timeline: session.TimelinePropertiesChanged(&TypedEventHandler::new(
                    move |_, _| {
                        let _ = c.send(Msg::Refresh);
                        Ok(())
                    },
                ))?,
            })
        };
        match subscribe() {
            Ok(tokens) => self.session = Some((session, tokens)),
            Err(e) => log::warn!("media: cannot subscribe to session events: {e}"),
        }
    }

    /// Rebuilds the state and emits it if it changed. `force_art` re-reads the thumbnail.
    fn refresh(&mut self, force_art: bool) -> MediaState {
        let state = self.build_state(force_art);
        let changed = self
            .last_emitted
            .as_ref()
            .is_none_or(|old| state::state_changed(old, &state));
        if changed {
            self.last_emitted = Some(state.clone());
            let _ = self.app.emit("media://changed", &state);
        }
        state
    }

    fn build_state(&mut self, force_art: bool) -> MediaState {
        let now = now_ms();
        let Some(session) = self.session.as_ref().map(|(s, _)| s.clone()) else {
            return MediaState::none(now);
        };
        match self.read_session(&session, now, force_art) {
            Ok(s) => s,
            Err(e) => {
                log::debug!("media: cannot read session: {e}");
                MediaState::none(now)
            }
        }
    }

    fn read_session(
        &mut self,
        session: &Session,
        now: i64,
        force_art: bool,
    ) -> windows::core::Result<MediaState> {
        let source_app = session.SourceAppUserModelId()?.to_string();
        let op = session.TryGetMediaPropertiesAsync()?;
        let props = wait_winrt!(op)?;
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();
        let album = props.AlbumTitle()?.to_string();

        let playback = session.GetPlaybackInfo()?;
        let status = state::map_status(playback.PlaybackStatus()?.0);
        let controls = playback.Controls()?;
        let can_play_pause = controls.IsPlayPauseToggleEnabled().unwrap_or(false)
            || controls.IsPlayEnabled().unwrap_or(false)
            || controls.IsPauseEnabled().unwrap_or(false);
        let rate = playback
            .PlaybackRate()
            .and_then(|r| r.Value())
            .unwrap_or(1.0);

        let tl = session.GetTimelineProperties()?;
        let start = tl.StartTime().map_or(0, |t| t.Duration);
        let end = tl.EndTime().map_or(0, |t| t.Duration);
        let pos = tl.Position().map_or(0, |t| t.Duration);
        let updated = tl
            .LastUpdatedTime()
            .map_or(0, |t| state::universal_ticks_to_epoch_ms(t.UniversalTime));
        let duration_ms = state::ticks_to_ms(end - start).max(0);
        let position_ms = state::current_position_ms(
            state::ticks_to_ms(pos - start),
            updated,
            now,
            rate,
            status == PlaybackStatus::Playing,
            duration_ms,
        );

        let key = format!("{source_app}\u{1}{title}\u{1}{artist}\u{1}{album}");
        let artwork = self.artwork_for(&key, &props, force_art);

        Ok(MediaState {
            has_session: true,
            source_app,
            title,
            artist,
            album,
            artwork,
            status,
            position_ms,
            duration_ms,
            position_sampled_at: now,
            can_play_pause,
            can_next: controls.IsNextEnabled().unwrap_or(false),
            can_previous: controls.IsPreviousEnabled().unwrap_or(false),
            can_seek: controls.IsPlaybackPositionEnabled().unwrap_or(false),
        })
    }

    /// Artwork data URL for the track; decoded/encoded only when the track or the thumbnail changed.
    fn artwork_for(
        &mut self,
        key: &str,
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
        force: bool,
    ) -> Option<String> {
        let same_track = self.art.matches(key);
        if !same_track {
            self.recheck_at = Some(Instant::now() + ARTWORK_RECHECK);
        }
        self.art.resolve(key, force, || read_thumbnail(props))
    }

    fn action(&self, action: MediaAction) -> Result<(), String> {
        let (session, _) = self.session.as_ref().ok_or("no media session")?;
        let op = match action {
            MediaAction::PlayPause => session.TryTogglePlayPauseAsync(),
            MediaAction::Next => session.TrySkipNextAsync(),
            MediaAction::Previous => session.TrySkipPreviousAsync(),
        };
        let op = op.map_err(|e| e.to_string())?;
        let accepted = wait_winrt!(op).map_err(|e| e.to_string())?;
        if accepted {
            Ok(())
        } else {
            Err("the media app rejected the command".into())
        }
    }

    fn seek(&self, position_ms: i64) -> Result<(), String> {
        let (session, _) = self.session.as_ref().ok_or("no media session")?;
        // Positions are relative to the timeline start (almost always 0).
        let start = session
            .GetTimelineProperties()
            .and_then(|t| t.StartTime())
            .map_or(0, |t| t.Duration);
        let ticks = start.saturating_add(state::ms_to_ticks(position_ms.max(0)));
        let op = session
            .TryChangePlaybackPositionAsync(ticks)
            .map_err(|e| e.to_string())?;
        let accepted = wait_winrt!(op).map_err(|e| e.to_string())?;
        if accepted {
            Ok(())
        } else {
            Err("the media app rejected the seek".into())
        }
    }
}

/// Raw bytes of the session thumbnail, if there is one.
fn read_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<Vec<u8>> {
    let thumb = props.Thumbnail().ok()?;
    let op = thumb.OpenReadAsync().ok()?;
    let stream = wait_winrt!(op).ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > artwork::MAX_INPUT_BYTES as u64 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let op = reader.LoadAsync(size as u32).ok()?;
    wait_winrt!(op).ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(buf)
}

// ───────────────────────────── commands ─────────────────────────────

#[tauri::command]
pub async fn media_get_state(handle: State<'_, MediaHandle>) -> Result<MediaState, String> {
    let tx = handle.0.clone();
    tauri::async_runtime::spawn_blocking(move || MediaHandle(tx).request(Msg::Query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_action(
    handle: State<'_, MediaHandle>,
    action: MediaAction,
) -> Result<(), String> {
    let tx = handle.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        MediaHandle(tx).request(|r| Msg::Action(action, r))?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_seek(handle: State<'_, MediaHandle>, position_ms: i64) -> Result<(), String> {
    let tx = handle.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        MediaHandle(tx).request(|r| Msg::Seek(position_ms, r))?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_returns_value_and_original_error() {
        let value = wait_for_winrt(
            Duration::from_millis(20),
            || Ok(Some(42)),
            || panic!("completed operation must not be cancelled"),
        )
        .unwrap();
        assert_eq!(value, 42);
        let error = windows::core::HRESULT(0x8000_4005u32 as i32);
        let result = wait_for_winrt::<()>(
            Duration::from_millis(20),
            || Err(windows::core::Error::from_hresult(error)),
            || panic!("completed operation must not be cancelled"),
        );
        assert_eq!(result.unwrap_err().code(), error);
    }

    #[test]
    fn stalled_completion_times_out_and_cancels() {
        let mut cancelled = false;
        let started = Instant::now();
        let result = wait_for_winrt::<()>(
            Duration::from_millis(10),
            || Ok(None),
            || {
                cancelled = true;
                Ok(())
            },
        );
        assert_eq!(
            result.unwrap_err().code(),
            windows::core::HRESULT(0x8007_05B4u32 as i32)
        );
        assert!(cancelled);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
