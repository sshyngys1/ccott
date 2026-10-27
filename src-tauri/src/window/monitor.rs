//! Monitor enumeration and island window positioning (top-center of a monitor's work area).

use std::sync::atomic::Ordering;

use tauri::{Monitor, WebviewWindow};

use super::IslandState;
use super::types::{ISLAND_WINDOW_HEIGHT, ISLAND_WINDOW_WIDTH, MonitorInfo};

/// `outer_position` / `outer_size` may differ from the wanted values by this many physical px
/// (DPI rounding of the window frame) before the window is moved or resized again. Without it
/// `Resized` -> `reposition` -> `set_size` -> `Resized` could chase a 1 px rounding difference.
pub const PLACEMENT_TOLERANCE_PX: i32 = 1;

/// Physical geometry of a monitor (virtual-desktop coordinates).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Top of the work area (below a top taskbar); equals `y` when nothing is docked at the top.
    pub work_y: i32,
    pub scale: f64,
}

/// Target placement of the island window in physical px.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowPlacement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Window of `logical` CSS px centered horizontally on the monitor, at the top of its work area
/// (so a taskbar docked at the top keeps its place and the island sits right below it), DPI-aware.
pub fn top_center_placement(m: &MonitorGeometry, logical: (f64, f64)) -> WindowPlacement {
    let scale = if m.scale > 0.0 { m.scale } else { 1.0 };
    let width = (logical.0 * scale).round() as i32;
    let height = (logical.1 * scale).round() as i32;
    WindowPlacement {
        x: m.x + (m.width as i32 - width) / 2,
        y: m.work_y.max(m.y),
        width: width.max(1) as u32,
        height: height.max(1) as u32,
    }
}

/// What `reposition` has to change: `(resize, move)` (pure).
pub fn placement_changes(
    pos: (i32, i32),
    size: (u32, u32),
    want: &WindowPlacement,
    tolerance: i32,
) -> (bool, bool) {
    let far = |a: i64, b: i64| (a - b).abs() > i64::from(tolerance);
    let resize = far(i64::from(size.0), i64::from(want.width))
        || far(i64::from(size.1), i64::from(want.height));
    let moved =
        far(i64::from(pos.0), i64::from(want.x)) || far(i64::from(pos.1), i64::from(want.y));
    (resize, moved)
}

/// Stable monitor id: the device name plus the position on the virtual desktop, for example
/// `\\.\DISPLAY1@0,0`. Two monitors with the same name (or no name) still get different ids.
pub fn monitor_id(name: &str, x: i32, y: i32) -> String {
    format!("{name}@{x},{y}")
}

pub fn geometry_of(m: &Monitor) -> MonitorGeometry {
    MonitorGeometry {
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
        work_y: m.work_area().position.y,
        scale: m.scale_factor(),
    }
}

/// A connected monitor as far as the choice of the target is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorRef {
    pub id: String,
    pub is_primary: bool,
}

/// Device-name part of a monitor id (`DISPLAY1@0,0` -> `DISPLAY1`).
fn id_name(id: &str) -> &str {
    id.rsplit_once('@').map_or(id, |(name, _)| name)
}

/// Index of the monitor the island belongs on for the preference `wanted` (`"primary"` or a
/// monitor id). Order of tries: exact id; the only monitor with the same device name (the id
/// also holds the position, which changes when the user rearranges the displays); the primary
/// monitor; the first one. `None` only when there are no monitors.
pub fn pick_monitor(monitors: &[MonitorRef], wanted: &str) -> Option<usize> {
    if wanted != "primary" {
        if let Some(i) = monitors.iter().position(|m| m.id == wanted) {
            return Some(i);
        }
        let name = id_name(wanted);
        let mut same_name = monitors
            .iter()
            .enumerate()
            .filter(|(_, m)| id_name(&m.id) == name);
        if let (Some((i, _)), None) = (same_name.next(), same_name.next()) {
            return Some(i);
        }
    }
    monitors
        .iter()
        .position(|m| m.is_primary)
        .or(if monitors.is_empty() { None } else { Some(0) })
}

/// Target monitor for the island: the one chosen in the settings (`state.monitor_pref`), the
/// primary monitor when it is gone (fallbacks: current, first available).
pub fn target_monitor(window: &WebviewWindow, state: &IslandState) -> Option<Monitor> {
    let wanted = state
        .monitor_pref
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let entries = entries(window).unwrap_or_default();
    let refs: Vec<MonitorRef> = entries
        .iter()
        .map(|(info, _)| MonitorRef {
            id: info.id.clone(),
            is_primary: info.is_primary,
        })
        .collect();
    if let Some(i) = pick_monitor(&refs, &wanted) {
        return entries.into_iter().nth(i).map(|(_, m)| m);
    }
    window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
}

