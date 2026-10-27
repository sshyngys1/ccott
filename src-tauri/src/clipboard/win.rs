//! Win32 side of the clipboard module: change listener, reading/writing the clipboard, tracking the
//! last external foreground window and the "paste into it" sequence. Owner: R2 (Rust-System).
//!
//! All unsafe code here is Win32 FFI; every block says why it is sound.

use std::ffi::c_void;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{
    CloseHandle, GlobalFree, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
    GetClipboardOwner, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::Win32::System::Ole::{CF_DIB, CF_DIBV5, CF_HDROP, CF_UNICODETEXT};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT,
    KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY, VK_CONTROL, VK_LCONTROL, VK_LSHIFT, VK_RCONTROL,
    VK_RSHIFT, VK_SHIFT,
};
use windows::Win32::UI::Shell::DragQueryFileW;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CreateWindowExW, DefWindowProcW, DispatchMessageW, GA_ROOT, GetAncestor,
    GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, HWND_MESSAGE,
    IsIconic, IsWindow, IsWindowVisible, MSG, RegisterClassW, SW_RESTORE, SetForegroundWindow,
    ShowWindow, TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WNDCLASSW,
};
use windows::core::{PCWSTR, PWSTR, w};

use super::image;
use super::store::ClipKind;

/// Raw content read from the clipboard (decoded/encoded later on the worker thread).
pub enum Raw {
    Text(String),
    Files(Vec<String>),
    /// Packed DIB (CF_DIBV5 / CF_DIB).
    Dib(Vec<u8>),
    /// "PNG" registered format (lossless, keeps alpha).
    Png(Vec<u8>),
}

pub struct Captured {
    pub raw: Raw,
    pub source_app: String,
}

/// Raw DIB bytes above this are ignored (≈ 4K screenshot); the encoded PNG is capped separately.
const MAX_RAW_IMAGE_BYTES: usize = 48 * 1024 * 1024;

static SENDER: OnceLock<Sender<Captured>> = OnceLock::new();
/// Clipboard sequence number right after our own last write (0 = none).
static SELF_SEQ: AtomicU32 = AtomicU32::new(0);
/// Sequence number of the last update we processed (drops duplicate messages).
static LAST_SEQ: AtomicU32 = AtomicU32::new(0);
/// Last foreground window that does not belong to our process.
static LAST_EXTERNAL_FG: AtomicIsize = AtomicIsize::new(0);
/// Our message-only listener window (owner for clipboard writes).
static LISTENER_HWND: AtomicIsize = AtomicIsize::new(0);

fn hwnd_from(v: isize) -> HWND {
    HWND(v as *mut c_void)
}

// ───────────────────────────── helpers ─────────────────────────────

/// Window classes that are never a sensible paste target (shell chrome, desktop, flyouts).
const SKIP_CLASSES: &[&str] = &[
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "XamlExplorerHostIslandWindow",
    "Progman",
    "WorkerW",
    "Windows.UI.Core.CoreWindow",
];

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    // SAFETY: `buf` is a valid writable buffer; an invalid hwnd only makes the call return 0.
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid out pointer; an invalid hwnd leaves it at 0.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// Executable file name (e.g. "Telegram.exe") of the process owning `hwnd`; "" when unknown.
fn exe_name_of_window(hwnd: HWND) -> String {
    if hwnd.0.is_null() {
        return String::new();
    }
    let pid = window_pid(hwnd);
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
        path.rsplit(['\\', '/']).next().unwrap_or("").to_string()
    }
}

#[derive(Clone, Copy, Default)]
struct PasteCandidate {
    alive: bool,
    root: bool,
    own: bool,
    shell: bool,
    visible: bool,
}

impl PasteCandidate {
    fn rememberable(self) -> bool {
        // EVENT_SYSTEM_FOREGROUND may arrive before the new window has WS_VISIBLE.
        self.alive && self.root && !self.own && !self.shell
    }

