//! `hideInFullscreen`, `fullscreenAllowlist`, `summonHotkey` override and `fullscreen_seen.json`:
//! hide the island while a fullscreen app (game, video, F11 browser, presentation) is in the
//! foreground on the island's monitor, unless the app's exe is in `fullscreenAllowlist` or the
//! island is temporarily summoned by `summonHotkey`.
//!
//! Seen fullscreen apps (lower-case exe, window title, lastSeen epoch ms) are recorded up to 20
//! entries (newest first, deduplicated by exe) and persisted atomically to `fullscreen_seen.json`
//! next to `settings.json`.
//!
//! The visibility decision ([`should_hide_with_policy`]) and the seen-list maintenance
//! ([`record_seen_app`]) are pure and unit-tested.

use std::cell::Cell;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetCurrentThreadId, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND, GWL_STYLE,
    GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsZoomed, KillTimer, MSG, OBJID_WINDOW, PM_NOREMOVE,
    PeekMessageW, PostThreadMessageW, SetTimer, TranslateMessage, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_QUIT, WM_TIMER, WS_CAPTION, WS_MAXIMIZE,
};
use windows::core::PWSTR;

use super::IslandState;
use super::native;
use super::types::FullscreenApp;

/// Screen rectangle `(left, top, right, bottom)` in physical px.
pub type Rect = (i32, i32, i32, i32);

pub const SEEN_FILE_NAME: &str = "fullscreen_seen.json";
pub const MAXIMIZED_SEEN_FILE_NAME: &str = "maximized_seen.json";
pub const MAX_RECENT_APPS: usize = 20;
pub const SUMMONED_EVENT: &str = "island://summoned";
/// Invisible DWM frame allowance at the top edge of a maximized / top-snapped window.
pub const TOP_EDGE_BORDER_ALLOWANCE_PX: i32 = 12;
/// Tolerance below `work_top` for top-edge alignment.
pub const TOP_EDGE_TOLERANCE_PX: i32 = 2;

/// Safety-net re-check period.
const TIMER_MS: u32 = 750;
/// Location-change events of the foreground window are handled at most this often.
const LOCATION_THROTTLE: Duration = Duration::from_millis(60);
/// Minimum interval between disk writes when the same fullscreen app stays continuously active.
const PERSIST_SAME_APP_INTERVAL_MS: i64 = 60_000;

/// Window classes of the desktop shell: they fill the monitor but are not "a fullscreen app".
const SHELL_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    // Alt+Tab, Task View.
    "XamlExplorerHostIslandWindow",
    "MultitaskingViewFrame",
    "ForegroundStaging",
];

/// Everything the decision needs to know about the foreground window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub rect: Rect,
    /// Desktop / taskbar / task switcher (see [`is_shell_class`]).
    pub shell: bool,
    /// Belongs to this process.
    pub own: bool,
    pub visible: bool,
    pub minimized: bool,
    pub cloaked: bool,
    /// Has a title bar (`WS_CAPTION`): a normal window, even if maximized.
    pub has_caption: bool,
    pub maximized: bool,
    /// Lower-case executable name (e.g. `"cs2.exe"`), or `""` when unknown.
    pub exe: String,
}

#[derive(Default)]
pub struct SeenStore {
    apps: Vec<FullscreenApp>,
    path: Option<PathBuf>,
    last_saved_ms: Option<i64>,
}

pub fn is_shell_class(class: &str) -> bool {
    SHELL_CLASSES.iter().any(|c| c.eq_ignore_ascii_case(class))
}

/// `rect` covers the whole `monitor` rectangle (it may be larger: maximized windows overshoot by
/// their invisible borders).
pub fn covers(rect: Rect, monitor: Rect) -> bool {
    monitor.2 > monitor.0
        && monitor.3 > monitor.1
        && rect.0 <= monitor.0
        && rect.1 <= monitor.1
        && rect.2 >= monitor.2
        && rect.3 >= monitor.3
}

/// The foreground window is a fullscreen app on `monitor`. A maximized normal window also
/// covers the monitor when the taskbar auto-hides, which is why captioned maximized windows are
/// excluded: real fullscreen apps drop the title bar (or never had one).
pub fn is_fullscreen(c: &Candidate, monitor: Rect) -> bool {
    !c.shell
        && !c.own
        && c.visible
        && !c.minimized
        && !c.cloaked
        && !(c.has_caption && c.maximized)
        && covers(c.rect, monitor)
}

/// True when `exe` is present in `allowlist` (trimmed, case-insensitive).
pub fn is_allowlisted(exe: &str, allowlist: &[String]) -> bool {
    let exe = exe.trim();
    !exe.is_empty()
        && allowlist
            .iter()
            .any(|item| item.trim().eq_ignore_ascii_case(exe))
}

