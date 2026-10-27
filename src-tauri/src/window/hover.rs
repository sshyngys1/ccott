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
use super::types::{HoverPayload, IslandMode, IslandShape};

/// Cursor is close to the window (within `NEAR_MARGIN_PX` physical px): poll at ~60 Hz.
const FAST_INTERVAL: Duration = Duration::from_millis(16);
/// Far away, island expanded: ~30 Hz (the panel may be about to close).
const MEDIUM_INTERVAL: Duration = Duration::from_millis(33);
/// Far away, island collapsed: ~15 Hz, effectively 0% CPU.
const SLOW_INTERVAL: Duration = Duration::from_millis(66);
/// Window hidden: just wait.
const HIDDEN_INTERVAL: Duration = Duration::from_millis(250);
const NEAR_MARGIN_PX: i32 = 120;

/// Duration the cursor must stay at the top edge in the pill's horizontal zone to reveal an
/// auto-hidden pill (contract §14).
pub const TOP_EDGE_DWELL: Duration = Duration::from_millis(400);
/// Entry band at the very top edge of the monitor (window CSS px).
pub const TOP_EDGE_ENTRY_MAX_Y: f64 = 6.0;
/// Hysteresis vertical band while accumulating dwell so minor vertical jitter does not reset it.
pub const TOP_EDGE_STAY_MAX_Y: f64 = 14.0;
/// Hysteresis horizontal margin around the pill while dwelling or keeping the revealed pill shown.
pub const TOP_EDGE_HYSTERESIS_X: f64 = 12.0;
/// Vertical hysteresis margin below the pill once revealed by top-edge dwell.
pub const REVEALED_KEEP_MARGIN_Y: f64 = 12.0;

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

/// Whether `(px, py)` (in window CSS px) is inside the top-edge strip over the pill's horizontal
/// span. Uses a wider hysteresis band when `already_dwelling` is true to prevent bounce/flicker.
pub fn in_top_edge_pill_zone(px: f64, py: f64, already_dwelling: bool) -> bool {
    let pill = IslandShape::DEFAULT_PILL;
    if already_dwelling {
        px >= pill.x - TOP_EDGE_HYSTERESIS_X
            && px <= pill.x + pill.width + TOP_EDGE_HYSTERESIS_X
            && (-4.0..=TOP_EDGE_STAY_MAX_Y).contains(&py)
    } else {
        px >= pill.x && px <= pill.x + pill.width && (-2.0..=TOP_EDGE_ENTRY_MAX_Y).contains(&py)
    }
}

/// Hysteresis keep-alive zone covering both the top-edge strip and the pill (`DEFAULT_PILL`) so
/// the revealed pill stays visible while the cursor moves from `y = 0` into the pill at `y = 8..44`.
pub fn in_revealed_keep_zone(px: f64, py: f64) -> bool {
    let pill = IslandShape::DEFAULT_PILL;
    px >= pill.x - TOP_EDGE_HYSTERESIS_X
        && px <= pill.x + pill.width + TOP_EDGE_HYSTERESIS_X
        && py >= -4.0
        && py <= pill.y + pill.height + REVEALED_KEEP_MARGIN_Y
}

/// Pure state machine for revealing an auto-hidden pill by holding the cursor at the top edge for
/// [`TOP_EDGE_DWELL`] (~400 ms) with hysteresis against cursor jitter.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TopEdgeDwell {
    entered_at: Option<Instant>,
    revealed: bool,
}

impl TopEdgeDwell {
    pub const fn new() -> Self {
        Self {
            entered_at: None,
            revealed: false,
        }
    }

    #[cfg(test)]
    pub fn is_revealed(&self) -> bool {
        self.revealed
    }

    pub fn is_dwelling(&self) -> bool {
        self.entered_at.is_some()
    }

    pub fn reset(&mut self) {
        self.entered_at = None;
        self.revealed = false;
    }

    /// Advances the dwell state for cursor `(px, py)` (window CSS px) at `now`.
    /// Returns whether the pill should be revealed right now.
    pub fn update(
        &mut self,
        px: f64,
        py: f64,
        now: Instant,
        mode: IslandMode,
        inside: bool,
    ) -> bool {
        if self.revealed {
            if mode == IslandMode::Expanded || inside || in_revealed_keep_zone(px, py) {
                return true;
            }
            self.reset();
            return false;
        }
        let already_dwelling = self.entered_at.is_some();
        if in_top_edge_pill_zone(px, py, already_dwelling) {
            let start = *self.entered_at.get_or_insert(now);
            if now.saturating_duration_since(start) >= TOP_EDGE_DWELL {
                self.revealed = true;
                self.entered_at = None;
            }
        } else {
            self.entered_at = None;
        }
        self.revealed
    }
}