    fn pasteable(self) -> bool {
        self.rememberable() && self.visible
    }
}

fn inspect_candidate(hwnd: HWND) -> PasteCandidate {
    if hwnd.0.is_null() {
        return PasteCandidate::default();
    }
    let class = class_name(hwnd);
    // SAFETY: plain handle/process queries; stale HWNDs report failure. No pointers are dereferenced.
    unsafe {
        PasteCandidate {
            alive: IsWindow(Some(hwnd)).as_bool(),
            root: GetAncestor(hwnd, GA_ROOT) == hwnd,
            own: window_pid(hwnd) == GetCurrentProcessId(),
            shell: SKIP_CLASSES.iter().any(|c| c.eq_ignore_ascii_case(&class)),
            visible: IsWindowVisible(hwnd).as_bool(),
        }
    }
}

/// Revalidate at use time: an early foreground event is not permission to paste into a hidden window.
fn is_paste_target(hwnd: HWND) -> bool {
    inspect_candidate(hwnd).pasteable()
}

fn remember_foreground(hwnd: HWND) {
    let candidate = inspect_candidate(hwnd);
    if candidate.rememberable()
        && LAST_EXTERNAL_FG.swap(hwnd.0 as isize, Ordering::SeqCst) != hwnd.0 as isize
    {
        log::debug!(
            "clipboard: remembered foreground hwnd={:#x} pid={} class={} visible={}",
            hwnd.0 as isize,
            window_pid(hwnd),
            class_name(hwnd),
            candidate.visible
        );
    }
}

// ───────────────────────────── reading ─────────────────────────────

