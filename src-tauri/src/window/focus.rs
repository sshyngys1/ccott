//! Keyboard focus for the otherwise non-activating island window (contract section 3a).
//!
//! `island_set_keyboard_focus({ active: true })`:
//! 1. remember the foreground window if it is an external application (not shell chrome);
//! 2. allow activation: the subclass stops forcing `WS_EX_NOACTIVATE` (`styles::set_allow_activate`);
//! 3. bring the island to the foreground in spite of the foreground lock (see
//!    [`bring_to_foreground`]);
//! 4. move the WebView2 keyboard focus into the web content;
//! 5. emit `island://focus-changed { active: true }`.
//!
//! `active: false` restores `NOACTIVATE`, gives the foreground back to the remembered window if
//! the island still owns it, and emits `{ active: false }`. If the island loses activation on its
//! own while active (the user clicked another app) the subclass calls [`on_deactivated`]: back to
//! `NOACTIVATE`, nothing is restored, `{ active: false }` is emitted.
//!
//! The island never gets a taskbar button or an Alt+Tab entry: only `WS_EX_NOACTIVATE` is
//! dropped, `WS_EX_TOOLWINDOW` stays. The click-through logic of the hover thread is not touched.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VK_MENU,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GA_ROOT, GetAncestor, GetClassNameW, GetForegroundWindow,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
};

use super::fullscreen::is_own_window;
use super::types::FocusPayload;
use super::{IslandState, native, styles};

pub const FOCUS_EVENT: &str = "island://focus-changed";

/// Activation completed and has not been lost since.
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// The window that was in the foreground before the island took over (0 = none).
static REMEMBERED: AtomicIsize = AtomicIsize::new(0);
/// Serializes `island_set_keyboard_focus` calls (they run on worker threads).
static OPERATION: Mutex<()> = Mutex::new(());
/// The desired flag and its sequence share one atomic: concurrent submissions cannot publish a
/// new sequence with an old desired value. Register on command ingress, before spawn_blocking.
static DESIRED: FocusRequests = FocusRequests::new();

struct FocusRequests(AtomicU64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FocusRequest(u64);

impl FocusRequest {
    fn active(self) -> bool {
        self.0 & 1 != 0
    }
}

impl FocusRequests {
    const fn new() -> Self {
        Self(AtomicU64::new(0))
    }

    fn register(&self, active: bool) -> FocusRequest {
        // Low bit = desired focus, remaining bits = sequence (including repeated true/false).
        let next = |value: u64| (value & !1).wrapping_add(2) | u64::from(active);
        let previous = self
            .0
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                Some(next(value))
            })
            .expect("focus request update always succeeds");
        FocusRequest(next(previous))
    }

    fn is_current(&self, request: FocusRequest) -> bool {
        self.0.load(Ordering::Acquire) == request.0
    }
}

/// Called synchronously in the command, not from the (potentially reordered) blocking workers.
pub fn request(active: bool) -> FocusRequest {
    DESIRED.register(active)
}

/// Same exclusions as R2's paste-target tracker, without depending on its module.
const SHELL_CLASSES: &[&str] = &[
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "XamlExplorerHostIslandWindow",
    "Progman",
    "WorkerW",
    "Windows.UI.Core.CoreWindow",
];

fn is_shell_class(class: &str) -> bool {
    SHELL_CLASSES.iter().any(|c| c.eq_ignore_ascii_case(class))
}

fn is_restore_target(hwnd: HWND) -> bool {
    if hwnd.is_invalid() || is_own_window(hwnd) {
        return false;
    }
    // SAFETY: plain queries; stale handles fail. No window pointer is dereferenced by Rust.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool()
            || !IsWindowVisible(hwnd).as_bool()
            || IsIconic(hwnd).as_bool()
            || GetAncestor(hwnd, GA_ROOT) != hwnd
        {
            return false;
        }
    }
    let mut buf = [0u16; 256];
    // SAFETY: `buf` is a valid writable buffer; an invalid hwnd returns zero.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    len > 0 && !is_shell_class(&String::from_utf16_lossy(&buf[..len as usize]))
}

/// How long to wait for the foreground change to show up after `SetForegroundWindow`.
const FOREGROUND_WAIT: Duration = Duration::from_millis(150);