/// Place the island at the top-center of the target monitor. Idempotent: does nothing when the
/// window already sits there (within [`PLACEMENT_TOLERANCE_PX`]) and ignores re-entrant calls, so
/// it is safe to call from `Resized`/`ScaleFactorChanged` handlers.
/// Returns `true` when the position or size was changed.
pub fn reposition(window: &WebviewWindow, state: &IslandState) -> Result<bool, String> {
    if state.repositioning.swap(true, Ordering::AcqRel) {
        return Ok(false); // our own set_size/set_position is delivering a Resized event
    }
    let result = reposition_inner(window, state);
    state.repositioning.store(false, Ordering::Release);
    result
}

fn reposition_inner(window: &WebviewWindow, state: &IslandState) -> Result<bool, String> {
    let monitor = target_monitor(window, state).ok_or_else(|| "no monitor found".to_string())?;
    let want = top_center_placement(
        &geometry_of(&monitor),
        (ISLAND_WINDOW_WIDTH, ISLAND_WINDOW_HEIGHT),
    );

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (resize, moved) = placement_changes(
        (pos.x, pos.y),
        (size.width, size.height),
        &want,
        PLACEMENT_TOLERANCE_PX,
    );
    if resize {
        window
            .set_size(tauri::PhysicalSize::new(want.width, want.height))
            .map_err(|e| e.to_string())?;
    }
    if moved {
        window
            .set_position(tauri::PhysicalPosition::new(want.x, want.y))
            .map_err(|e| e.to_string())?;
    }
    Ok(resize || moved)
}

/// All connected monitors with their native handles.
fn entries(window: &WebviewWindow) -> Result<Vec<(MonitorInfo, Monitor)>, String> {
    let primary = window.primary_monitor().map_err(|e| e.to_string())?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let name = m
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Monitor {}", i + 1));
            let is_primary = primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size());
            let info = MonitorInfo {
                id: monitor_id(&name, m.position().x, m.position().y),
                name,
                width: m.size().width,
                height: m.size().height,
                scale_factor: m.scale_factor(),
                is_primary,
            };
            (info, m)
        })
        .collect())
}

/// Contract command helper: all connected monitors.
pub fn list(window: &WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    Ok(entries(window)?.into_iter().map(|(info, _)| info).collect())
}

