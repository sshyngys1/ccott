//! Cursor polling thread: click-through outside the island shape, `island://hover` events.
//!
//! The window is always "ignoring cursor events" (clicks fall through) except while the cursor is
//! over the visible shape; since a click-through window receives no mouse messages, the cursor is
//! polled with `GetCursorPos`. Everything the loop needs is a Win32 query (no main-thread round
//! trips), the sleep adapts to how close the cursor is to the window.
//!
//! `island://hover` is only emitted on transitions, so a page that loads (or reloads) while the
//! cursor is already over the shape would never learn that `inside` is `true`. [`HoverSync`]
//! decides when the current state is emitted again (on `island_set_mode`, on the first
//! `island_set_shape` after a page load and, rarely, on later `island_set_shape` calls).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::Foundation::HWND;

use super::IslandState;
use super::native;
use super::shape::{hover_inside, screen_to_window_css};
use super::styles::hwnd_of;
use super::types::{HoverPayload, IslandMode};

/// Cursor is close to the window (within `NEAR_MARGIN_PX` physical px): poll at ~60 Hz.
const FAST_INTERVAL: Duration = Duration::from_millis(16);
/// Far away, island expanded: ~30 Hz (the panel may be about to close).
const MEDIUM_INTERVAL: Duration = Duration::from_millis(33);
/// Far away, island collapsed: ~15 Hz, effectively 0% CPU.
const SLOW_INTERVAL: Duration = Duration::from_millis(66);
/// Window hidden: just wait.
const HIDDEN_INTERVAL: Duration = Duration::from_millis(250);
const NEAR_MARGIN_PX: i32 = 120;

/// `island_set_shape` re-emits the hover state at most this often (the UI calls it every frame
/// while animating; the re-emit only guards against a lost event).
pub const REEMIT_GAP: Duration = Duration::from_millis(1000);

pub const HOVER_EVENT: &str = "island://hover";

/// Decides when the current `inside` value must be emitted again (pure, unit-tested; the clock is
/// passed in).
#[derive(Debug)]
pub struct HoverSync {
    /// The page was (re)loaded and has not called `island_set_shape` / `island_set_mode` yet.
    fresh_page: bool,
    last_emit: Option<Instant>,
}

impl Default for HoverSync {
    fn default() -> Self {
        Self::new()
    }
}

impl HoverSync {
    pub fn new() -> Self {
        // A page is about to load at startup, so the first call always re-emits.
        Self {
            fresh_page: true,
            last_emit: None,
        }
    }

    /// The WebView started or finished loading a page: its listeners are new.
    pub fn page_loaded(&mut self) {
        self.fresh_page = true;
    }

    /// A hover event was emitted at `now`.
    pub fn note_emit(&mut self, now: Instant) {
        self.last_emit = Some(now);
    }

    /// `island_set_shape` at `now`: re-emit on the first call after a page load, otherwise only
    /// when the last emit is older than [`REEMIT_GAP`].
    pub fn on_set_shape(&mut self, now: Instant) -> bool {
        let stale = self
            .last_emit
            .is_none_or(|t| now.saturating_duration_since(t) > REEMIT_GAP);
        let due = self.fresh_page || stale;
        if due {
            self.fresh_page = false;
            self.last_emit = Some(now);
        }
        due
    }

    /// `island_set_mode` at `now`: always re-emit (rare call, the UI has just changed state).
    pub fn on_set_mode(&mut self, now: Instant) -> bool {
        self.fresh_page = false;
        self.last_emit = Some(now);
        true
    }
}

/// Hover state change found by the polling thread: remember it and tell the UI. The emit happens
/// under the `HoverSync` lock so a concurrent re-emit can never deliver an older value last.
fn publish(app: &AppHandle, state: &IslandState, inside: bool) {
    let mut sync = state.hover_sync.lock().unwrap_or_else(|e| e.into_inner());
    state.inside.store(inside, Ordering::Relaxed);
    let _ = app.emit(HOVER_EVENT, HoverPayload { inside });
    sync.note_emit(Instant::now());
}

