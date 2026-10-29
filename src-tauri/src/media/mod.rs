//! Media control through SMTC (`GlobalSystemMediaTransportControlsSessionManager`).
//! Owner: R2 (Rust-System).
//!
//! Separate MTA lanes for FIFO commands and slow metadata/artwork reads. No stream, properties or
//! session interface crosses threads. Events invalidate in-flight reads before posting a refresh.

mod apartment;
mod artwork;
mod delivery;
mod state;

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager_,
};
use windows::Storage::Streams::DataReader;

use crate::db::now_ms;
use delivery::{Command, Delivery, PendingCommand, REPLY_TIMEOUT, Revision};
use state::{MediaState, PlaybackStatus};

/// Some apps (Spotify) update the thumbnail later than the title: re-read it once after a track change.
const ARTWORK_RECHECK: Duration = Duration::from_millis(1500);
const WINRT_TIMEOUT: Duration = Duration::from_secs(2);

/// Bound the wait without moving apartment-bound WinRT stream interfaces off the SMTC thread.
/// GetResults is called only after Status leaves Started; no unbounded join/get is used.
fn wait_for_winrt<T>(
    timeout: Duration,
    mut poll: impl FnMut() -> windows::core::Result<Option<T>>,
    cancel: impl FnOnce() -> windows::core::Result<()>,
    current: impl Fn() -> bool,
) -> windows::core::Result<T> {
    let start = Instant::now();
    loop {
        if !current() {
            let _ = cancel();
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x8007_04C7u32 as i32),
                "media operation superseded",
            ));
        }
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
    ($op:expr, $current:expr) => {{
        let op = &$op;
        wait_for_winrt(WINRT_TIMEOUT, || {
            // AsyncStatus::Started = 0. Read the result only after completion/error/cancellation.
            if op.Status()?.0 == 0 { Ok(None) } else { op.GetResults().map(Some) }
        }, || op.Cancel(), $current)
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
}

/// Managed state: channel to the media thread.
pub struct MediaHandle {
    commands: SyncSender<PendingCommand>,
    delivery: Delivery,
}

impl MediaHandle {
    fn enqueue(&self, command: Command) -> Result<Receiver<Result<(), String>>, String> {
        let (tx, rx) = mpsc::channel();
        self.commands
            .try_send(PendingCommand {
                command,
                session: self.delivery.revision().session,
                deadline: Instant::now() + REPLY_TIMEOUT,
                reply: tx,
            })
            .map_err(|error| format!("cannot queue media command: {error}"))?;
        Ok(rx)
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel();
    let (commands, command_rx) = mpsc::sync_channel(delivery::COMMAND_CAPACITY);
    let delivery = Delivery::default();
    app.manage(MediaHandle {
        commands,
        delivery: delivery.clone(),
    });
    let command_delivery = delivery.clone();
    let command_refresh = tx.clone();
    std::thread::Builder::new()
        .name("media-commands".into())
        .spawn(move || {
            if let Err(error) = run_commands(command_rx, command_delivery, command_refresh) {
                log::error!("media: command thread stopped: {error}");
            }
        })?;
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("media-smtc".into())
        .spawn(move || {
            if let Err(e) = run(handle, tx, rx, delivery) {
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
    delivery: Delivery,
    manager_token: i64,
    art: artwork::Cache,
    recheck_at: Option<Instant>,
}

fn run(
    app: AppHandle,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    delivery: Delivery,
) -> windows::core::Result<()> {
    let _apartment = apartment::Apartment::enter()?;
    let op = Manager_::RequestAsync()?;
    let manager = wait_winrt!(op, || true)?;
    let sender = tx.clone();
    let events = delivery.clone();
    let manager_token = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        events.invalidate(true);
        let _ = sender.send(Msg::SessionChanged);
        Ok(())
    }))?;
    let mut w = Worker {
        app,
        tx: tx.clone(),
        manager: manager.clone(),
        session: None,
        delivery,
        manager_token,
        art: artwork::Cache::default(),
        recheck_at: None,
    };
    log::info!("media: SMTC session manager ready");
    w.attach_current();
    w.refresh(false);

    loop {
        let msg = match w.recheck_at {
            Some(d) => rx.recv_timeout(d.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match msg {
            Ok(Msg::SessionChanged) => {
                w.attach_current();
                w.refresh(false);
            }
            Ok(Msg::Refresh) => {
                // Coalesce queued event bursts without adding a quiet-period delay.
                while let Ok(message) = rx.try_recv() {
                    if matches!(message, Msg::SessionChanged) {
                        w.attach_current();
                    }
                }
                w.refresh(false);
            }
            Err(RecvTimeoutError::Timeout) => {
                w.recheck_at = None;
                w.refresh(true);
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
        // Reset even when a new session exposes identical title/artist/source strings.
        self.publish(self.delivery.revision(), MediaState::none(now_ms()));
        let Ok(session) = self.manager.GetCurrentSession() else {
            return; // no session
        };
        let subscribe = || -> windows::core::Result<Tokens> {
            let (a, b, c) = (self.tx.clone(), self.tx.clone(), self.tx.clone());
            let events = self.delivery.clone();
            let media = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                events.invalidate(false);
                let _ = a.send(Msg::Refresh);
                Ok(())
            }))?;
            let playback_events = self.delivery.clone();
            let playback =
                match session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                    playback_events.invalidate_playback();
                    let _ = b.send(Msg::Refresh);
                    Ok(())
                })) {
                    Ok(token) => token,
                    Err(error) => {
                        let _ = session.RemoveMediaPropertiesChanged(media);
                        return Err(error);
                    }
                };
            let timeline_events = self.delivery.clone();
            let timeline =
                match session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    timeline_events.invalidate_playback();
                    let _ = c.send(Msg::Refresh);
                    Ok(())
                })) {
                    Ok(token) => token,
                    Err(error) => {
                        let _ = session.RemoveMediaPropertiesChanged(media);
                        let _ = session.RemovePlaybackInfoChanged(playback);
                        return Err(error);
                    }
                };
            Ok(Tokens {
                media,
                playback,
                timeline,
            })
        };
        match subscribe() {
            Ok(tokens) => self.session = Some((session, tokens)),
            Err(e) => log::warn!("media: cannot subscribe to session events: {e}"),
        }
    }

    /// Rebuilds the state and emits it if it changed. `force_art` re-reads the thumbnail.
    fn refresh(&mut self, force_art: bool) {
        let current = self.manager.GetCurrentSession().ok();
        if current.as_ref() != self.session.as_ref().map(|(session, _)| session) {
            self.attach_current();
        }
        let revision = self.delivery.revision();
        let Some(session) = self.session.as_ref().map(|(s, _)| s.clone()) else {
            self.publish(revision, MediaState::none(now_ms()));
            return;
        };
        match self.read_session(&session, revision, force_art) {
            Ok(()) => {}
            Err(e) => {
                // A timeout must not replace an otherwise usable session with an empty player.
                if self.delivery.is_current(revision) {
                    log::debug!("media: cannot read session: {e}");
                }
            }
        }
    }

    fn publish(&self, revision: Revision, state: MediaState) -> bool {
        self.delivery.publish(revision, state, |state| {
            let _ = self.app.emit("media://changed", state);
        })
    }

    fn read_session(
        &mut self,
        session: &Session,
        revision: Revision,
        force_art: bool,
    ) -> windows::core::Result<()> {
        let source_app = session.SourceAppUserModelId()?.to_string();
        let op = session.TryGetMediaPropertiesAsync()?;
        let props = wait_winrt!(op, || self.delivery.after_metadata(revision).is_some())?;
        let Some(revision) = self.delivery.after_metadata(revision) else {
            return Ok(());
        };
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
        let now = now_ms();
        let position_ms = state::current_position_ms(
            state::ticks_to_ms(pos - start),
            updated,
            now,
            rate,
            status == PlaybackStatus::Playing,
            duration_ms,
        );

        let key = format!("{source_app}\u{1}{title}\u{1}{artist}\u{1}{album}");
        let same_track = self.art.matches(&key);
        let artwork = self.art.cached(&key);
        let mut state = MediaState {
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
        };
        if self.manager.GetCurrentSession().ok().as_ref() != Some(session)
            || !self.publish(revision, state.clone())
        {
            return Ok(());
        }
        if !same_track {
            self.recheck_at = Some(Instant::now() + ARTWORK_RECHECK);
        }
        let previous_cache = self.art.clone();
        state.artwork = self.art.resolve(&key, force_art, || {
            read_thumbnail(&props, || self.delivery.is_current(revision))
        });
        if !self.delivery.is_current(revision) {
            self.art = previous_cache;
            return Ok(());
        }
        // Keep the timeline sample from before artwork I/O; the UI extrapolates it normally.
        if self.manager.GetCurrentSession().ok().as_ref() == Some(session) {
            self.publish(revision, state);
        }
        Ok(())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if let Some((session, tokens)) = self.session.take() {
            let _ = session.RemoveMediaPropertiesChanged(tokens.media);
            let _ = session.RemovePlaybackInfoChanged(tokens.playback);
            let _ = session.RemoveTimelinePropertiesChanged(tokens.timeline);
        }
        let _ = self.manager.RemoveCurrentSessionChanged(self.manager_token);
    }
}