/// Full visibility decision: accounts for `hideInFullscreen` (`enabled`), temporary hotkey
/// `summoned` state, and `fullscreenAllowlist` (`allowlist`).
pub fn should_hide_with_policy(
    enabled: bool,
    summoned: bool,
    allowlist: &[String],
    foreground: Option<&Candidate>,
    monitor: Rect,
) -> bool {
    enabled
        && !summoned
        && foreground
            .is_some_and(|c| is_fullscreen(c, monitor) && !is_allowlisted(&c.exe, allowlist))
}

/// Should the island be hidden right now (with empty allowlist and not summoned)?
#[cfg(test)]
pub fn should_hide(enabled: bool, foreground: Option<&Candidate>, monitor: Rect) -> bool {
    should_hide_with_policy(enabled, false, &[], foreground, monitor)
}

/// Whether `rect` belongs to `monitor` (its center falls inside `monitor`).
pub fn is_on_monitor(rect: Rect, monitor: Rect) -> bool {
    if monitor.2 <= monitor.0 || monitor.3 <= monitor.1 || rect.2 <= rect.0 || rect.3 <= rect.1 {
        return false;
    }
    let cx = i64::from(rect.0) + (i64::from(rect.2) - i64::from(rect.0)) / 2;
    let cy = i64::from(rect.1) + (i64::from(rect.3) - i64::from(rect.1)) / 2;
    cx >= i64::from(monitor.0)
        && cx < i64::from(monitor.2)
        && cy >= i64::from(monitor.1)
        && cy < i64::from(monitor.3)
}

/// True when `c` is a visible, non-fullscreen application window on `monitor` that is either
/// maximized (`IsZoomed` / `WS_MAXIMIZE`) or has its top edge aligned with `work_top` of the
/// island's monitor.
pub fn is_maximized_or_top_edge(c: &Candidate, monitor: Rect, work_top: i32) -> bool {
    if c.shell
        || c.own
        || !c.visible
        || c.minimized
        || c.cloaked
        || !is_on_monitor(c.rect, monitor)
        || is_fullscreen(c, monitor)
    {
        return false;
    }
    let top_aligned = c.rect.1 >= work_top - TOP_EDGE_BORDER_ALLOWANCE_PX
        && c.rect.1 <= work_top + TOP_EDGE_TOLERANCE_PX;
    c.maximized || top_aligned
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HideReason {
    Visible,
    Fullscreen,
    AutoHide,
}

#[derive(Debug, Clone, Copy)]
pub struct HidePolicy<'a> {
    pub hide_in_fullscreen: bool,
    pub fullscreen_allowlist: &'a [String],
    pub auto_hide_apps: &'a [String],
    pub summoned: bool,
    pub dwell_revealed: bool,
    pub monitor: Rect,
    pub work_top: i32,
}

/// Unified visibility decision for fullscreen (§8) and auto-hide over selected apps (§14).
/// Fullscreen mode (§8) is evaluated first and takes priority over auto-hide.
pub fn decide_visibility(policy: &HidePolicy<'_>, foreground: Option<&Candidate>) -> HideReason {
    let Some(c) = foreground else {
        return HideReason::Visible;
    };
    if is_fullscreen(c, policy.monitor) {
        if should_hide_with_policy(
            policy.hide_in_fullscreen,
            policy.summoned,
            policy.fullscreen_allowlist,
            Some(c),
            policy.monitor,
        ) {
            return HideReason::Fullscreen;
        }
        return HideReason::Visible;
    }
    if !policy.summoned
        && !policy.dwell_revealed
        && is_maximized_or_top_edge(c, policy.monitor, policy.work_top)
        && is_allowlisted(&c.exe, policy.auto_hide_apps)
    {
        return HideReason::AutoHide;
    }
    HideReason::Visible
}

// ───────────────────────────── Seen fullscreen apps (pure + persistence) ─────────────────────────────

/// Records a seen fullscreen app in `list` (lower-case `exe`, newest first, deduplicated by `exe`,
/// capped at [`MAX_RECENT_APPS`]). Returns `true` when the head entry changed (`exe` or `title`).
pub fn record_seen_app(
    list: &mut Vec<FullscreenApp>,
    exe: &str,
    title: &str,
    last_seen: i64,
) -> bool {
    let exe = exe.trim().to_lowercase();
    if exe.is_empty() {
        return false;
    }
    let title = title.trim();
    let prev_title = list
        .iter()
        .find(|item| item.exe.eq_ignore_ascii_case(&exe))
        .map(|item| item.title.clone())
        .unwrap_or_default();
    let resolved_title = if title.is_empty() {
        prev_title
    } else {
        title.to_string()
    };

    let head_changed = list
        .first()
        .is_none_or(|first| first.exe != exe || first.title != resolved_title);

    list.retain(|item| !item.exe.eq_ignore_ascii_case(&exe));
    list.insert(
        0,
        FullscreenApp {
            exe,
            title: resolved_title,
            last_seen,
        },
    );
    if list.len() > MAX_RECENT_APPS {
        list.truncate(MAX_RECENT_APPS);
    }
    head_changed
}