/// Opens the clipboard, retrying briefly (another process may hold it).
fn open_clipboard(owner: Option<HWND>) -> bool {
    for _ in 0..12 {
        // SAFETY: OpenClipboard has no pointer arguments; the owner window outlives the process.
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    false
}

fn format_id(name: PCWSTR) -> u32 {
    // SAFETY: `name` is a valid NUL-terminated wide string literal.
    unsafe { RegisterClipboardFormatW(name) }
}

/// Copies the bytes of a global-memory clipboard handle. Clipboard must be open.
unsafe fn read_global(handle: HANDLE) -> Option<Vec<u8>> {
    let h = HGLOBAL(handle.0);
    // SAFETY (caller + here): the handle came from GetClipboardData while the clipboard is open;
    // it stays locked only for the duration of the copy.
    unsafe {
        let size = GlobalSize(h);
        if size == 0 {
            return None;
        }
        let p = GlobalLock(h) as *const u8;
        if p.is_null() {
            return None;
        }
        let v = std::slice::from_raw_parts(p, size).to_vec();
        let _ = GlobalUnlock(h);
        Some(v)
    }
}

/// True if the clipboard content must not be recorded (password managers etc.). Clipboard open.
unsafe fn is_excluded() -> bool {
    // SAFETY: clipboard is open (caller); formats are queried by id only.
    unsafe {
        for name in [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("Clipboard Viewer Ignore"),
        ] {
            if IsClipboardFormatAvailable(format_id(name)).is_ok() {
                return true;
            }
        }
        let can_include = format_id(w!("CanIncludeInClipboardHistory"));
        if IsClipboardFormatAvailable(can_include).is_ok()
            && let Ok(h) = GetClipboardData(can_include)
            && let Some(b) = read_global(h)
            && b.len() >= 4
            && u32::from_le_bytes([b[0], b[1], b[2], b[3]]) == 0
        {
            return true;
        }
    }
    false
}

unsafe fn read_files() -> Option<Vec<String>> {
    // SAFETY: clipboard open (caller); the HDROP is only used while it stays open.
    unsafe {
        let h = GetClipboardData(CF_HDROP.0 as u32).ok()?;
        let drop = windows::Win32::UI::Shell::HDROP(h.0);
        let count = DragQueryFileW(drop, u32::MAX, None);
        let mut files = Vec::new();
        for i in 0..count {
            let len = DragQueryFileW(drop, i, None) as usize;
            let mut buf = vec![0u16; len + 1];
            let n = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
            if n > 0 {
                files.push(String::from_utf16_lossy(&buf[..n]));
            }
        }
        (!files.is_empty()).then_some(files)
    }
}

unsafe fn read_text() -> Option<String> {
    // SAFETY: clipboard open (caller).
    unsafe {
        let h = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
        let bytes = read_global(h)?;
        let wide: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .take_while(|&c| c != 0)
            .collect();
        Some(String::from_utf16_lossy(&wide))
    }
}

unsafe fn read_image() -> Option<Raw> {
    // SAFETY: clipboard open (caller).
    unsafe {
        let png_fmt = format_id(w!("PNG"));
        if IsClipboardFormatAvailable(png_fmt).is_ok()
            && let Ok(h) = GetClipboardData(png_fmt)
            && let Some(b) = read_global(h)
            && b.len() <= MAX_RAW_IMAGE_BYTES
            && b.starts_with(&[0x89, b'P', b'N', b'G'])
        {
            return Some(Raw::Png(b));
        }
        for fmt in [CF_DIBV5.0 as u32, CF_DIB.0 as u32] {
            if IsClipboardFormatAvailable(fmt).is_ok()
                && let Ok(h) = GetClipboardData(fmt)
            {
                let size = GlobalSize(HGLOBAL(h.0));
                if size > MAX_RAW_IMAGE_BYTES {
                    log::debug!("clipboard: image of {size} bytes skipped (too large)");
                    return None;
                }
                if let Some(b) = read_global(h) {
                    return Some(Raw::Dib(b));
                }
            }
        }
        None
    }
}

/// Reads the current clipboard content; `None` if empty, unsupported, excluded or unavailable.
fn read_clipboard(owner: HWND) -> Option<Raw> {
    if !open_clipboard(Some(owner)) {
        log::debug!("clipboard: cannot open, skipping update");
        return None;
    }
    // SAFETY: the clipboard is open for the whole block and closed right after it.
    let raw = unsafe {
        if is_excluded() {
            log::debug!("clipboard: content marked as excluded, ignored");
            None
        } else if let Some(files) = read_files() {
            Some(Raw::Files(files))
        } else if let Some(text) = read_text() {
            Some(Raw::Text(text))
        } else {
            read_image()
        }
    };
    // SAFETY: we opened the clipboard above.
    let _ = unsafe { CloseClipboard() };
    raw
}

// ───────────────────────────── listener thread ─────────────────────────────

fn on_clipboard_update(hwnd: HWND) {
    // SAFETY: no arguments.
    let seq = unsafe { GetClipboardSequenceNumber() };
    if seq == SELF_SEQ.load(Ordering::SeqCst) {
        return; // our own write (paste / copy from the history)
    }
    if LAST_SEQ.swap(seq, Ordering::SeqCst) == seq {
        return; // duplicate message
    }
    // Owner = app that put the data on the clipboard; foreground window as a fallback.
    // SAFETY: no arguments.
    let owner = unsafe { GetClipboardOwner() }.unwrap_or_default();
    let mut source_app = exe_name_of_window(owner);
    if source_app.is_empty() {
        // SAFETY: no arguments.
        source_app = exe_name_of_window(unsafe { GetForegroundWindow() });
    }
    let Some(raw) = read_clipboard(hwnd) else {
        return;
    };
    if let Some(tx) = SENDER.get() {
        let _ = tx.send(Captured { raw, source_app });
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        on_clipboard_update(hwnd);
        return LRESULT(0);
    }
    // SAFETY: forwarding the unhandled message with the original arguments.
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

unsafe extern "system" fn foreground_hook(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    remember_foreground(hwnd);
}

/// Runs the listener (message-only window + foreground hook) on the current thread forever.
pub fn run_listener(tx: Sender<Captured>) {
    let _ = SENDER.set(tx);
    // SAFETY: standard window-class/window creation and message loop on this dedicated thread;
    // the window and hook live until the process ends.
    unsafe {
        let Ok(hinst) = GetModuleHandleW(None) else {
            log::error!("clipboard: GetModuleHandleW failed");
            return;
        };
        let class = w!("IslandWinClipboardListener");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: class,
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            log::error!("clipboard: RegisterClassW failed");
            return;
        }
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinst.into()),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                log::error!("clipboard: CreateWindowExW failed: {e}");
                return;
            }
        };
        LISTENER_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
        if let Err(e) = AddClipboardFormatListener(hwnd) {
            log::error!("clipboard: AddClipboardFormatListener failed: {e}");
            return;
        }

        // Track the last foreground window outside our process (for "paste into it").
        remember_foreground(GetForegroundWindow());
        use windows::Win32::UI::WindowsAndMessaging::{
            EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
        };
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(foreground_hook),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.0.is_null() {
            log::warn!("clipboard: SetWinEventHook failed, paste target tracking disabled");
        }
        log::info!("clipboard: listener started");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