fn emit_current(app: &AppHandle, state: &IslandState) {
    let inside = state.inside.load(Ordering::Relaxed);
    log::debug!("re-emitting island://hover inside={inside}");
    let _ = app.emit(HOVER_EVENT, HoverPayload { inside });
}

/// Called by `island_set_shape`.
pub fn resync_on_shape(app: &AppHandle, state: &IslandState) {
    let mut sync = state.hover_sync.lock().unwrap_or_else(|e| e.into_inner());
    if sync.on_set_shape(Instant::now()) {
        emit_current(app, state);
    }
}

/// Called by `island_set_mode`.
pub fn resync_on_mode(app: &AppHandle, state: &IslandState) {
    let mut sync = state.hover_sync.lock().unwrap_or_else(|e| e.into_inner());
    if sync.on_set_mode(Instant::now()) {
        emit_current(app, state);
    }
}

/// The island WebView started/finished loading a page.
pub fn page_loaded(state: &IslandState) {
    state
        .hover_sync
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .page_loaded();
}

/// Ask the hover thread to finish and wake it from its sleep.
pub fn stop(state: &IslandState) {
    state.stop.store(true, Ordering::Release);
    if let Some(t) = state
        .hover_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        t.unpark();
    }
}

/// Polling interval for the current situation (pure, unit-tested).
pub fn poll_interval(visible: bool, near: bool, mode: IslandMode) -> Duration {
    if !visible {
        HIDDEN_INTERVAL
    } else if near {
        FAST_INTERVAL
    } else if mode == IslandMode::Expanded {
        MEDIUM_INTERVAL
    } else {
        SLOW_INTERVAL
    }
}

/// Whether `cursor` is within `margin` px of the window rectangle `(l, t, r, b)` (pure).
pub fn is_near(cursor: (i32, i32), rect: (i32, i32, i32, i32), margin: i32) -> bool {
    cursor.0 >= rect.0 - margin
        && cursor.0 <= rect.2 + margin
        && cursor.1 >= rect.1 - margin
        && cursor.1 <= rect.3 + margin
}

pub fn spawn(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let window = window.clone();
    // The HWND is looked up once: `WebviewWindow::hwnd` is a round trip to the main thread, far
    // too expensive for a 60 Hz loop. (`HWND` is not `Send`, so it travels as an integer.)
    let hwnd_raw = match hwnd_of(&window) {
        Ok(h) => h.0 as isize,
        Err(e) => {
            log::error!("hover thread: no window handle: {e}");
            return;
        }
    };
    let state_app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("island-hover".into())
        .spawn(move || run(&app, &window, hwnd_raw));
    match spawned {
        Ok(handle) => {
            let state = state_app.state::<IslandState>();
            *state.hover_thread.lock().unwrap_or_else(|e| e.into_inner()) =
                Some(handle.thread().clone());
        }
        Err(e) => log::error!("cannot start the hover thread: {e}"),
    }
}