/// Normalizes an arbitrary list loaded from disk: lower-cases `exe`, drops empty `exe` entries,
/// sorts newest first, deduplicates by `exe`, and caps at [`MAX_RECENT_APPS`].
pub fn normalize_seen_list(mut raw: Vec<FullscreenApp>) -> Vec<FullscreenApp> {
    raw.sort_by_key(|a| std::cmp::Reverse(a.last_seen));
    let mut out = Vec::with_capacity(raw.len().min(MAX_RECENT_APPS));
    for item in raw {
        let exe = item.exe.trim().to_lowercase();
        if exe.is_empty()
            || out
                .iter()
                .any(|existing: &FullscreenApp| existing.exe == exe)
        {
            continue;
        }
        out.push(FullscreenApp {
            exe,
            title: item.title.trim().to_string(),
            last_seen: item.last_seen,
        });
        if out.len() >= MAX_RECENT_APPS {
            break;
        }
    }
    out
}

/// Tolerant load of `fullscreen_seen.json`: missing or malformed files return an empty list.
pub fn load_seen(path: &Path) -> Vec<FullscreenApp> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            log::warn!("fullscreen: cannot read {}: {e}", path.display());
            return Vec::new();
        }
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else {
        log::warn!(
            "fullscreen: {} is not a JSON array, ignoring",
            path.display()
        );
        return Vec::new();
    };
    let parsed: Vec<FullscreenApp> = items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<FullscreenApp>(v).ok())
        .collect();
    normalize_seen_list(parsed)
}

/// Atomic write of `fullscreen_seen.json` via `<file>.tmp` + `sync_all` + `rename`.
pub fn save_seen(path: &Path, apps: &[FullscreenApp]) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(apps).map_err(std::io::Error::other)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

pub fn init_seen_store(state: &IslandState, path: PathBuf) {
    let apps = load_seen(&path);
    let mut store = state
        .fullscreen_seen
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    store.apps = apps;
    store.path = Some(path);
}

pub fn init_maximized_seen_store(state: &IslandState, path: PathBuf) {
    let apps = load_seen(&path);
    let mut store = state
        .maximized_seen
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    store.apps = apps;
    store.path = Some(path);
}

pub fn recent_apps(state: &IslandState) -> Vec<FullscreenApp> {
    state
        .fullscreen_seen
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .apps
        .clone()
}

pub fn recent_maximized_apps(state: &IslandState) -> Vec<FullscreenApp> {
    state
        .maximized_seen
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .apps
        .clone()
}

fn note_seen_in(store_mutex: &std::sync::Mutex<SeenStore>, exe: &str, title: &str, now_ms: i64) {
    let snapshot_to_save = {
        let mut store = store_mutex.lock().unwrap_or_else(|e| e.into_inner());
        let head_changed = record_seen_app(&mut store.apps, exe, title, now_ms);
        let due_by_time = store
            .last_saved_ms
            .is_none_or(|last| now_ms.saturating_sub(last) >= PERSIST_SAME_APP_INTERVAL_MS);
        if (head_changed || due_by_time)
            && let Some(path) = store.path.clone()
        {
            store.last_saved_ms = Some(now_ms);
            Some((path, store.apps.clone()))
        } else {
            None
        }
    };
    if let Some((path, apps)) = snapshot_to_save
        && let Err(e) = save_seen(&path, &apps)
    {
        log::warn!("fullscreen: cannot write {}: {e}", path.display());
    }
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

// ───────────────────────────── Win32 queries ─────────────────────────────

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    // SAFETY: `buf` is a valid, writable buffer; an invalid `hwnd` makes the call return 0.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0)])
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    // SAFETY: `buf` is a valid, writable buffer; an invalid `hwnd` makes the call return 0.
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0)])
        .trim()
        .to_string()
}

fn exe_name(hwnd: HWND) -> String {
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid, writable u32; an invalid `hwnd` leaves it 0.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return String::new();
    }
    // SAFETY: plain Win32 calls; the process handle is closed on every path, `buf`/`len` are valid.
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok =
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase()
    }
}

pub fn is_own_window(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid, writable u32; an invalid `hwnd` leaves it 0.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    // SAFETY: plain query.
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: the pointer/size pair describes `cloaked`, a valid writable u32.
    let r = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    r.is_ok() && cloaked != 0
}

