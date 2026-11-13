//! Thin Win32 helpers used by the hover thread and region code. Physical px everywhere.

use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect, IsWindowVisible};

/// Cursor position in screen px (per-monitor DPI aware process).
pub fn cursor_pos() -> Option<(i32, i32)> {
    let mut p = POINT::default();
    // SAFETY: `p` is a valid, writable POINT for the duration of the call.
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x, p.y))
}

/// Window rectangle in screen px: `(left, top, right, bottom)`.
pub fn window_rect(hwnd: HWND) -> Option<(i32, i32, i32, i32)> {
    let mut r = RECT::default();
    // SAFETY: `r` is a valid, writable RECT; an invalid `hwnd` just makes the call fail.
    unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    Some((r.left, r.top, r.right, r.bottom))
}

/// Scale factor of the monitor the window is on (1.0 = 96 dpi).
pub fn window_scale(hwnd: HWND) -> f64 {
    // SAFETY: plain query; returns 0 for an invalid window.
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 }
}

pub fn is_visible(hwnd: HWND) -> bool {
    // SAFETY: plain query.
    unsafe { IsWindowVisible(hwnd).as_bool() }
}