/// Raw bytes of the session thumbnail, if there is one.
fn read_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    current: impl Fn() -> bool,
) -> Option<Vec<u8>> {
    let thumb = props.Thumbnail().ok()?;
    let op = thumb.OpenReadAsync().ok()?;
    let stream = wait_winrt!(op, &current).ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > artwork::MAX_INPUT_BYTES as u64 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let op = reader.LoadAsync(size as u32).ok()?;
    wait_winrt!(op, &current).ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(buf)
}

// ───────────────────────────── commands ─────────────────────────────

fn run_commands(
    rx: Receiver<PendingCommand>,
    delivery: Delivery,
    refresh: Sender<Msg>,
) -> windows::core::Result<()> {
    let _apartment = apartment::Apartment::enter()?;
    let op = Manager_::RequestAsync()?;
    let manager = wait_winrt!(op, || true)?;
    delivery::command_loop(
        rx,
        &delivery,
        |command, expected_session, deadline| {
            // Resolve at delivery, never use the reader's potentially outdated session.
            let session = manager
                .GetCurrentSession()
                .map_err(|_| "no media session")?;
            let current =
                || delivery.revision().session == expected_session && Instant::now() < deadline;
            if !current() {
                return Err("media session changed before command delivery".into());
            }
            let op = match command {
                Command::Action(MediaAction::PlayPause) => session.TryTogglePlayPauseAsync(),
                Command::Action(MediaAction::Next) => session.TrySkipNextAsync(),
                Command::Action(MediaAction::Previous) => session.TrySkipPreviousAsync(),
                Command::Seek(position_ms) => {
                    // Position is relative to timeline start. Do not silently seek from 0 on error.
                    let start = session
                        .GetTimelineProperties()
                        .and_then(|timeline| timeline.StartTime())
                        .map_err(|error| error.to_string())?
                        .Duration;
                    let ticks = start.saturating_add(state::ms_to_ticks(position_ms.max(0)));
                    session.TryChangePlaybackPositionAsync(ticks)
                }
            }
            .map_err(|error| error.to_string())?;
            let accepted = wait_winrt!(op, current).map_err(|error| error.to_string())?;
            if manager.GetCurrentSession().ok().as_ref() != Some(&session) {
                return Err("media session changed during command delivery".into());
            }
            Ok(accepted)
        },
        || {
            // Wake a reader stuck on an old thumbnail even if the provider delays its events.
            // This requests fresh facts; it never assumes that the command changed the track.
            delivery.invalidate(false);
            let _ = refresh.send(Msg::Refresh);
        },
    );
    Ok(())
}