fn run(app: &AppHandle, window: &WebviewWindow, hwnd_raw: isize) {
    let state = app.state::<IslandState>();
    let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
    let mut inside = false;
    while !state.stop.load(Ordering::Acquire) {
        let mode = *state.mode.read().unwrap_or_else(|e| e.into_inner());
        let visible = native::is_visible(hwnd);
        let mut near = false;

        if !visible {
            // A hidden window gets no clicks and the cursor position means nothing: drop the
            // `inside` state once (one event) and go back to click-through.
            if inside {
                inside = false;
                log::debug!("island hidden: hover reset");
                publish(app, &state, false);
                if let Err(e) = window.set_ignore_cursor_events(true) {
                    log::warn!("set_ignore_cursor_events failed: {e}");
                }
            }
        } else if let (Some(cursor), Some(rect)) = (native::cursor_pos(), native::window_rect(hwnd))
        {
            near = is_near(cursor, rect, NEAR_MARGIN_PX);
            let scale = native::window_scale(hwnd);
            let (px, py) = screen_to_window_css(cursor, (rect.0, rect.1), scale);
            // Copy the shape out so no lock is held while talking to the window.
            let shape = *state.shape.read().unwrap_or_else(|e| e.into_inner());
            let now_inside = hover_inside(&shape, px, py, inside);
            if now_inside != inside {
                inside = now_inside;
                if let Err(e) = window.set_ignore_cursor_events(!inside) {
                    log::warn!("set_ignore_cursor_events failed: {e}");
                }
                log::debug!("hover inside={inside} css=({px:.1},{py:.1})");
                publish(app, &state, inside);
            }
        }

        // `stop()` unparks the thread, so shutdown does not wait for the sleep to run out.
        std::thread::park_timeout(poll_interval(visible, near, mode));
    }
    log::debug!("hover thread stopped");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_adapts_to_distance_and_mode() {
        assert_eq!(
            poll_interval(true, true, IslandMode::Collapsed),
            FAST_INTERVAL
        );
        assert_eq!(
            poll_interval(true, true, IslandMode::Expanded),
            FAST_INTERVAL
        );
        assert_eq!(
            poll_interval(true, false, IslandMode::Collapsed),
            SLOW_INTERVAL
        );
        assert_eq!(
            poll_interval(true, false, IslandMode::Expanded),
            MEDIUM_INTERVAL
        );
        assert_eq!(
            poll_interval(false, true, IslandMode::Collapsed),
            HIDDEN_INTERVAL
        );
    }

    #[test]
    fn near_check_uses_inflated_rect() {
        let rect = (560, 0, 1360, 520);
        assert!(is_near((800, 100), rect, 120));
        assert!(is_near((560 - 120, 0), rect, 120));
        assert!(!is_near((560 - 121, 0), rect, 120));
        assert!(is_near((800, 520 + 120), rect, 120));
        assert!(!is_near((800, 520 + 121), rect, 120));
        assert!(!is_near((0, 1000), rect, 120));
    }

    #[test]
    fn first_set_shape_after_load_reemits() {
        let t0 = Instant::now();
        let mut s = HoverSync::new();
        assert!(s.on_set_shape(t0));
        // Following frames of the same page do not.
        assert!(!s.on_set_shape(t0 + Duration::from_millis(16)));
        assert!(!s.on_set_shape(t0 + Duration::from_millis(500)));
    }

    #[test]
    fn page_reload_resets_the_first_call() {
        let t0 = Instant::now();
        let mut s = HoverSync::new();
        assert!(s.on_set_shape(t0));
        s.note_emit(t0 + Duration::from_millis(10));
        // The hover thread emitted a moment ago, but the reloaded page has not heard it.
        s.page_loaded();
        assert!(s.on_set_shape(t0 + Duration::from_millis(20)));
        assert!(!s.on_set_shape(t0 + Duration::from_millis(30)));
    }

    #[test]
    fn set_mode_always_reemits_and_clears_fresh_flag() {
        let t0 = Instant::now();
        let mut s = HoverSync::new();
        assert!(s.on_set_mode(t0));
        assert!(s.on_set_mode(t0 + Duration::from_millis(1)));
        // The page is no longer fresh: a shape right after a mode call is quiet.
        assert!(!s.on_set_shape(t0 + Duration::from_millis(2)));
        s.page_loaded();
        assert!(s.on_set_mode(t0 + Duration::from_millis(3)));
        assert!(!s.on_set_shape(t0 + Duration::from_millis(4)));
    }

    #[test]
    fn set_shape_reemits_again_after_the_gap() {
        let t0 = Instant::now();
        let mut s = HoverSync::new();
        assert!(s.on_set_shape(t0));
        assert!(!s.on_set_shape(t0 + REEMIT_GAP));
        assert!(s.on_set_shape(t0 + REEMIT_GAP + Duration::from_millis(1)));
        // A transition emitted by the polling thread postpones the periodic re-emit.
        s.note_emit(t0 + Duration::from_secs(5));
        assert!(!s.on_set_shape(t0 + Duration::from_secs(5) + Duration::from_millis(500)));
    }

    #[test]
    fn clock_going_backwards_does_not_panic() {
        let t0 = Instant::now();
        let mut s = HoverSync::new();
        assert!(s.on_set_mode(t0)); // clears the fresh-page flag
        s.note_emit(t0 + Duration::from_secs(10));
        assert!(!s.on_set_shape(t0));
    }
}