fn candidate_of(hwnd: HWND) -> Option<Candidate> {
    let rect = native::window_rect(hwnd)?;
    // SAFETY: plain queries on a window handle; stale handles just give zeros.
    let (style, minimized, zoomed) = unsafe {
        (
            GetWindowLongPtrW(hwnd, GWL_STYLE) as u32,
            IsIconic(hwnd),
            IsZoomed(hwnd),
        )
    };
    Some(Candidate {
        rect,
        shell: is_shell_class(&class_name(hwnd)),
        own: is_own_window(hwnd),
        visible: native::is_visible(hwnd),
        minimized: minimized.as_bool(),
        cloaked: is_cloaked(hwnd),
        has_caption: style & WS_CAPTION.0 == WS_CAPTION.0,
        maximized: zoomed.as_bool() || (style & WS_MAXIMIZE.0 != 0),
        exe: exe_name(hwnd),
    })
}

/// Full rectangle and work-area top of the monitor the island window is on.
fn island_monitor_rects(island: HWND) -> Option<(Rect, i32)> {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: `info` is a valid MONITORINFO with `cbSize` set; the monitor handle comes from the
    // call right before.
    unsafe {
        let monitor = MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(monitor, &mut info)
            .as_bool()
            .then_some(())?;
    }
    let r = info.rcMonitor;
    let work_top = info.rcWork.top.max(r.top);
    Some(((r.left, r.top, r.right, r.bottom), work_top))
}

// ───────────────────────────── Hiding / showing / summoning ─────────────────────────────

fn set_hidden(app: &AppHandle, hide: bool) {
    let state = app.state::<IslandState>();
    if state.fullscreen_hidden.swap(hide, Ordering::AcqRel) == hide {
        return;
    }
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    log::debug!("fullscreen/autohide on the island's monitor: hide={hide}");
    // Keep show and topmost restoration ordered on the window's owning thread. `show` alone
    // need not reapply the native z-order when the framework's alwaysOnTop flag is unchanged.
    let w = window.clone();
    let result = window.run_on_main_thread(move || {
        if !hide
            && w.state::<IslandState>()
                .capture_active
                .load(Ordering::Acquire)
        {
            return;
        }
        let result = if hide {
            w.hide().map_err(|e| e.to_string())
        } else {
            w.show()
                .map_err(|e| e.to_string())
                .and_then(|()| super::styles::hwnd_of(&w))
                .and_then(super::styles::ensure_topmost)
        };
        if let Err(e) = result {
            log::warn!("island hide/show failed: {e}");
        }
    });
    if let Err(e) = result {
        log::warn!("island hide/show failed: {e}");
    }
    if !hide
        && let Some(t) = state
            .hover_thread
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
    {
        t.unpark();
    }
}

/// Shows the island over fullscreen / auto-hidden apps (without stealing focus), reasserts
/// `HWND_TOPMOST` and emits `island://summoned`. While opened via summon and unfocused, registers
/// temporary global `Escape`.
pub fn summon(app: &AppHandle) {
    let state = app.state::<IslandState>();
    if state.capture_active.load(Ordering::Acquire) {
        return;
    }
    let already_expanded =
        *state.mode.read().unwrap_or_else(|e| e.into_inner()) == super::types::IslandMode::Expanded;
    if already_expanded {
        state.summoned.store(false, Ordering::Release);
        crate::hotkeys::on_collapsed(app);
    } else {
        state.summoned.store(true, Ordering::Release);
        state.fullscreen_hidden.store(false, Ordering::Release);
        crate::hotkeys::on_summoned(app);
    }
    if let Some(t) = state
        .hover_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        t.unpark();
    }
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    let w = window.clone();
    let app_clone = app.clone();
    let result = window.run_on_main_thread(move || {
        if !already_expanded {
            let res = w
                .show()
                .map_err(|e| e.to_string())
                .and_then(|()| super::styles::hwnd_of(&w))
                .and_then(super::styles::ensure_topmost);
            if let Err(e) = res {
                log::warn!("summon show/topmost failed: {e}");
            }
        }
        let _ = app_clone.emit(SUMMONED_EVENT, ());
    });
    if let Err(e) = result {
        log::warn!("summon main-thread dispatch failed: {e}");
    }
}

/// Called when temporary global `Escape` is pressed while the island is summoned and unfocused.
pub fn collapse_summoned(app: &AppHandle) {
    let state = app.state::<IslandState>();
    state.summoned.store(false, Ordering::Release);
    state.dwell_revealed.store(false, Ordering::Release);
    super::hover::on_collapsed(&state);
    crate::hotkeys::on_collapsed(app);
    let _ = app.emit(SUMMONED_EVENT, ());
    recheck(app);
}

