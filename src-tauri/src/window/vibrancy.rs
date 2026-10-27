//! Native backdrop (Acrylic / Mica) and the `SetWindowRgn` clip around the island shape.
//!
//! # Spike result (Windows 11 build 26300, measured; screenshots in `docs/spike/`)
//! A backdrop in a transparent window fills the *whole* 800x520 window rectangle. The planned fix,
//! clipping the window with `SetWindowRgn`, clips the WebView content but **not the blur**: DWM
//! ignores the window region for both the system backdrop (`DWMWA_SYSTEMBACKDROP_TYPE`) and the
//! accent-policy acrylic (`SetWindowCompositionAttribute`); `DwmEnableBlurBehindWindow` with an
//! explicit blur region does nothing on Windows 11; a layered per-pixel-alpha window does not clip
//! it either. Without a way to shape the blur the native backdrop would paint a visible 800x520
//! rectangle, so it is disabled by default ([`NATIVE_BLUR_ENABLED`]): `window_set_vibrancy`
//! answers `applied: "none"` with an explanatory error and the frontend uses its CSS-glass fallback.
//!
//! The window region is still maintained while a backdrop is active (it clips the WebView to the
//! shape and keeps the experiment reproducible); without a backdrop no region is installed: it
//! would only cut the CSS shadow/glow that spills outside the shape and cost a DWM recomposition on
//! every shape update for nothing.

use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, HGDIOBJ, SetWindowRgn};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::core::{s, w};

use super::IslandState;
use super::native;
use super::shape::{RegionRect, region_rect};
use super::styles::hwnd_of;
use super::types::{IslandShape, VibrancyMode, VibrancyResult};

/// Release switch: native blur cannot be limited to the island shape (see module docs), so it is
/// off. Flip to `true` once a way to clip it exists. Debug builds can force it with
/// `ISLAND_NATIVE_BLUR=1`; `ISLAND_VIBRANCY=...` at startup always forces it.
pub const NATIVE_BLUR_ENABLED: bool = false;

const UNCLIPPABLE_MSG: &str = "native blur is disabled: DWM does not clip it to the island shape (SetWindowRgn is ignored by Acrylic/Mica), use the CSS glass fallback";

/// Dark tint for the accent-policy acrylic. The Windows 11 system-backdrop path ignores it.
const ACRYLIC_TINT: (u8, u8, u8, u8) = (16, 16, 20, 110);

fn native_blur_allowed() -> bool {
    NATIVE_BLUR_ENABLED
        || (cfg!(debug_assertions) && std::env::var("ISLAND_NATIVE_BLUR").is_ok_and(|v| v == "1"))
}

/// `window_set_vibrancy` entry point: honors [`NATIVE_BLUR_ENABLED`].
pub fn apply(window: &WebviewWindow, state: &IslandState, mode: VibrancyMode) -> VibrancyResult {
    if mode != VibrancyMode::None && !native_blur_allowed() {
        return apply_forced(window, state, VibrancyMode::None).with_request(mode, UNCLIPPABLE_MSG);
    }
    apply_forced(window, state, mode)
}

impl VibrancyResult {
    fn with_request(mut self, requested: VibrancyMode, error: &str) -> Self {
        self.requested = requested;
        self.error = Some(error.to_string());
        self
    }
}

/// Apply `mode` regardless of [`NATIVE_BLUR_ENABLED`] (debug experiments). Never panics; on
/// failure returns `applied: none` plus the error text.
pub fn apply_forced(
    window: &WebviewWindow,
    state: &IslandState,
    mode: VibrancyMode,
) -> VibrancyResult {
    let previous = *state.vibrancy.lock().unwrap_or_else(|e| e.into_inner());

    let outcome = apply_backdrop(window, previous, mode);

    let (applied, error) = match outcome {
        Ok(()) => (mode, None),
        Err(e) => {
            log::warn!("window_set_vibrancy({mode:?}) failed: {e}");
            (VibrancyMode::None, Some(e))
        }
    };
    *state.vibrancy.lock().unwrap_or_else(|e| e.into_inner()) = applied;
    sync_region(window, state);
    VibrancyResult {
        requested: mode,
        applied,
        error,
    }
}

fn apply_backdrop(
    window: &WebviewWindow,
    previous: VibrancyMode,
    mode: VibrancyMode,
) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    if previous != mode {
        // Drop whatever was applied before (accent policy and/or DWM system backdrop).
        accent_disable(hwnd);
        let _ = window_vibrancy::clear_acrylic(window);
    }
    match mode {
        VibrancyMode::Acrylic => match acrylic_impl() {
            AcrylicImpl::Accent => accent_acrylic(hwnd, ACRYLIC_TINT),
            AcrylicImpl::Backdrop => window_vibrancy::apply_acrylic(window, Some(ACRYLIC_TINT))
                .map_err(|e| e.to_string()),
        },
        VibrancyMode::Mica => {
            window_vibrancy::apply_mica(window, Some(true)).map_err(|e| e.to_string())
        }
        VibrancyMode::None => Ok(()),
    }
}