/// Display configuration changed (`WM_DISPLAYCHANGE`, work area): move the island again after the
/// system has settled. Coalesces bursts of messages; runs on its own thread because the caller
/// is the window procedure.
pub fn schedule_reposition() {
    static PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("island-display-change".into())
        .spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(400));
            PENDING.store(false, Ordering::Release);
            let Some(app) = super::APP.get() else { return };
            let Some(window) = tauri::Manager::get_webview_window(app, "island") else {
                return;
            };
            let state = tauri::Manager::state::<IslandState>(app);
            match reposition(&window, &state) {
                Ok(true) => log::debug!("island repositioned after a display change"),
                Ok(false) => {}
                Err(e) => log::warn!("repositioning after a display change failed: {e}"),
            }
            super::fullscreen::recheck(app);
        });
    if let Err(e) = spawned {
        log::warn!("cannot start the display-change thread: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, w: u32, h: u32, scale: f64) -> MonitorGeometry {
        MonitorGeometry {
            x,
            y,
            width: w,
            height: h,
            work_y: y,
            scale,
        }
    }
    const WIN: (f64, f64) = (800.0, 520.0);

    #[test]
    fn centers_on_primary_at_100_percent() {
        let p = top_center_placement(&mon(0, 0, 1920, 1080, 1.0), WIN);
        assert_eq!(
            p,
            WindowPlacement {
                x: 560,
                y: 0,
                width: 800,
                height: 520
            }
        );
    }

    #[test]
    fn scales_window_size_with_dpi() {
        let p = top_center_placement(&mon(0, 0, 2880, 1800, 1.5), WIN);
        assert_eq!(
            p,
            WindowPlacement {
                x: 840,
                y: 0,
                width: 1200,
                height: 780
            }
        );
        let p = top_center_placement(&mon(0, 0, 3840, 2160, 2.0), WIN);
        assert_eq!((p.x, p.width, p.height), (1120, 1600, 1040));
    }

    #[test]
    fn honors_monitor_origin_including_negative() {
        // Secondary monitor to the left of and above the primary.
        let p = top_center_placement(&mon(-1920, -200, 1920, 1080, 1.0), WIN);
        assert_eq!((p.x, p.y), (-1920 + 560, -200));
        // Fractional scale rounds the window size.
        let p = top_center_placement(&mon(0, 0, 2560, 1440, 1.25), WIN);
        assert_eq!((p.width, p.height, p.x), (1000, 650, 780));
    }

    #[test]
    fn narrow_monitor_and_bad_scale_do_not_panic() {
        let p = top_center_placement(&mon(0, 0, 600, 400, 1.0), WIN);
        assert_eq!(p.x, -100); // overhangs symmetrically
        let p = top_center_placement(&mon(0, 0, 1920, 1080, 0.0), WIN);
        assert_eq!(p.width, 800);
    }

    #[test]
    fn work_area_top_is_used_for_a_top_taskbar() {
        // Taskbar docked at the top, 48 px high: the island goes right below it.
        let m = MonitorGeometry {
            work_y: 48,
            ..mon(0, 0, 1920, 1080, 1.0)
        };
        let p = top_center_placement(&m, WIN);
        assert_eq!((p.x, p.y), (560, 48));
        // Same on a secondary monitor with an origin.
        let m = MonitorGeometry {
            work_y: -200 + 40,
            ..mon(-1920, -200, 1920, 1080, 1.0)
        };
        assert_eq!(top_center_placement(&m, WIN).y, -160);
    }

    #[test]
    fn bottom_taskbar_keeps_y_at_the_monitor_top() {
        // The work area of a bottom taskbar starts at the monitor's top edge.
        let p = top_center_placement(&mon(0, 0, 1920, 1080, 1.0), WIN);
        assert_eq!(p.y, 0);
        // A nonsensical work area above the monitor is ignored.
        let m = MonitorGeometry {
            work_y: -50,
            ..mon(0, 0, 1920, 1080, 1.0)
        };
        assert_eq!(top_center_placement(&m, WIN).y, 0);
    }

    #[test]
    fn monitor_ids_are_unique_for_identical_names() {
        let a = monitor_id(r"\\.\DISPLAY1", 0, 0);
        assert_eq!(a, r"\\.\DISPLAY1@0,0");
        let b = monitor_id(r"\\.\DISPLAY1", 2560, 0);
        let c = monitor_id(r"\\.\DISPLAY1", -1920, -200);
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_eq!(a, monitor_id(r"\\.\DISPLAY1", 0, 0)); // stable
        assert_eq!(c, r"\\.\DISPLAY1@-1920,-200");
    }

    #[test]
    fn placement_tolerates_one_pixel_only() {
        let want = WindowPlacement {
            x: 840,
            y: 0,
            width: 1200,
            height: 780,
        };
        let check = |pos, size, tol| placement_changes(pos, size, &want, tol);
        // Exact and ±1 px: nothing to do (this is what breaks a Resized -> reposition loop).
        assert_eq!(check((840, 0), (1200, 780), 1), (false, false));
        assert_eq!(check((841, -1), (1199, 781), 1), (false, false));
        // 2 px off in size: resize only; in position: move only; both.
        assert_eq!(check((840, 0), (1202, 780), 1), (true, false));
        assert_eq!(check((838, 0), (1200, 780), 1), (false, true));
        assert_eq!(check((840, 2), (1200, 778), 1), (true, true));
        // Zero tolerance is strict.
        assert_eq!(check((841, 0), (1200, 780), 0), (false, true));
    }

    #[test]
    fn rounding_noise_does_not_retrigger_after_a_correction() {
        // The window reports a size 1 px off after `set_size` (frame rounding): the next
        // `Resized` handler pass finds nothing to do.
        let want = top_center_placement(&mon(0, 0, 2560, 1600, 1.5), WIN);
        let reported = (want.width + 1, want.height - 1);
        assert_eq!(
            placement_changes((want.x, want.y), reported, &want, PLACEMENT_TOLERANCE_PX),
            (false, false)
        );
    }

    fn refs(list: &[(&str, bool)]) -> Vec<MonitorRef> {
        list.iter()
            .map(|(id, p)| MonitorRef {
                id: (*id).to_string(),
                is_primary: *p,
            })
            .collect()
    }

    #[test]
    fn primary_preference_picks_the_primary() {
        let m = refs(&[("A@-1920,0", false), ("B@0,0", true)]);
        assert_eq!(pick_monitor(&m, "primary"), Some(1));
    }

    #[test]
    fn exact_id_wins_even_over_primary() {
        let m = refs(&[("A@-1920,0", false), ("B@0,0", true)]);
        assert_eq!(pick_monitor(&m, "A@-1920,0"), Some(0));
    }

    #[test]
    fn unknown_id_falls_back_to_primary() {
        let m = refs(&[("A@-1920,0", false), ("B@0,0", true)]);
        assert_eq!(pick_monitor(&m, "Z@5,5"), Some(1));
    }

    #[test]
    fn moved_monitor_is_found_by_its_unique_name() {
        let m = refs(&[("A@0,0", true), ("B@2560,0", false)]);
        // The user rearranged the displays: B used to be at 1920,0.
        assert_eq!(pick_monitor(&m, "B@1920,0"), Some(1));
    }

    #[test]
    fn ambiguous_name_does_not_guess() {
        let m = refs(&[("X@0,0", true), ("X@1920,0", false)]);
        assert_eq!(pick_monitor(&m, "X@3840,0"), Some(0)); // primary
    }

    #[test]
    fn no_primary_flag_uses_the_first_and_no_monitors_gives_none() {
        let m = refs(&[("A@0,0", false), ("B@1,0", false)]);
        assert_eq!(pick_monitor(&m, "primary"), Some(0));
        assert_eq!(pick_monitor(&[], "primary"), None);
        assert_eq!(pick_monitor(&[], "A@0,0"), None);
    }
}