/// One check of the foreground window.
fn evaluate(app: &AppHandle) {
    let state = app.state::<IslandState>();
    if state.capture_active.load(Ordering::Acquire) {
        return;
    }
    let island = HWND(state.hwnd.load(Ordering::Relaxed) as *mut core::ffi::c_void);
    // SAFETY: plain query.
    let fg = unsafe { GetForegroundWindow() };
    let candidate = if fg.is_invalid() {
        None
    } else {
        candidate_of(fg)
    };
    let settings = app
        .try_state::<crate::settings::SettingsState>()
        .map(|s| s.get());
    let enabled = settings.as_ref().is_none_or(|s| s.hide_in_fullscreen);
    let allowlist = settings
        .as_ref()
        .map(|s| s.fullscreen_allowlist.as_slice())
        .unwrap_or(&[]);
    let default_auto_hide: Vec<String>;
    let auto_hide_apps: &[String] = match settings.as_ref() {
        Some(s) => s.auto_hide_apps.as_slice(),
        None => {
            default_auto_hide = crate::settings::model::default_auto_hide_apps();
            default_auto_hide.as_slice()
        }
    };
    let summoned = state.summoned.load(Ordering::Acquire);
    let monitor_and_work = island_monitor_rects(island);

    if let (Some(c), Some((mon, work_top))) = (candidate.as_ref(), monitor_and_work)
        && !c.exe.is_empty()
    {
        if is_fullscreen(c, mon) {
            let title = window_title(fg);
            note_seen_in(&state.fullscreen_seen, &c.exe, &title, now_epoch_ms());
        } else if is_maximized_or_top_edge(c, mon, work_top) {
            let title = window_title(fg);
            note_seen_in(&state.maximized_seen, &c.exe, &title, now_epoch_ms());
        }
    }

    let fg_autohide = match (candidate.as_ref(), monitor_and_work) {
        (Some(c), Some((mon, work_top))) => {
            !is_fullscreen(c, mon)
                && is_maximized_or_top_edge(c, mon, work_top)
                && is_allowlisted(&c.exe, auto_hide_apps)
        }
        _ => false,
    };
    let prev_autohide = state.autohide_active.swap(fg_autohide, Ordering::AcqRel);
    if !fg_autohide {
        state.dwell_revealed.store(false, Ordering::Release);
        super::hover::on_collapsed(&state);
    } else if !prev_autohide
        && let Some(t) = state
            .hover_thread
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
    {
        t.unpark();
    }

    let dwell_revealed = state.dwell_revealed.load(Ordering::Acquire);
    let reason = match monitor_and_work {
        Some((mon, work_top)) => decide_visibility(
            &HidePolicy {
                hide_in_fullscreen: enabled,
                fullscreen_allowlist: allowlist,
                auto_hide_apps,
                summoned,
                dwell_revealed,
                monitor: mon,
                work_top,
            },
            candidate.as_ref(),
        ),
        None => HideReason::Visible,
    };
    set_hidden(app, reason != HideReason::Visible);
}

/// Re-check right now if the watcher is running (display configuration / allowlist / mode changed).
pub fn recheck(app: &AppHandle) {
    let running = app
        .state::<IslandState>()
        .fullscreen_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some();
    if running {
        evaluate(app);
    }
}

// ───────────────────────────── The watcher thread ─────────────────────────────

thread_local! {
    static LAST_LOCATION_CHECK: Cell<Option<Instant>> = const { Cell::new(None) };
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let Some(app) = super::APP.get() else { return };
    if event == EVENT_SYSTEM_FOREGROUND {
        evaluate(app);
        let state = app.state::<IslandState>();
        if !state.fullscreen_hidden.load(Ordering::Acquire) {
            let hwnd = HWND(state.hwnd.load(Ordering::Relaxed) as *mut core::ffi::c_void);
            if let Err(e) = super::styles::ensure_topmost(hwnd) {
                log::debug!("island topmost after external foreground change failed: {e}");
            }
        }
    } else if event == EVENT_OBJECT_LOCATIONCHANGE && id_object == OBJID_WINDOW.0 {
        // SAFETY: plain query.
        if hwnd != unsafe { GetForegroundWindow() } {
            return;
        }
        let now = Instant::now();
        let due = LAST_LOCATION_CHECK.with(|last| {
            let due = last.get().is_none_or(|t| now - t >= LOCATION_THROTTLE);
            if due {
                last.set(Some(now));
            }
            due
        });
        if due {
            evaluate(app);
        }
    }
}

