//! Win32 styles: tool window (no Alt+Tab), no-activate and a stable layered composition surface.
//! While the keyboard focus is active (`focus.rs`) the no-activate bit is deliberately dropped.
//!
//! The windowing layer (tao) rewrites the *whole* extended style from its own flag set whenever
//! one of its flags changes (for example `set_ignore_cursor_events`, which the hover thread calls
//! constantly), and its set contains neither `WS_EX_TOOLWINDOW` nor `WS_EX_NOACTIVATE` (and brings
//! back `WS_EX_APPWINDOW`). Re-applying after each call is racy because those calls are
//! asynchronous, so the window is subclassed and `WM_STYLECHANGING` forces the island styles on
//! every extended-style change, whoever makes it.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, HWND_TOPMOST, SPI_SETWORKAREA, STYLESTRUCT, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos,
    WM_ACTIVATE, WM_DISPLAYCHANGE, WM_SETTINGCHANGE, WM_SHOWWINDOW, WM_STYLECHANGING,
    WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

/// Subclass id (arbitrary, unique per window procedure chain).
const SUBCLASS_ID: usize = 0x15_1A_4D;

/// `WA_INACTIVE` (the low word of `WM_ACTIVATE`'s `wParam`).
const WA_INACTIVE: usize = 0;

/// The island may be activated right now (keyboard focus requested, see `focus.rs`): the subclass
/// stops forcing `WS_EX_NOACTIVATE`. One island window per process, hence a global.
static ALLOW_ACTIVATE: AtomicBool = AtomicBool::new(false);

pub fn allow_activate() -> bool {
    ALLOW_ACTIVATE.load(Ordering::Acquire)
}

/// Returns the previous value.
pub fn set_allow_activate(allow: bool) -> bool {
    ALLOW_ACTIVATE.swap(allow, Ordering::AcqRel)
}

/// Native handle of a Tauri window as a `windows` 0.62 `HWND`.
pub fn hwnd_of(window: &WebviewWindow) -> Result<HWND, String> {
    let h = window.hwnd().map_err(|e| e.to_string())?;
    Ok(HWND(h.0))
}

/// Pure: the extended style the island needs, derived from the current one. `WS_EX_NOACTIVATE` is
/// forced on, except while `allow_activate` (keyboard focus).
/// Keep `WS_EX_LAYERED` even when tao removes click-through: changing the composition surface on
/// pointer entry stalls the first frames after idle. `WS_EX_TRANSPARENT` still follows tao's input.
pub fn island_ex_style(current: u32, allow_activate: bool) -> u32 {
    let style =
        (current | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_LAYERED.0) & !WS_EX_APPWINDOW.0;
    if allow_activate {
        style & !WS_EX_NOACTIVATE.0
    } else {
        style | WS_EX_NOACTIVATE.0
    }
}

/// Make the island styles permanent: apply them now and keep them on every later change.
pub fn install(hwnd: HWND) -> Result<(), String> {
    // SAFETY: called on the thread that owns `hwnd` (the main thread, from `setup`), as
    // `SetWindowSubclass` requires. The subclass procedure is a plain function that outlives the
    // window and holds no data.
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) };
    if !ok.as_bool() {
        return Err("SetWindowSubclass failed".into());
    }
    apply_island_styles(hwnd);
    Ok(())
}

/// Add `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` (and drop `WS_EX_APPWINDOW`). Idempotent.
pub fn apply_island_styles(hwnd: HWND) {
    // SAFETY: `hwnd` is a live top-level window of this process; Get/SetWindowLongPtrW and
    // SetWindowPos only read/modify that window's own style bits.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = island_ex_style(current as u32, allow_activate());
        if wanted != current as u32 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted as isize);
            // Make Windows re-read the frame styles without moving, resizing or activating.
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
    if let Err(e) = ensure_topmost(hwnd) {
        log::warn!("restoring island topmost after style change failed: {e}");
    }
}

/// A style bit alone does not establish the native z-order band. Reassert it without showing,
/// moving, resizing or activating the island (including while a fullscreen app has it hidden).
pub fn ensure_topmost(hwnd: HWND) -> Result<(), String> {
    // SAFETY: only changes the z-order of our own HWND. No pointer is dereferenced; stale HWNDs
    // fail. SWP_NOACTIVATE preserves the external foreground, and there is no SWP_SHOWWINDOW.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 && lparam.0 != 0 {
        // SAFETY: for WM_STYLECHANGING, lParam points to a valid, writable STYLESTRUCT for the
        // duration of the message.
        let styles = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
        styles.styleNew = island_ex_style(styles.styleNew, allow_activate());
    } else if msg == WM_ACTIVATE && wparam.0 & 0xFFFF == WA_INACTIVE {
        super::focus::on_deactivated(hwnd);
        let _ = ensure_topmost(hwnd);
    } else if msg == WM_SHOWWINDOW && wparam.0 != 0 {
        let _ = ensure_topmost(hwnd);
    } else if msg == WM_DISPLAYCHANGE
        || (msg == WM_SETTINGCHANGE && wparam.0 == SPI_SETWORKAREA.0 as usize)
    {
        super::monitor::schedule_reposition();
    }
    // SAFETY: forwards the unmodified message to the next procedure in the subclass chain.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layered_surface_stays_on_while_click_through_alone_changes() {
        use windows::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT;
        let outside = island_ex_style(WS_EX_TRANSPARENT.0, false);
        let inside = island_ex_style(0, false);
        assert_ne!(outside & WS_EX_LAYERED.0, 0);
        assert_ne!(inside & WS_EX_LAYERED.0, 0);
        assert_ne!(outside & WS_EX_TRANSPARENT.0, 0);
        assert_eq!(inside & WS_EX_TRANSPARENT.0, 0);
        assert_ne!(island_ex_style(0, true) & WS_EX_LAYERED.0, 0);
    }

    #[test]
    fn adds_tool_window_and_no_activate_and_keeps_others() {
        let other = 0x0000_0008u32; // WS_EX_TOPMOST
        let s = island_ex_style(other, false);
        assert_ne!(s & WS_EX_TOOLWINDOW.0, 0);
        assert_ne!(s & WS_EX_NOACTIVATE.0, 0);
        assert_ne!(s & other, 0);
    }

    #[test]
    fn removes_app_window_and_is_idempotent() {
        let s = island_ex_style(WS_EX_APPWINDOW.0, false);
        assert_eq!(s & WS_EX_APPWINDOW.0, 0);
        assert_eq!(island_ex_style(s, false), s);
    }

    #[test]
    fn fresh_framework_styles_cannot_drop_the_topmost_bit_during_focus_changes() {
        for active in [true, false] {
            let style = island_ex_style(WS_EX_APPWINDOW.0, active);
            assert_ne!(style & WS_EX_TOPMOST.0, 0);
            assert_eq!(style & WS_EX_APPWINDOW.0, 0);
            assert_eq!(style & WS_EX_NOACTIVATE.0 != 0, !active);
        }
    }

    #[test]
    fn keyboard_focus_drops_no_activate_but_keeps_the_tool_window() {
        let s = island_ex_style(WS_EX_NOACTIVATE.0 | WS_EX_APPWINDOW.0, true);
        assert_eq!(s & WS_EX_NOACTIVATE.0, 0);
        assert_ne!(s & WS_EX_TOOLWINDOW.0, 0);
        assert_eq!(s & WS_EX_APPWINDOW.0, 0);
        assert_eq!(island_ex_style(s, true), s);
        // And back: the bit is forced on again.
        assert_ne!(island_ex_style(s, false) & WS_EX_NOACTIVATE.0, 0);
    }
}