// ───────────────────────────── writing ─────────────────────────────

/// What to put on the clipboard.
pub enum Content {
    Text(String),
    Files(Vec<String>),
    /// PNG bytes of the image.
    Image(Vec<u8>),
}

impl Content {
    pub fn from_stored(kind: ClipKind, text: String, image: Option<Vec<u8>>) -> Option<Self> {
        match kind {
            ClipKind::Text | ClipKind::Link => Some(Content::Text(text)),
            ClipKind::Files => Some(Content::Files(
                text.lines()
                    .filter(|l| !l.is_empty())
                    .map(String::from)
                    .collect(),
            )),
            ClipKind::Image => image.map(Content::Image),
        }
    }
}

/// `DROPFILES` header + double-NUL-terminated wide file list (CF_HDROP payload).
pub fn build_hdrop(files: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&20u32.to_le_bytes()); // pFiles: offset to the list
    out.extend_from_slice(&[0u8; 8]); // pt
    out.extend_from_slice(&0u32.to_le_bytes()); // fNC
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide
    for f in files {
        for u in f.encode_utf16() {
            out.extend_from_slice(&u.to_le_bytes());
        }
        out.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(&[0, 0]);
    out
}

fn text_payload(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2 + 2);
    for u in text.encode_utf16() {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out.extend_from_slice(&[0, 0]);
    out
}

/// Puts `bytes` on the (open) clipboard as format `fmt`. Ownership of the memory passes to the system.
unsafe fn set_format(fmt: u32, bytes: &[u8]) -> Result<(), String> {
    // SAFETY: clipboard open (caller). The block is allocated, filled and locked by us; on success
    // the system owns it, on failure we free it.
    unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len().max(1))
            .map_err(|e| format!("GlobalAlloc: {e}"))?;
        let p = GlobalLock(h) as *mut u8;
        if p.is_null() {
            let _ = GlobalFree(Some(h));
            return Err("GlobalLock failed".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        let _ = GlobalUnlock(h);
        if let Err(e) = SetClipboardData(fmt, Some(HANDLE(h.0))) {
            let _ = GlobalFree(Some(h));
            return Err(format!("SetClipboardData: {e}"));
        }
    }
    Ok(())
}