/// Resets top-edge dwell when the island collapses or when auto-hide condition ends.
pub fn on_collapsed(state: &IslandState) {
    state.dwell_revealed.store(false, Ordering::Release);
    state
        .dwell
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .reset();
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
        let autohide_active = state.autohide_active.load(Ordering::Acquire);
        let mut near = false;
        let mut dwelling = false;

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
            if autohide_active
                && let (Some(cursor), Some(rect)) =
                    (native::cursor_pos(), native::window_rect(hwnd))
            {
                near = is_near(cursor, rect, NEAR_MARGIN_PX);
                let scale = native::window_scale(hwnd);
                let (px, py) = screen_to_window_css(cursor, (rect.0, rect.1), scale);
                let (revealed, is_dwelling) = {
                    let mut dwell = state.dwell.lock().unwrap_or_else(|e| e.into_inner());
                    let r = dwell.update(px, py, Instant::now(), mode, false);
                    (r, dwell.is_dwelling())
                };
                dwelling = is_dwelling;
                if state.dwell_revealed.swap(revealed, Ordering::AcqRel) != revealed {
                    super::fullscreen::recheck(app);
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
            if autohide_active || state.dwell_revealed.load(Ordering::Acquire) {
                let (revealed, is_dwelling) = {
                    let mut dwell = state.dwell.lock().unwrap_or_else(|e| e.into_inner());
                    let r = dwell.update(px, py, Instant::now(), mode, inside);
                    (r, dwell.is_dwelling())
                };
                dwelling = is_dwelling;
                if state.dwell_revealed.swap(revealed, Ordering::AcqRel) != revealed {
                    super::fullscreen::recheck(app);
                }
            }
        }

        // `stop()` unparks the thread, so shutdown does not wait for the sleep to run out.
        let sleep_dur = if !visible && autohide_active {
            if near || dwelling {
                FAST_INTERVAL
            } else {
                SLOW_INTERVAL
            }
        } else {
            poll_interval(visible, near, mode)
        };
        std::thread::park_timeout(sleep_dur);
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

    #[test]
    fn top_edge_dwell_requires_400ms_in_pill_horizontal_zone_and_uses_hysteresis() {
        let t0 = Instant::now();
        let mut dwell = TopEdgeDwell::new();

        // Outside the horizontal pill zone (288..=512): never starts dwelling.
        assert!(!dwell.update(100.0, 0.0, t0, IslandMode::Collapsed, false));
        assert!(!dwell.is_dwelling());
        assert!(!dwell.update(600.0, 0.0, t0, IslandMode::Collapsed, false));
        assert!(!dwell.is_dwelling());

        // Below the top-edge entry strip (y > 6): does not start dwelling.
        assert!(!dwell.update(400.0, 12.0, t0, IslandMode::Collapsed, false));
        assert!(!dwell.is_dwelling());

        // Enter top edge in the pill horizontal zone: starts dwelling, not revealed before 400 ms.
        assert!(!dwell.update(400.0, 1.0, t0, IslandMode::Collapsed, false));
        assert!(dwell.is_dwelling());
        assert!(!dwell.is_revealed());

        // Slight jitter within hysteresis band (e.g. y = 11.0, x = 280.0) does NOT reset the timer.
        assert!(!dwell.update(
            280.0,
            11.0,
            t0 + Duration::from_millis(200),
            IslandMode::Collapsed,
            false
        ));
        assert!(dwell.is_dwelling());
        assert!(!dwell.is_revealed());

        // Still under 400 ms at 399 ms.
        assert!(!dwell.update(
            400.0,
            1.0,
            t0 + Duration::from_millis(399),
            IslandMode::Collapsed,
            false
        ));
        assert!(!dwell.is_revealed());

        // At 400 ms: pill is revealed!
        assert!(dwell.update(
            400.0,
            1.0,
            t0 + Duration::from_millis(400),
            IslandMode::Collapsed,
            false
        ));
        assert!(dwell.is_revealed());
        assert!(!dwell.is_dwelling());

        // Moving from the top edge (y=1) down into the pill (y=26) or slightly below (y=50) keeps
        // it revealed without any bounce/flicker.
        assert!(dwell.update(
            400.0,
            26.0,
            t0 + Duration::from_millis(450),
            IslandMode::Collapsed,
            true
        ));
        assert!(dwell.update(
            400.0,
            50.0,
            t0 + Duration::from_millis(500),
            IslandMode::Collapsed,
            false
        ));

        // While the island is Expanded, moving the cursor far away keeps it revealed until collapse.
        assert!(dwell.update(
            100.0,
            300.0,
            t0 + Duration::from_millis(600),
            IslandMode::Expanded,
            false
        ));

        // Once collapsed and cursor is outside the keep-alive zone, it hides again.
        assert!(!dwell.update(
            100.0,
            300.0,
            t0 + Duration::from_millis(700),
            IslandMode::Collapsed,
            false
        ));
        assert!(!dwell.is_revealed());
    }
}