fn watcher(app: &AppHandle, ready: &mpsc::Sender<u32>) {
    // SAFETY: plain query.
    let thread_id = unsafe { GetCurrentThreadId() };
    // Create the thread's message queue before the id is published, so `PostThreadMessageW`
    // (the stop request) cannot fail for lack of one.
    let mut msg = MSG::default();
    // SAFETY: `msg` is a valid, writable MSG.
    unsafe {
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
    }
    let _ = ready.send(thread_id);

    let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
    // SAFETY: `win_event_proc` matches WINEVENTPROC and lives for the whole program; the hooks
    // are removed below, on this same thread, before it ends.
    let (fg_hook, loc_hook, timer) = unsafe {
        (
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_proc),
                0,
                0,
                flags,
            ),
            SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(win_event_proc),
                0,
                0,
                flags,
            ),
            // A thread timer (no window): WM_TIMER is delivered to this loop.
            SetTimer(None, 1, TIMER_MS, None),
        )
    };
    if fg_hook.is_invalid() {
        log::warn!("fullscreen watcher: SetWinEventHook(foreground) failed, timer only");
    }

    evaluate(app);

    // SAFETY: standard message loop on the thread that installed the hooks; GetMessageW returns
    // 0 on WM_QUIT (posted by `set_enabled(false)`) and -1 on error.
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            if msg.message == WM_TIMER {
                evaluate(app);
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if timer != 0 {
            let _ = KillTimer(None, timer);
        }
        if !fg_hook.is_invalid() {
            let _ = UnhookWinEvent(fg_hook);
        }
        if !loc_hook.is_invalid() {
            let _ = UnhookWinEvent(loc_hook);
        }
    }
    // Whatever the watcher hid must come back when it stops.
    set_hidden(app, false);
    log::debug!("fullscreen watcher stopped");
}

/// Starts the foreground watcher if not running yet, or re-evaluates immediately (the watcher
/// tracks both fullscreen apps and `autoHideApps`).
pub fn set_enabled(app: &AppHandle, _enabled: bool) {
    let state = app.state::<IslandState>();
    let mut slot = state
        .fullscreen_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if slot.is_none() {
        let (tx, rx) = mpsc::channel();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("island-fullscreen".into())
            .spawn(move || watcher(&app, &tx));
        match spawned {
            Ok(_) => *slot = rx.recv_timeout(Duration::from_secs(2)).ok(),
            Err(e) => log::error!("cannot start the fullscreen watcher: {e}"),
        }
    } else {
        drop(slot);
        evaluate(app);
    }
}