/// Replaces the clipboard content with `content` and remembers the resulting sequence number so the
/// listener ignores this write.
pub fn set_clipboard(content: &Content) -> Result<(), String> {
    write_clipboard(content, true)
}
pub(super) fn write_capture(content: &Content) -> Result<(), String> {
    write_clipboard(content, false)
}
fn write_clipboard(content: &Content, ignore_echo: bool) -> Result<(), String> {
    // Prepare everything (decoding can be slow) before touching the clipboard.
    let prepared: Vec<(u32, Vec<u8>)> = match content {
        Content::Text(t) => vec![(CF_UNICODETEXT.0 as u32, text_payload(t))],
        Content::Files(f) => vec![(CF_HDROP.0 as u32, build_hdrop(f))],
        Content::Image(png) => {
            let img = image::decode_png(png).ok_or("cannot decode stored image")?;
            vec![
                (
                    CF_DIBV5.0 as u32,
                    image::rgba_to_dibv5(img.width, img.height, &img.pixels),
                ),
                (
                    CF_DIB.0 as u32,
                    image::rgba_to_dib(img.width, img.height, &img.pixels),
                ),
                (format_id(w!("PNG")), png.clone()),
            ]
        }
    };
    let owner = hwnd_from(LISTENER_HWND.load(Ordering::SeqCst));
    if !open_clipboard((!owner.0.is_null()).then_some(owner)) {
        return Err("clipboard is busy".into());
    }
    // SAFETY: the clipboard is open for the whole block and closed at the end.
    unsafe {
        let r = EmptyClipboard().map_err(|e| format!("EmptyClipboard: {e}"));
        let r = r.and_then(|()| {
            prepared
                .iter()
                .try_for_each(|(fmt, bytes)| set_format(*fmt, bytes))
        });
        // Taken while we still own the clipboard, so nobody can slip in between.
        if ignore_echo {
            SELF_SEQ.store(GetClipboardSequenceNumber(), Ordering::SeqCst);
        }
        let _ = CloseClipboard();
        r
    }
}

// ───────────────────────────── paste ─────────────────────────────

fn foreground() -> HWND {
    // SAFETY: no arguments.
    unsafe { GetForegroundWindow() }
}

fn wait_foreground(target: HWND, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if foreground() == target {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn check_sent(sent: u32, expected: usize) -> Result<(), String> {
    if sent as usize == expected {
        Ok(())
    } else {
        Err("cannot send keys to the target window".into())
    }
}

fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
    // SAFETY: `inputs` is a valid slice of fully initialised INPUT structs.
    let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    check_sent(sent, inputs.len())
}

/// Makes `target` the foreground window, working around the foreground lock. Returns success.
fn bring_to_foreground(target: HWND) -> bool {
    // SAFETY: Win32 window calls on a handle that may have become stale (they then just fail).
    unsafe {
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        if foreground() == target {
            return true;
        }
        // 1) Plain attempt: usually allowed because the user just clicked in our process.
        let _ = SetForegroundWindow(target);
        if wait_foreground(target, Duration::from_millis(150)) {
            return true;
        }
        // 2) Attach our input queue to the current foreground thread (lifts the foreground lock).
        let fg = foreground();
        let fg_thread = if fg.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };
        let cur_thread = GetCurrentThreadId();
        let attached = fg_thread != 0
            && fg_thread != cur_thread
            && AttachThreadInput(cur_thread, fg_thread, true).as_bool();
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        if attached {
            let _ = AttachThreadInput(cur_thread, fg_thread, false);
        }
        // Never inject ALT into whichever application currently owns the foreground.
        wait_foreground(target, Duration::from_millis(300))
    }
}

/// Releases modifier keys that are physically held (e.g. Shift from Shift+click) so they do not
/// turn our Ctrl+V into Ctrl+Shift+V.
fn release_held_modifiers() -> Result<(), String> {
    let mods = [
        VK_SHIFT,
        VK_LSHIFT,
        VK_RSHIFT,
        VK_CONTROL,
        VK_LCONTROL,
        VK_RCONTROL,
    ];
    let ups: Vec<INPUT> = mods
        .iter()
        // SAFETY: GetAsyncKeyState only reads key state.
        .filter(|vk| unsafe { GetAsyncKeyState(i32::from(vk.0)) } as u16 & 0x8000 != 0)
        .map(|vk| key_input(*vk, true))
        .collect();
    if !ups.is_empty() {
        send_inputs(&ups)?;
        std::thread::sleep(Duration::from_millis(15));
    }
    Ok(())
}

