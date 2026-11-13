//! A native, frozen-desktop selection surface. No WebView startup or IPC during dragging.
use crate::capture::{
    desktop::{Snapshot, bitmap_info},
    model::{Rect, magnifier_origin},
};
use std::time::Instant;
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::*,
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, SetFocus},
            WindowsAndMessaging::*,
        },
    },
    core::w,
};

struct Selection<'a> {
    picker: bool,
    snapshot: &'a Snapshot,
    shade: BlackSurface,
    anchor: Option<(i32, i32)>,
    cursor: (i32, i32),
    result: Option<Rect>,
    hint: Vec<u16>,
}

fn picked_rect(state: &Selection<'_>) -> Option<Rect> {
    state
        .snapshot
        .bounds
        .contains(state.cursor)
        .then_some(Rect {
            left: state.cursor.0,
            top: state.cursor.1,
            right: state.cursor.0 + 1,
            bottom: state.cursor.1 + 1,
        })
}

unsafe fn paint_magnifier(dc: HDC, state: &Selection<'_>, monitor: Rect) {
    const COUNT: i32 = 11;
    const ZOOM: i32 = 10;
    let bounds = state.snapshot.bounds;
    let (x, y) = magnifier_origin(state.cursor, monitor, (132, 156));
    let (left, top) = (x - bounds.left, y - bounds.top);
    let panel = RECT {
        left,
        top,
        right: left + 132,
        bottom: top + 156,
    };
    let mut pixels = Vec::with_capacity((COUNT * COUNT * 4) as usize);
    for row in -5..=5 {
        for col in -5..=5 {
            let point = (
                (state.cursor.0 + col).clamp(bounds.left, bounds.right - 1),
                (state.cursor.1 + row).clamp(bounds.top, bounds.bottom - 1),
            );
            let color = state
                .snapshot
                .color_at(point)
                .expect("clamped desktop pixel");
            pixels.extend_from_slice(&[color.b, color.g, color.r, 255]);
        }
    }
    // SAFETY: DC belongs to the current paint; bitmap data and rectangles remain live throughout GDI calls.
    unsafe {
        FillRect(dc, &panel, HBRUSH(GetStockObject(BLACK_BRUSH).0));
        FrameRect(dc, &panel, HBRUSH(GetStockObject(WHITE_BRUSH).0));
        SetStretchBltMode(dc, COLORONCOLOR);
        StretchDIBits(
            dc,
            left + 10,
            top + 10,
            COUNT * ZOOM,
            COUNT * ZOOM,
            0,
            0,
            COUNT,
            COUNT,
            Some(pixels.as_ptr().cast()),
            &bitmap_info(COUNT, COUNT),
            DIB_RGB_COLORS,
            SRCCOPY,
        );
        let old = SelectObject(dc, GetStockObject(DC_PEN));
        SetDCPenColor(dc, windows::Win32::Foundation::COLORREF(0x808080));
        for i in 0..=COUNT {
            let _ = MoveToEx(dc, left + 10 + i * ZOOM, top + 10, None);
            let _ = LineTo(dc, left + 10 + i * ZOOM, top + 10 + COUNT * ZOOM);
            let _ = MoveToEx(dc, left + 10, top + 10 + i * ZOOM, None);
            let _ = LineTo(dc, left + 10 + COUNT * ZOOM, top + 10 + i * ZOOM);
        }
        SelectObject(dc, old);
        let center = RECT {
            left: left + 60,
            top: top + 60,
            right: left + 70,
            bottom: top + 70,
        };
        FrameRect(dc, &center, HBRUSH(GetStockObject(WHITE_BRUSH).0));
        if let Some(color) = state.snapshot.color_at(state.cursor) {
            SetTextColor(dc, windows::Win32::Foundation::COLORREF(0xffffff));
            SetBkMode(dc, TRANSPARENT);
            let _ = TextOutW(
                dc,
                left + 10,
                top + 130,
                &color.hex.encode_utf16().collect::<Vec<_>>(),
            );
        }
    }
}