/// Stops the watcher thread on application shutdown.
pub fn stop(app: &AppHandle) {
    let state = app.state::<IslandState>();
    let mut slot = state
        .fullscreen_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(thread_id) = slot.take() {
        state.summoned.store(false, Ordering::Release);
        // SAFETY: posts WM_QUIT to a thread of this process; failure only means it is gone.
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MON: Rect = (0, 0, 1920, 1080);

    fn app_window(rect: Rect) -> Candidate {
        Candidate {
            rect,
            shell: false,
            own: false,
            visible: true,
            minimized: false,
            cloaked: false,
            has_caption: false,
            maximized: false,
            exe: "game.exe".to_string(),
        }
    }

    #[test]
    fn borderless_fullscreen_hides() {
        assert!(should_hide(true, Some(&app_window(MON)), MON));
        // Slightly larger than the monitor (exclusive fullscreen / overshoot) still counts.
        assert!(should_hide(
            true,
            Some(&app_window((-1, -1, 1921, 1081))),
            MON
        ));
    }

    #[test]
    fn disabled_or_no_foreground_never_hides() {
        assert!(!should_hide(false, Some(&app_window(MON)), MON));
        assert!(!should_hide(true, None, MON));
    }

    #[test]
    fn allowlist_and_summon_prevent_hiding() {
        let fg = Candidate {
            exe: "cs2.exe".to_string(),
            ..app_window(MON)
        };
        let allow = vec!["chrome.exe".to_string(), "CS2.EXE".to_string()];

        // In allowlist (case-insensitive): not hidden.
        assert!(!should_hide_with_policy(
            true,
            false,
            &allow,
            Some(&fg),
            MON
        ));

        // Not in allowlist, not summoned: hidden.
        let other = Candidate {
            exe: "dota2.exe".to_string(),
            ..app_window(MON)
        };
        assert!(should_hide_with_policy(
            true,
            false,
            &allow,
            Some(&other),
            MON
        ));

        // Summoned by hotkey: temporarily shown even when not in allowlist.
        assert!(!should_hide_with_policy(
            true,
            true,
            &allow,
            Some(&other),
            MON
        ));

        // After collapse (summoned = false): hidden again if fullscreen app is still active.
        assert!(should_hide_with_policy(
            true,
            false,
            &allow,
            Some(&other),
            MON
        ));
    }

    #[test]
    fn recent_seen_list_deduplicates_orders_and_caps_at_20() {
        let mut list = Vec::new();
        assert!(record_seen_app(
            &mut list,
            "CS2.exe",
            "Counter-Strike 2",
            1000
        ));
        assert!(record_seen_app(&mut list, "chrome.exe", "YouTube", 2000));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].exe, "chrome.exe");
        assert_eq!(list[1].exe, "cs2.exe");

        // Re-seeing cs2.exe with an empty title moves it to the top and preserves the known title.
        assert!(record_seen_app(&mut list, "  cs2.exe ", "", 3000));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].exe, "cs2.exe");
        assert_eq!(list[0].title, "Counter-Strike 2");
        assert_eq!(list[0].last_seen, 3000);

        // Seeing the exact same app and title at index 0 updates last_seen without reporting head change.
        assert!(!record_seen_app(
            &mut list,
            "cs2.exe",
            "Counter-Strike 2",
            3500
        ));
        assert_eq!(list[0].last_seen, 3500);

        // Cap at 20 entries.
        for i in 0..25 {
            record_seen_app(
                &mut list,
                &format!("app-{i}.exe"),
                &format!("App {i}"),
                4000 + i,
            );
        }
        assert_eq!(list.len(), MAX_RECENT_APPS);
        assert_eq!(list[0].exe, "app-24.exe");
        assert_eq!(list[19].exe, "app-5.exe");
    }

    #[test]
    fn seen_file_saves_and_loads_atomically() {
        let dir =
            std::env::temp_dir().join(format!("island-win-fullscreen-seen-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SEEN_FILE_NAME);

        let mut apps = Vec::new();
        record_seen_app(&mut apps, "VLC.exe", "Movie.mkv", 100);
        record_seen_app(&mut apps, "cs2.exe", "Counter-Strike 2", 200);
        save_seen(&path, &apps).unwrap();

        let loaded = load_seen(&path);
        assert_eq!(loaded, apps);
        assert!(!dir.join("fullscreen_seen.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn windows_smaller_than_the_monitor_do_not_hide() {
        assert!(!should_hide(
            true,
            Some(&app_window((0, 0, 1920, 1040))),
            MON
        )); // taskbar visible
        assert!(!should_hide(
            true,
            Some(&app_window((100, 100, 1000, 800))),
            MON
        ));
        assert!(!should_hide(
            true,
            Some(&app_window((0, 1, 1920, 1080))),
            MON
        ));
    }

    #[test]
    fn maximized_captioned_window_is_not_fullscreen() {
        // Auto-hide taskbar: a maximized window covers the whole monitor (with its borders).
        let c = Candidate {
            has_caption: true,
            maximized: true,
            ..app_window((-8, -8, 1928, 1088))
        };
        assert!(!should_hide(true, Some(&c), MON));
        // The same size without being maximized (a game with a title bar): fullscreen.
        let c = Candidate {
            has_caption: true,
            maximized: false,
            ..app_window(MON)
        };
        assert!(should_hide(true, Some(&c), MON));
    }

    #[test]
    fn shell_own_hidden_minimized_and_cloaked_windows_are_ignored() {
        for c in [
            Candidate {
                shell: true,
                ..app_window(MON)
            },
            Candidate {
                own: true,
                ..app_window(MON)
            },
            Candidate {
                visible: false,
                ..app_window(MON)
            },
            Candidate {
                minimized: true,
                ..app_window(MON)
            },
            Candidate {
                cloaked: true,
                ..app_window(MON)
            },
        ] {
            assert!(!should_hide(true, Some(&c), MON), "{c:?}");
        }
    }

    #[test]
    fn other_monitor_does_not_hide() {
        // Fullscreen on the second monitor, island on the first.
        let second = app_window((1920, 0, 3840, 1080));
        assert!(!should_hide(true, Some(&second), MON));
        // The island on the second monitor: now it hides.
        assert!(should_hide(true, Some(&second), (1920, 0, 3840, 1080)));
        // Monitors left of the origin work the same way.
        assert!(should_hide(
            true,
            Some(&app_window((-1920, -200, 0, 880))),
            (-1920, -200, 0, 880)
        ));
    }

    #[test]
    fn degenerate_monitor_rect_never_matches() {
        assert!(!covers((0, 0, 100, 100), (0, 0, 0, 0)));
        assert!(!covers((0, 0, 100, 100), (50, 50, 50, 80)));
    }

    #[test]
    fn shell_classes_are_recognised_case_insensitively() {
        for c in [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "shell_secondarytraywnd",
        ] {
            assert!(is_shell_class(c), "{c}");
        }
        for c in ["Notepad", "Chrome_WidgetWin_1", "", "UnrealWindow"] {
            assert!(!is_shell_class(c), "{c}");
        }
    }

    #[test]
    fn autohide_hides_over_maximized_or_top_edge_app_in_list() {
        let auto_hide = vec!["chrome.exe".to_string(), "msedge.exe".to_string()];
        let base_policy = HidePolicy {
            hide_in_fullscreen: true,
            fullscreen_allowlist: &[],
            auto_hide_apps: &auto_hide,
            summoned: false,
            dwell_revealed: false,
            monitor: MON,
            work_top: 0,
        };

        // Maximized browser on the island's monitor (with -8px invisible DWM border): hides.
        let max_chrome = Candidate {
            rect: (-8, -8, 1928, 1048),
            has_caption: true,
            maximized: true,
            exe: "Chrome.exe".to_string(),
            ..app_window((-8, -8, 1928, 1048))
        };
        assert!(is_maximized_or_top_edge(&max_chrome, MON, 0));
        assert_eq!(
            decide_visibility(&base_policy, Some(&max_chrome)),
            HideReason::AutoHide
        );

        // Non-maximized browser whose top edge coincides with work_top (e.g. snapped to top/half): hides.
        let top_edge_edge = Candidate {
            rect: (0, 0, 960, 1040),
            has_caption: true,
            maximized: false,
            exe: "msedge.exe".to_string(),
            ..app_window((0, 0, 960, 1040))
        };
        assert!(is_maximized_or_top_edge(&top_edge_edge, MON, 0));
        assert_eq!(
            decide_visibility(&base_policy, Some(&top_edge_edge)),
            HideReason::AutoHide
        );

        // Browser window below the top edge and not maximized: stays visible.
        let floating_chrome = Candidate {
            rect: (100, 80, 1400, 900),
            has_caption: true,
            maximized: false,
            exe: "chrome.exe".to_string(),
            ..app_window((100, 80, 1400, 900))
        };
        assert!(!is_maximized_or_top_edge(&floating_chrome, MON, 0));
        assert_eq!(
            decide_visibility(&base_policy, Some(&floating_chrome)),
            HideReason::Visible
        );

        // Maximized app NOT in autoHideApps: stays visible.
        let max_notepad = Candidate {
            exe: "notepad.exe".to_string(),
            ..max_chrome.clone()
        };
        assert_eq!(
            decide_visibility(&base_policy, Some(&max_notepad)),
            HideReason::Visible
        );

        // Maximized browser on another monitor: stays visible.
        let second_mon_chrome = Candidate {
            rect: (1920, 0, 3840, 1040),
            ..max_chrome.clone()
        };
        assert_eq!(
            decide_visibility(&base_policy, Some(&second_mon_chrome)),
            HideReason::Visible
        );

        // Summon or top-edge dwell reveals the island while auto-hide condition holds.
        let summoned_policy = HidePolicy {
            summoned: true,
            ..base_policy
        };
        assert_eq!(
            decide_visibility(&summoned_policy, Some(&max_chrome)),
            HideReason::Visible
        );

        let dwell_policy = HidePolicy {
            dwell_revealed: true,
            ..base_policy
        };
        assert_eq!(
            decide_visibility(&dwell_policy, Some(&max_chrome)),
            HideReason::Visible
        );
    }

    #[test]
    fn fullscreen_mode_has_priority_over_autohide() {
        let auto_hide = vec!["chrome.exe".to_string()];
        let fs_allow = vec!["chrome.exe".to_string()];

        // F11 fullscreen browser (covers monitor, not captioned+maximized).
        let fs_chrome = Candidate {
            rect: MON,
            has_caption: false,
            maximized: false,
            exe: "chrome.exe".to_string(),
            ..app_window(MON)
        };
        assert!(is_fullscreen(&fs_chrome, MON));
        assert!(!is_maximized_or_top_edge(&fs_chrome, MON, 0));

        // 1. Fullscreen with hideInFullscreen=true, not in fullscreenAllowlist: Fullscreen wins,
        //    and dwell_revealed does NOT override fullscreen hiding.
        let policy_fs_hide = HidePolicy {
            hide_in_fullscreen: true,
            fullscreen_allowlist: &[],
            auto_hide_apps: &auto_hide,
            summoned: false,
            dwell_revealed: true,
            monitor: MON,
            work_top: 0,
        };
        assert_eq!(
            decide_visibility(&policy_fs_hide, Some(&fs_chrome)),
            HideReason::Fullscreen
        );

        // 2. Fullscreen with chrome.exe in fullscreenAllowlist (§8): stays visible even though
        //    chrome.exe is in autoHideApps.
        let policy_fs_allowed = HidePolicy {
            hide_in_fullscreen: true,
            fullscreen_allowlist: &fs_allow,
            auto_hide_apps: &auto_hide,
            summoned: false,
            dwell_revealed: false,
            monitor: MON,
            work_top: 0,
        };
        assert_eq!(
            decide_visibility(&policy_fs_allowed, Some(&fs_chrome)),
            HideReason::Visible
        );

        // 3. Fullscreen with hideInFullscreen=false (§8): stays visible even though chrome.exe
        //    is in autoHideApps.
        let policy_fs_disabled = HidePolicy {
            hide_in_fullscreen: false,
            fullscreen_allowlist: &[],
            auto_hide_apps: &auto_hide,
            summoned: false,
            dwell_revealed: false,
            monitor: MON,
            work_top: 0,
        };
        assert_eq!(
            decide_visibility(&policy_fs_disabled, Some(&fs_chrome)),
            HideReason::Visible
        );
    }
}