fn hwnd_from(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

fn island_hwnd(app: &AppHandle) -> HWND {
    hwnd_from(app.state::<IslandState>().hwnd.load(Ordering::Relaxed))
}

fn is_foreground(hwnd: HWND) -> bool {
    // SAFETY: plain query.
    unsafe { GetForegroundWindow() == hwnd }
}

fn wait_foreground(hwnd: HWND) -> bool {
    let start = Instant::now();
    loop {
        if is_foreground(hwnd) {
            return true;
        }
        if start.elapsed() >= FOREGROUND_WAIT {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Synthetic ALT key event: down (`up == false`) or up.
fn send_alt(up: bool) {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    };
    // SAFETY: one fully initialised INPUT and its exact size.
    unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
}

/// Makes `hwnd` the foreground window although the foreground lock may forbid it. Escalation,
/// cheapest and least intrusive first:
///
/// 1. plain `SetForegroundWindow` - works whenever the process received the last input event,
///    which is the usual case (the user has just clicked or focused an input in the island);
/// 2. `AttachThreadInput` to the foreground window's thread for the duration of the call - the
///    system then treats the call as coming from the thread that owns the foreground, which
///    lifts the lock without any visible side effect;
/// 3. a synthetic ALT key press around the call (the documented side effect of the lock: an
///    ALT keystroke counts as user input). The key-up is sent only after the island is in the
///    foreground, so the previous app sees a lone Alt-down and not a full tap, which would
///    activate its menu bar.
///
/// `AllowSetForegroundWindow` is not used: it lets *another* process take the foreground, it
/// cannot help the calling process itself.
/// Restoring another app passes `allow_alt = false`: R2 owns any paste-related ALT injection.
fn bring_to_foreground(hwnd: HWND, previous: HWND, allow_alt: bool) -> bool {
    // SAFETY: SetForegroundWindow / BringWindowToTop / AttachThreadInput / GetWindowThreadProcessId
    // only take window or thread handles; stale handles make them fail, not misbehave.
    unsafe {
        let _ = SetForegroundWindow(hwnd);
        if wait_foreground(hwnd) {
            log::debug!("foreground: plain SetForegroundWindow");
            return true;
        }

        let me = GetCurrentThreadId();
        let their = if previous.is_invalid() {
            0
        } else {
            GetWindowThreadProcessId(previous, None)
        };
        let attached = their != 0 && their != me && AttachThreadInput(me, their, true).as_bool();
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        if attached {
            let _ = AttachThreadInput(me, their, false);
        }
        if wait_foreground(hwnd) {
            log::debug!("foreground: AttachThreadInput (attached: {attached})");
            return true;
        }

        if !allow_alt {
            return false;
        }

        send_alt(false);
        let _ = SetForegroundWindow(hwnd);
        let ok = wait_foreground(hwnd);
        send_alt(true);
        log::debug!("foreground: ALT trick, success: {ok}");
        ok
    }
}

/// WebView2 takes keyboard focus into the page (the top-level window being active is not
/// enough: the focus has to be moved into the browser control).
fn focus_webview(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("island") {
        // `WebviewWindow::set_focus` would only focus the native window; the page needs the
        // webview's own `set_focus` (WebView2 `MoveFocus`).
        let webview: &tauri::Webview = window.as_ref();
        if let Err(e) = webview.set_focus() {
            log::warn!("webview focus failed: {e}");
        }
    }
}

fn emit_changed(app: &AppHandle, active: bool) {
    crate::hotkeys::on_focus_changed(app, active);
    let _ = app.emit(FOCUS_EVENT, FocusPayload { active });
}

/// `island_set_keyboard_focus` (blocking; call from a worker thread).
pub fn set_active(app: &AppHandle, request: FocusRequest) -> Result<(), String> {
    let _op = OPERATION.lock().unwrap_or_else(|e| e.into_inner());
    if !DESIRED.is_current(request) {
        return Ok(());
    }
    let hwnd = island_hwnd(app);
    if hwnd.is_invalid() {
        return Err("the island window is not ready".into());
    }
    let result = if request.active() {
        activate(app, hwnd, request)
    } else {
        deactivate(app, hwnd);
        Ok(())
    };
    // Returning focus to another app must not return the island to the ordinary z-order band.
    styles::ensure_topmost(hwnd)?;
    result
}

fn activate(app: &AppHandle, hwnd: HWND, request: FocusRequest) -> Result<(), String> {
    if ACTIVE.load(Ordering::Acquire) && is_foreground(hwnd) {
        crate::hotkeys::on_focus_changed(app, true);
        focus_webview(app); // idempotent: just make sure the page has the keyboard
        if !DESIRED.is_current(request) {
            deactivate(app, hwnd);
        }
        return Ok(());
    }
    if !native::is_visible(hwnd) {
        return Err("the island is hidden".into());
    }

    // SAFETY: plain query.
    let previous = unsafe { GetForegroundWindow() };
    REMEMBERED.store(
        if is_restore_target(previous) {
            previous.0 as isize
        } else {
            0
        },
        Ordering::Release,
    );

    styles::set_allow_activate(true);
    styles::apply_island_styles(hwnd);
    if !bring_to_foreground(hwnd, previous, true) {
        styles::set_allow_activate(false);
        styles::apply_island_styles(hwnd);
        REMEMBERED.store(0, Ordering::Release);
        // The UI may be waiting for the event: tell it the focus is not active.
        emit_changed(app, false);
        return Err("Windows refused to activate the island (foreground lock)".into());
    }
    ACTIVE.store(true, Ordering::Release);
    // A later Esc may have arrived while Win32 was waiting for the foreground lock. Roll back
    // the partial activation before releasing OPERATION, even if its worker has not run yet.
    if !DESIRED.is_current(request) {
        deactivate(app, hwnd);
        return Ok(());
    }
    focus_webview(app);
    if !DESIRED.is_current(request) {
        deactivate(app, hwnd);
        return Ok(());
    }
    emit_changed(app, true);
    Ok(())
}

fn deactivate(app: &AppHandle, hwnd: HWND) {
    let was_active = ACTIVE.swap(false, Ordering::AcqRel);
    // From here on the subclass ignores the WM_ACTIVATE(WA_INACTIVE) caused by our own hand-over.
    let was_allowed = styles::set_allow_activate(false);
    if was_allowed {
        styles::apply_island_styles(hwnd);
    }
    let remembered = REMEMBERED.swap(0, Ordering::AcqRel);

    // Give the foreground back only if the island still owns it; if the user already moved on
    // to another window, that choice stays.
    let island_is_foreground = is_foreground(hwnd);
    log::debug!(
        "keyboard focus off: was_active={was_active} remembered={remembered:#x} island_foreground={island_is_foreground}"
    );
    if was_active && remembered != 0 && island_is_foreground {
        let target = hwnd_from(remembered);
        // Revalidate: a remembered HWND may have disappeared or been reused by the shell.
        if is_restore_target(target) {
            let ok = bring_to_foreground(target, hwnd, false);
            log::debug!("foreground returned to {remembered:#x}: {ok}");
        }
    }
    if was_active {
        emit_changed(app, false);
    }
}

/// The island window was deactivated (`WM_ACTIVATE` / `WA_INACTIVE`, called from the window
/// procedure on the main thread). Does nothing unless the keyboard focus was requested.
pub fn on_deactivated(hwnd: HWND) {
    if !styles::set_allow_activate(false) {
        return;
    }
    // Losing focus externally also cancels any activation still queued or waiting in Win32.
    DESIRED.register(false);
    // Unlike `deactivate` nothing is restored: the user chose another window.
    REMEMBERED.store(0, Ordering::Release);
    let was_active = ACTIVE.swap(false, Ordering::AcqRel);
    styles::apply_island_styles(hwnd);
    if was_active && let Some(app) = super::APP.get() {
        let app = app.clone();
        // Not from inside the window procedure: emitting may call back into the windowing layer.
        std::thread::spawn(move || emit_changed(&app, false));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_deactivation_wins_when_workers_run_in_reverse_order() {
        let requests = FocusRequests::new();
        let activate = requests.register(true);
        let deactivate = requests.register(false);
        let mut active = false;
        for request in [deactivate, activate] {
            if requests.is_current(request) {
                active = request.active();
            }
        }
        assert!(!active, "an old activation must not undo Esc");
    }

    #[test]
    fn deactivate_cancels_an_activation_already_in_flight() {
        let requests = FocusRequests::new();
        let activate = requests.register(true);
        assert!(requests.is_current(activate)); // worker starts the Win32 handover
        let deactivate = requests.register(false); // Esc during the handover
        assert!(!requests.is_current(activate)); // activation must roll back
        assert!(requests.is_current(deactivate));
        assert!(!deactivate.active());
    }

    #[test]
    fn sequence_distinguishes_repeated_desired_values() {
        let requests = FocusRequests::new();
        let first = requests.register(true);
        let middle = requests.register(false);
        let latest = requests.register(true);
        assert!(!requests.is_current(first));
        assert!(!requests.is_current(middle));
        assert!(requests.is_current(latest));
        assert!(latest.active());
        let repeated = requests.register(true);
        assert!(!requests.is_current(latest));
        assert!(requests.is_current(repeated));
    }

    #[test]
    fn restoration_excludes_shell_and_flyouts_but_keeps_apps() {
        for class in SHELL_CLASSES {
            assert!(is_shell_class(class));
            assert!(is_shell_class(&class.to_lowercase()));
        }
        for class in ["Notepad", "Chrome_WidgetWin_1", "CabinetWClass"] {
            assert!(!is_shell_class(class));
        }
    }
}