/// Constant-alpha GDI compositing avoids walking every desktop byte before showing the overlay.
struct BlackSurface {
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
}
impl BlackSurface {
    fn new() -> Result<Self, String> {
        // SAFETY: the 1×1 DIB and compatible DC are owned here and released by Drop.
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return Err("overlay DC unavailable".into());
            }
            let mut bits = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(
                Some(dc),
                &bitmap_info(1, 1),
                DIB_RGB_COLORS,
                &mut bits,
                None,
                0,
            ) {
                Ok(bitmap) => bitmap,
                Err(error) => {
                    let _ = DeleteDC(dc);
                    return Err(error.to_string());
                }
            };
            *(bits as *mut u32) = 0;
            let old = SelectObject(dc, bitmap.into());
            Ok(Self { dc, bitmap, old })
        }
    }
}
impl Drop for BlackSurface {
    fn drop(&mut self) {
        // SAFETY: restore the old bitmap before destroying our owned GDI resources.
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

unsafe extern "system" fn procedure(hwnd: HWND, message: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    // SAFETY: this class owns the window; userdata points to Selection for the entire message loop.
    unsafe {
        if message == WM_NCCREATE {
            SetWindowLongPtrW(
                hwnd,
                GWLP_USERDATA,
                (*(lp.0 as *const CREATESTRUCTW)).lpCreateParams as isize,
            );
        }
        if message == WM_DESTROY {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Selection<'_>;
        if pointer.is_null() {
            return DefWindowProcW(hwnd, message, wp, lp);
        }
        let state = &mut *pointer;
        match message {
            WM_WINDOWPOSCHANGING => {
                let position = &mut *(lp.0 as *mut WINDOWPOS);
                let bounds = state.snapshot.bounds;
                position.x = bounds.left;
                position.y = bounds.top;
                position.cx = bounds.width();
                position.cy = bounds.height();
                position.flags &= !(SWP_NOMOVE | SWP_NOSIZE);
                return LRESULT(0);
            }
            WM_ERASEBKGND => return LRESULT(1),
            WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP => {
                // Use the queued event's coordinates: GetCursorPos may already be at the end
                // of a fast drag when WM_LBUTTONDOWN is handled, collapsing the selection to zero.
                let bounds = state.snapshot.bounds;
                state.cursor = (
                    bounds.left + (lp.0 as u16 as i16) as i32,
                    bounds.top + ((lp.0 >> 16) as u16 as i16) as i32,
                );
                if message == WM_LBUTTONDOWN {
                    state.anchor = Some(state.cursor);
                    SetCapture(hwnd);
                }
                if message == WM_LBUTTONUP
                    && let Some(anchor) = state.anchor
                {
                    state.result = if state.picker {
                        picked_rect(state)
                    } else {
                        Rect::selection(anchor, state.cursor, state.snapshot.bounds)
                    };
                    let _ = ReleaseCapture();
                    let _ = DestroyWindow(hwnd);
                    return LRESULT(0);
                }
                let _ = InvalidateRect(Some(hwnd), None, false);
                return LRESULT(0);
            }
            WM_KEYDOWN if wp.0 == 27 => {
                let _ = DestroyWindow(hwnd);
                return LRESULT(0);
            }
            WM_KEYDOWN if state.picker && wp.0 == 13 => {
                state.result = picked_rect(state);
                let _ = DestroyWindow(hwnd);
                return LRESULT(0);
            }
            WM_KEYDOWN if state.picker && (37..=40).contains(&wp.0) => {
                let (dx, dy) = match wp.0 {
                    37 => (-1, 0),
                    38 => (0, -1),
                    39 => (1, 0),
                    _ => (0, 1),
                };
                let bounds = state.snapshot.bounds;
                state.cursor = (
                    (state.cursor.0 + dx).clamp(bounds.left, bounds.right - 1),
                    (state.cursor.1 + dy).clamp(bounds.top, bounds.bottom - 1),
                );
                let _ = SetCursorPos(state.cursor.0, state.cursor.1);
                let mut point = POINT::default();
                if GetCursorPos(&mut point).is_ok() {
                    state.cursor = (point.x, point.y);
                }
                let _ = InvalidateRect(Some(hwnd), None, false);
                return LRESULT(0);
            }
            WM_RBUTTONDOWN => return LRESULT(0),
            WM_RBUTTONUP | WM_DISPLAYCHANGE | WM_CLOSE => {
                let _ = DestroyWindow(hwnd);
                return LRESULT(0);
            }
            WM_PAINT => {
                let mut paint = PAINTSTRUCT::default();
                let dc = BeginPaint(hwnd, &mut paint);
                let b = state.snapshot.bounds;
                let info = bitmap_info(b.width(), b.height());
                StretchDIBits(
                    dc,
                    0,
                    0,
                    b.width(),
                    b.height(),
                    0,
                    0,
                    b.width(),
                    b.height(),
                    Some(state.snapshot.pixels.as_ptr().cast()),
                    &info,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if !state.picker {
                    let _ = AlphaBlend(
                        dc,
                        0,
                        0,
                        b.width(),
                        b.height(),
                        state.shade.dc,
                        0,
                        0,
                        1,
                        1,
                        BLENDFUNCTION {
                            BlendOp: AC_SRC_OVER as u8,
                            BlendFlags: 0,
                            SourceConstantAlpha: 128,
                            AlphaFormat: 0,
                        },
                    );
                }
                if let Some(r) = state
                    .anchor
                    .and_then(|a| Rect::selection(a, state.cursor, b))
                {
                    let clip = RECT {
                        left: r.left - b.left,
                        top: r.top - b.top,
                        right: r.right - b.left,
                        bottom: r.bottom - b.top,
                    };
                    SaveDC(dc);
                    IntersectClipRect(dc, clip.left, clip.top, clip.right, clip.bottom);
                    StretchDIBits(
                        dc,
                        0,
                        0,
                        b.width(),
                        b.height(),
                        0,
                        0,
                        b.width(),
                        b.height(),
                        Some(state.snapshot.pixels.as_ptr().cast()),
                        &info,
                        DIB_RGB_COLORS,
                        SRCCOPY,
                    );
                    let _ = RestoreDC(dc, -1);
                    FrameRect(dc, &clip, HBRUSH(GetStockObject(WHITE_BRUSH).0));
                    let text: Vec<u16> = format!("{} × {}", r.width(), r.height())
                        .encode_utf16()
                        .collect();
                    SetTextColor(dc, windows::Win32::Foundation::COLORREF(0xffffff));
                    SetBkMode(dc, TRANSPARENT);
                    let _ = TextOutW(dc, clip.left + 8, (clip.top - 24).max(8), &text);
                }
                SetTextColor(dc, windows::Win32::Foundation::COLORREF(0xffffff));
                SetBkMode(dc, TRANSPARENT);
                // Anchor the hint to the current cursor monitor rather than a possibly off-screen virtual origin.
                let monitor = MonitorFromPoint(
                    POINT {
                        x: state.cursor.0,
                        y: state.cursor.1,
                    },
                    MONITOR_DEFAULTTONEAREST,
                );
                let mut mi = MONITORINFO {
                    cbSize: size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                if GetMonitorInfoW(monitor, &mut mi).as_bool() {
                    let _ = TextOutW(
                        dc,
                        mi.rcMonitor.left - b.left + 24,
                        mi.rcMonitor.top - b.top + 24,
                        &state.hint,
                    );
                }
                if state.picker {
                    let r = mi.rcMonitor;
                    let monitor = if r.right > r.left {
                        Rect {
                            left: r.left,
                            top: r.top,
                            right: r.right,
                            bottom: r.bottom,
                        }
                    } else {
                        b
                    };
                    paint_magnifier(dc, state, monitor);
                }
                let _ = EndPaint(hwnd, &paint);
                return LRESULT(0);
            }
            _ => {}
        }
        DefWindowProcW(hwnd, message, wp, lp)
    }
}

pub fn select(snapshot: &Snapshot, hint: &str, started: Instant) -> Result<Option<Rect>, String> {
    run_overlay(snapshot, hint, started, false)
}
pub fn pick_color(
    snapshot: &Snapshot,
    hint: &str,
    started: Instant,
) -> Result<Option<(i32, i32)>, String> {
    run_overlay(snapshot, hint, started, true)
        .map(|result| result.map(|rect| (rect.left, rect.top)))
}
fn run_overlay(
    snapshot: &Snapshot,
    hint: &str,
    started: Instant,
    picker: bool,
) -> Result<Option<Rect>, String> {
    let mut state = Selection {
        picker,
        snapshot,
        shade: BlackSurface::new()?,
        anchor: None,
        cursor: (snapshot.bounds.left, snapshot.bounds.top),
        result: None,
        hint: hint.encode_utf16().collect(),
    };
    // SAFETY: the window and its message loop live on this thread; state outlives all callbacks.
    unsafe {
        let mut cursor = POINT::default();
        if GetCursorPos(&mut cursor).is_ok() {
            state.cursor = (cursor.x, cursor.y);
        }
        let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let class = w!("CCOTT-Capture-Selection");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            hCursor: LoadCursorW(None, IDC_CROSS).map_err(|e| e.to_string())?,
            lpszClassName: class,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let b = snapshot.bounds;
        let hwnd = CreateWindowExW(
            // A selectable task window remains discoverable by accessibility tools and Alt+Tab.
            WS_EX_TOPMOST | WS_EX_APPWINDOW,
            class,
            w!("CCOTT Capture"),
            WS_POPUP,
            b.left,
            b.top,
            b.width(),
            b.height(),
            None,
            None,
            Some(instance.into()),
            Some(&mut state as *mut _ as *const _),
        )
        .map_err(|e| e.to_string())?;
        // Paint before activation: shell/foreground hooks must not delay the first visible frame.
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = UpdateWindow(hwnd);
        log::debug!(
            "capture overlay painted in {} ms",
            started.elapsed().as_millis()
        );
        let _ = SetForegroundWindow(hwnd);
        let _ = SetFocus(Some(hwnd));
        let mut msg = MSG::default();
        loop {
            let code = GetMessageW(&mut msg, None, 0, 0).0;
            if code <= 0 {
                if code < 0 {
                    let _ = DestroyWindow(hwnd);
                    return Err("capture message loop failed".into());
                }
                break;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Ok(state.result)
    }
}