async fn receive_reply(rx: Receiver<Result<(), String>>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "media command thread did not answer".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn media_get_state(handle: State<'_, MediaHandle>) -> Result<MediaState, String> {
    Ok(handle.delivery.cached(now_ms()))
}

#[tauri::command]
pub async fn media_action(
    handle: State<'_, MediaHandle>,
    action: MediaAction,
) -> Result<(), String> {
    // Enqueue before yielding to the runtime: spawn_blocking scheduling cannot reorder commands.
    receive_reply(handle.enqueue(Command::Action(action))?).await
}

#[tauri::command]
pub async fn media_seek(handle: State<'_, MediaHandle>, position_ms: i64) -> Result<(), String> {
    receive_reply(handle.enqueue(Command::Seek(position_ms))?).await
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
            || true,
        )
        .unwrap();
        assert_eq!(value, 42);
        let error = windows::core::HRESULT(0x8000_4005u32 as i32);
        let result = wait_for_winrt::<()>(
            Duration::from_millis(20),
            || Err(windows::core::Error::from_hresult(error)),
            || panic!("completed operation must not be cancelled"),
            || true,
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
            || true,
        );
        assert_eq!(
            result.unwrap_err().code(),
            windows::core::HRESULT(0x8007_05B4u32 as i32)
        );
        assert!(cancelled);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn superseded_winrt_read_is_cancelled_without_polling_or_waiting() {
        let mut cancelled = false;
        let result = wait_for_winrt::<()>(
            WINRT_TIMEOUT,
            || panic!("stale operation must not read results"),
            || {
                cancelled = true;
                Ok(())
            },
            || false,
        );
        assert!(cancelled);
        assert_eq!(
            result.unwrap_err().code(),
            windows::core::HRESULT(0x8007_04C7u32 as i32)
        );
    }
}