/// How Acrylic is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AcrylicImpl {
    /// `SetWindowCompositionAttribute` accent policy (ACCENT_ENABLE_ACRYLICBLURBEHIND): real
    /// acrylic with a custom tint.
    Accent,
    /// `DWMWA_SYSTEMBACKDROP_TYPE = DWMSBT_TRANSIENTWINDOW` (Windows 11 22H2+, via `window-vibrancy`).
    Backdrop,
}

/// Debug: `ISLAND_ACRYLIC_IMPL=backdrop` selects the system-backdrop path.
fn acrylic_impl() -> AcrylicImpl {
    #[cfg(debug_assertions)]
    if std::env::var("ISLAND_ACRYLIC_IMPL").is_ok_and(|v| v == "backdrop") {
        return AcrylicImpl::Backdrop;
    }
    AcrylicImpl::Accent
}

#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    /// 0xAABBGGRR
    gradient_color: u32,
    animation_id: u32,
}

#[repr(C)]
struct WindowCompositionAttribData {
    attrib: u32,
    data: *mut core::ffi::c_void,
    size: usize,
}

const WCA_ACCENT_POLICY: u32 = 19;
const ACCENT_DISABLED: u32 = 0;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

type SetWindowCompositionAttribute =
    unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> windows::core::BOOL;

fn set_accent(hwnd: HWND, state: u32, color: (u8, u8, u8, u8)) -> Result<(), String> {
    // SAFETY: user32.dll is always loaded; `SetWindowCompositionAttribute` is an undocumented but
    // stable export with exactly this signature (used by window-vibrancy and Windows itself). The
    // policy/data structs live on the stack for the duration of the call.
    unsafe {
        let user32 = GetModuleHandleW(w!("user32.dll")).map_err(|e| e.to_string())?;
        let proc = GetProcAddress(user32, s!("SetWindowCompositionAttribute"))
            .ok_or("SetWindowCompositionAttribute is not available")?;
        let set: SetWindowCompositionAttribute = std::mem::transmute(proc);
        let alpha = if state == ACCENT_ENABLE_ACRYLICBLURBEHIND {
            color.3.max(1) // acrylic does not accept a fully transparent tint
        } else {
            color.3
        };
        let mut policy = AccentPolicy {
            accent_state: state,
            accent_flags: 0,
            gradient_color: u32::from(color.0)
                | u32::from(color.1) << 8
                | u32::from(color.2) << 16
                | u32::from(alpha) << 24,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: WCA_ACCENT_POLICY,
            data: (&raw mut policy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };
        if set(hwnd, &mut data).as_bool() {
            Ok(())
        } else {
            Err("SetWindowCompositionAttribute failed".into())
        }
    }
}

fn accent_acrylic(hwnd: HWND, tint: (u8, u8, u8, u8)) -> Result<(), String> {
    set_accent(hwnd, ACCENT_ENABLE_ACRYLICBLURBEHIND, tint)
}

fn accent_disable(hwnd: HWND) {
    let _ = set_accent(hwnd, ACCENT_DISABLED, (0, 0, 0, 0));
}

/// Debug switch: `ISLAND_REGION=0` keeps the backdrop but never installs the window region
/// (used to compare "blur over the whole window" with "blur clipped to the shape").
fn region_enabled() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("ISLAND_REGION")
            .map(|v| v != "0")
            .unwrap_or(true)
    }
    #[cfg(not(debug_assertions))]
    {
        true
    }
}

/// Bring the window region in line with the current shape / vibrancy / DPI. Cheap when nothing
/// changed (the last applied rectangle is cached), so it can be called on every shape update.
pub fn sync_region(window: &WebviewWindow, state: &IslandState) {
    let Ok(hwnd) = hwnd_of(window) else { return };
    let vibrancy = *state.vibrancy.lock().unwrap_or_else(|e| e.into_inner());
    let want: Option<RegionRect> = if vibrancy == VibrancyMode::None || !region_enabled() {
        None
    } else {
        let shape: IslandShape = *state.shape.read().unwrap_or_else(|e| e.into_inner());
        let scale = native::window_scale(hwnd);
        native::window_rect(hwnd)
            .and_then(|(l, t, r, b)| region_rect(&shape, scale, (r - l, b - t)))
    };

    let mut applied = state.region.lock().unwrap_or_else(|e| e.into_inner());
    if *applied == want {
        return;
    }
    set_region(hwnd, want);
    *applied = want;
}

/// Install (or remove, for `None`) the window region. Coordinates are physical px relative to the
/// window's top-left.
fn set_region(hwnd: HWND, rect: Option<RegionRect>) {
    // SAFETY: `hwnd` is the app's live window. On success `SetWindowRgn` takes ownership of the
    // region handle (we must not delete it); on failure (returns 0) we still own it and delete it.
    unsafe {
        match rect {
            None => {
                SetWindowRgn(hwnd, None, true);
            }
            Some(r) => {
                // CreateRoundRectRgn yields a region one pixel short on the right/bottom edge
                // (measured with GetRgnBox), hence the +1.
                let rgn = CreateRoundRectRgn(
                    r.left,
                    r.top,
                    r.right + 1,
                    r.bottom + 1,
                    r.ellipse,
                    r.ellipse,
                );
                if SetWindowRgn(hwnd, Some(rgn), true) == 0 {
                    let _ = DeleteObject(HGDIOBJ(rgn.0));
                }
            }
        }
    }
}