/// Brings the last external window to the front and sends Ctrl+V to it.
pub fn paste_into_last_window() -> Result<(), String> {
    let current = foreground();
    // The shell normally restored the foreground before this command. Sampling it also recovers
    // from late/missed WinEvents, without ever preferring a stale cached app over the current app.
    let target = if is_paste_target(current) {
        remember_foreground(current);
        current
    } else {
        hwnd_from(LAST_EXTERNAL_FG.load(Ordering::SeqCst))
    };
    if !is_paste_target(target) {
        return Err("no window to paste into".into());
    }
    log::debug!("clipboard: pasting into {}", exe_name_of_window(target));
    if !bring_to_foreground(target) {
        return Err("cannot bring the target window to the foreground".into());
    }
    // Let the target process the activation and restore its focus before keys arrive.
    std::thread::sleep(Duration::from_millis(60));
    if foreground() != target {
        return Err("cannot bring the target window to the foreground".into());
    }
    release_held_modifiers()?;
    let ctrl_v = [
        key_input(VK_CONTROL, false),
        key_input(VIRTUAL_KEY(b'V' as u16), false),
        key_input(VIRTUAL_KEY(b'V' as u16), true),
        key_input(VK_CONTROL, true),
    ];
    if foreground() != target {
        return Err("cannot bring the target window to the foreground".into());
    }
    send_inputs(&ctrl_v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn early_foreground_event_is_remembered_but_hidden_window_is_not_pasteable() {
        let early = PasteCandidate {
            alive: true,
            root: true,
            ..Default::default()
        };
        assert!(early.rememberable());
        assert!(!early.pasteable());
        assert!(
            PasteCandidate {
                visible: true,
                ..early
            }
            .pasteable()
        );
        for invalid in [
            PasteCandidate {
                alive: false,
                ..early
            },
            PasteCandidate {
                root: false,
                ..early
            },
            PasteCandidate { own: true, ..early },
            PasteCandidate {
                shell: true,
                ..early
            },
        ] {
            assert!(!invalid.rememberable());
            assert!(
                !PasteCandidate {
                    visible: true,
                    ..invalid
                }
                .pasteable()
            );
        }
    }

    #[test]
    fn partial_or_blocked_key_injection_is_an_error() {
        assert!(check_sent(4, 4).is_ok());
        for sent in [0, 1, 2, 3] {
            assert_eq!(
                check_sent(sent, 4).unwrap_err(),
                "cannot send keys to the target window"
            );
        }
    }

    #[test]
    fn hdrop_layout() {
        let b = build_hdrop(&["C:\\a.txt".to_string(), "D:\\b".to_string()]);
        assert_eq!(&b[0..4], &20u32.to_le_bytes());
        assert_eq!(&b[16..20], &1u32.to_le_bytes()); // fWide
        let wide: Vec<u16> = b[20..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        let s = String::from_utf16(&wide).unwrap();
        assert_eq!(s, "C:\\a.txt\0D:\\b\0\0");
    }

    #[test]
    fn text_payload_is_nul_terminated_utf16() {
        let p = text_payload("hi");
        assert_eq!(p, vec![b'h', 0, b'i', 0, 0, 0]);
    }

    #[test]
    fn content_from_stored() {
        assert!(matches!(
            Content::from_stored(ClipKind::Link, "x".into(), None),
            Some(Content::Text(_))
        ));
        match Content::from_stored(ClipKind::Files, "a\nb\n".into(), None) {
            Some(Content::Files(f)) => assert_eq!(f, ["a", "b"]),
            _ => panic!(),
        }
        assert!(Content::from_stored(ClipKind::Image, String::new(), None).is_none());
    }
}
