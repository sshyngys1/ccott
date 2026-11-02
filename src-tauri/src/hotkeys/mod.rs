//! Global summon shortcut (`Settings::summonHotkey`) via `tauri-plugin-global-shortcut`.
//! Owner: R1 (Rust-Shell). Contract: `docs/contracts.md` section 8.
//!
//! Pressing the shortcut shows the island (even over a fullscreen app that is not in the allowlist),
//! reasserts `HWND_TOPMOST` without stealing focus, and emits `island://summoned`.

use std::str::FromStr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const DEFAULT_SUMMON_HOTKEY: &str = "Ctrl+Alt+I";
pub const DEFAULT_COMMAND_HOTKEY: &str = "Ctrl+Alt+Space";
pub const COMMAND_HOTKEY_FALLBACKS: &[&str] =
    &["Ctrl+Shift+Space", "Alt+Shift+Space", "Ctrl+Alt+K"];

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyRegState {
    Ok,
    Busy,
    #[default]
    Off,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    summon: HotkeyRegState,
    command: HotkeyRegState,
    command_fallback_from: Option<String>,
}

#[derive(Default)]
struct Registered {
    summon: Option<Shortcut>,
    command: Option<Shortcut>,
    configured_summon: String,
    configured_command: String,
    status: HotkeyStatus,
}

#[derive(Default)]
pub struct HotkeyState {
    registered: Mutex<Registered>,
    // Event handlers must not wait on the registration lock: register/unregister round-trip
    // through the main thread. Zero means disabled; id + 1 represents every possible u32 ID.
    command_id: AtomicU64,
    summon_id: AtomicU64,
    escape: Mutex<EscapeShortcutState>,
}

pub fn escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// Pure state machine for the temporary global `Escape` shortcut (contract §14).
///
/// While the island is expanded via `summonHotkey` (`summoned_open`) and does not hold native
/// keyboard focus (`!keyboard_focus`), `Escape` is registered globally so the user can dismiss
/// the non-activating island without stealing focus from the foreground app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EscapeShortcutState {
    summoned_open: bool,
    keyboard_focus: bool,
    registered: bool,
}

impl Default for EscapeShortcutState {
    fn default() -> Self {
        Self::new()
    }
}

impl EscapeShortcutState {
    pub const fn new() -> Self {
        Self {
            summoned_open: false,
            keyboard_focus: false,
            registered: false,
        }
    }

    #[cfg(test)]
    pub fn is_registered(&self) -> bool {
        self.registered
    }

    #[cfg(test)]
    pub fn is_summoned_open(&self) -> bool {
        self.summoned_open
    }

    fn sync<B: ShortcutBackend>(&mut self, backend: &mut B) {
        let wanted = self.summoned_open && !self.keyboard_focus;
        let esc = escape_shortcut();
        match (self.registered, wanted) {
            (false, true) => match backend.register(esc) {
                Ok(()) => {
                    self.registered = true;
                    log::debug!("hotkeys: temporary Escape registered");
                }
                Err(e) => {
                    log::warn!("hotkeys: cannot register temporary Escape: {e}");
                }
            },
            (true, false) => {
                if let Err(e) = backend.unregister(esc) {
                    log::warn!("hotkeys: failed to unregister temporary Escape: {e}");
                }
                self.registered = false;
                log::debug!("hotkeys: temporary Escape unregistered");
            }
            _ => {}
        }
    }

    /// The island was opened via `summonHotkey`.
    pub fn on_summoned<B: ShortcutBackend>(&mut self, backend: &mut B) {
        self.summoned_open = true;
        self.sync(backend);
    }

    /// The island collapsed (any cause: Esc, repeat hotkey, hover leave, collapse button).
    pub fn on_collapsed<B: ShortcutBackend>(&mut self, backend: &mut B) {
        self.summoned_open = false;
        self.sync(backend);
    }

    /// Native keyboard focus of the island changed. Acquiring focus unregisters global `Escape`
    /// so normal WebView `Escape` handling (contract §3a) takes over.
    pub fn on_focus_changed<B: ShortcutBackend>(&mut self, backend: &mut B, focused: bool) {
        self.keyboard_focus = focused;
        if focused {
            self.summoned_open = false;
        }
        self.sync(backend);
    }

    /// Application exit / window destruction.
    pub fn on_exit<B: ShortcutBackend>(&mut self, backend: &mut B) {
        self.summoned_open = false;
        self.keyboard_focus = false;
        self.sync(backend);
    }
}

/// Result of parsing and validating a hotkey string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedHotkey {
    /// Canonical Tauri accelerator string (e.g. `"Ctrl+Alt+Space"`, or `""` when disabled).
    pub canonical: String,
    /// Parsed shortcut (`None` when disabled with `""`).
    pub shortcut: Option<Shortcut>,
}

/// Abstraction over global shortcut registration so state transitions and rollback on failure can
/// be unit-tested without a live OS event loop.
pub trait ShortcutBackend {
    fn register(&mut self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String>;
}

struct TauriShortcutBackend<'a, R: Runtime> {
    app: &'a AppHandle<R>,
}

impl<R: Runtime> ShortcutBackend for TauriShortcutBackend<'_, R> {
    fn register(&mut self, shortcut: Shortcut) -> Result<(), String> {
        self.app
            .global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())
    }

    fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String> {
        self.app
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|e| e.to_string())
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if *shortcut == escape_shortcut() {
                    crate::window::collapse_summoned_for_runtime(app);
                } else if app.try_state::<HotkeyState>().is_some_and(|state| {
                    state.command_id.load(Ordering::Acquire) == u64::from(shortcut.id()) + 1
                }) {
                    crate::window::open_command_for_runtime(app);
                } else if app.try_state::<HotkeyState>().is_some_and(|state| {
                    state.summon_id.load(Ordering::Acquire) == u64::from(shortcut.id()) + 1
                }) {
                    crate::window::summon_for_runtime(app);
                }
            }
        })
        .build()
}

/// Registers temporary `Escape` when the island is opened by `summonHotkey` (if not focused).
pub fn on_summoned(app: &AppHandle) {
    let Some(state) = app.try_state::<HotkeyState>() else {
        return;
    };
    let mut esc = state.escape.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    esc.on_summoned(&mut backend);
}

/// Unregisters temporary `Escape` when the island collapses.
pub fn on_collapsed(app: &AppHandle) {
    let Some(state) = app.try_state::<HotkeyState>() else {
        return;
    };
    let mut esc = state.escape.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    esc.on_collapsed(&mut backend);
}

/// Updates keyboard-focus state and unregisters temporary `Escape` when the island takes focus.
pub fn on_focus_changed(app: &AppHandle, focused: bool) {
    let Some(state) = app.try_state::<HotkeyState>() else {
        return;
    };
    let mut esc = state.escape.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    esc.on_focus_changed(&mut backend, focused);
}

/// Unregisters temporary `Escape` on application exit.
pub fn on_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<HotkeyState>() else {
        return;
    };
    let mut esc = state.escape.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    esc.on_exit(&mut backend);
}

/// Registers both startup shortcuts independently after settings/window setup. Only the default
/// command shortcut can fall back; busy custom shortcuts remain configured and report `busy`.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(HotkeyState::default());
    let settings = crate::settings::current(app.handle());
    let state = app.state::<HotkeyState>();
    let mut current = state.registered.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app: app.handle() };
    register_startup(
        &mut backend,
        &mut current,
        &settings.summon_hotkey,
        &settings.command_hotkey,
    );
    sync_ids(&state, &current);
    let command = current.configured_command.clone();
    let status = current.status.clone();
    drop(current);
    if status.command_fallback_from.is_some()
        && let Err(error) = crate::settings::save_startup_command(app.handle(), &command)
    {
        log::error!("hotkeys: fallback is active only for this session: {error}");
    }
    let _ = app.emit("hotkeys://status", status);
    Ok(())
}

fn registration_status(configured: &str, registered: Option<Shortcut>) -> HotkeyRegState {
    if configured.is_empty() {
        HotkeyRegState::Off
    } else if registered.is_some() {
        HotkeyRegState::Ok
    } else {
        HotkeyRegState::Busy
    }
}

/// Startup is deliberately independent: a busy summon cannot block command registration.
fn register_startup<B: ShortcutBackend>(
    backend: &mut B,
    current: &mut Registered,
    summon: &str,
    command: &str,
) {
    if let Err(error) = switch_pair(backend, current, summon, "") {
        log::warn!("hotkeys: startup summon: {error}");
    }
    let active_summon = if current.summon.is_some() { summon } else { "" };
    if let Err(error) = switch_pair(backend, current, active_summon, command) {
        log::warn!("hotkeys: startup command: {error}");
        if command == DEFAULT_COMMAND_HOTKEY {
            for candidate in COMMAND_HOTKEY_FALLBACKS {
                if switch_pair(backend, current, active_summon, candidate).is_ok() {
                    current.status.command_fallback_from = Some(command.into());
                    current.configured_command = (*candidate).into();
                    break;
                }
            }
        }
    }
    current.configured_summon = summon.into();
    if current.status.command_fallback_from.is_none() {
        current.configured_command = command.into();
    }
    current.status.summon = registration_status(summon, current.summon);
    current.status.command = registration_status(command, current.command);
}

#[tauri::command]
// Keep this off the main thread: registration holds the mutex while round-tripping to that thread.
pub async fn hotkeys_status(state: tauri::State<'_, HotkeyState>) -> Result<HotkeyStatus, String> {
    Ok(state
        .registered
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .status
        .clone())
}

pub fn emit_status(app: &AppHandle) {
    let state = app.state::<HotkeyState>();
    let status = state
        .registered
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .status
        .clone();
    let _ = app.emit("hotkeys://status", status);
}

/// Applies both shortcuts atomically. Register additions before removing old shortcuts,
/// so a conflict preserves the previous pair and settings patch can be rejected before saving.
pub fn apply_pair(
    app: &AppHandle,
    summon: &str,
    command: &str,
) -> Result<(String, String), String> {
    let state = app.state::<HotkeyState>();
    let mut current = state.registered.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    let result = apply_configured_pair(&mut backend, &mut current, summon, command)?;
    sync_ids(&state, &current);
    Ok(result)
}

fn sync_ids(state: &HotkeyState, current: &Registered) {
    state.command_id.store(
        current.command.map_or(0, |s| u64::from(s.id()) + 1),
        Ordering::Release,
    );
    state.summon_id.store(
        current.summon.map_or(0, |s| u64::from(s.id()) + 1),
        Ordering::Release,
    );
}

/// An unchanged busy setting remains busy; it must not veto changing the other shortcut.
/// `switch_pair` still registers all actual additions atomically before removing anything.
fn apply_configured_pair<B: ShortcutBackend>(
    backend: &mut B,
    current: &mut Registered,
    summon: &str,
    command: &str,
) -> Result<(String, String), String> {
    let summon = parse_hotkey(summon)?;
    let command = parse_hotkey(command)?;
    if summon.shortcut.is_some() && summon.shortcut == command.shortcut {
        return Err("Command and summon shortcuts must be different.".into());
    }
    let keep_summon_busy =
        current.summon.is_none() && summon.canonical == current.configured_summon;
    let keep_command_busy =
        current.command.is_none() && command.canonical == current.configured_command;
    switch_pair(
        backend,
        current,
        if keep_summon_busy {
            ""
        } else {
            &summon.canonical
        },
        if keep_command_busy {
            ""
        } else {
            &command.canonical
        },
    )?;
    if command.canonical != current.configured_command {
        current.status.command_fallback_from = None;
    }
    current.status.summon = registration_status(&summon.canonical, current.summon);
    current.status.command = registration_status(&command.canonical, current.command);
    current.configured_summon = summon.canonical.clone();
    current.configured_command = command.canonical.clone();
    Ok((summon.canonical, command.canonical))
}

fn switch_pair<B: ShortcutBackend>(
    backend: &mut B,
    current: &mut Registered,
    summon: &str,
    command: &str,
) -> Result<(String, String), String> {
    let summon = parse_hotkey(summon)?;
    let command = parse_hotkey(command)?;
    if summon.shortcut.is_some() && summon.shortcut == command.shortcut {
        return Err("Command and summon shortcuts must be different.".into());
    }
    let old: Vec<_> = [current.summon, current.command]
        .into_iter()
        .flatten()
        .collect();
    let new: Vec<_> = [summon.shortcut, command.shortcut]
        .into_iter()
        .flatten()
        .collect();
    let mut added = Vec::new();
    for shortcut in new.iter().filter(|s| !old.contains(s)) {
        if backend.register(*shortcut).is_err() {
            for added in added {
                let _ = backend.unregister(added);
            }
            return Err(format!(
                "Сочетание клавиш «{}» уже занято другим приложением или системой",
                format_shortcut(shortcut.mods, shortcut.key)
            ));
        }
        added.push(*shortcut);
    }
    let mut removed = Vec::new();
    for shortcut in old.iter().filter(|s| !new.contains(s)) {
        if let Err(error) = backend.unregister(*shortcut) {
            for removed in removed {
                let _ = backend.register(removed);
            }
            for added in added {
                let _ = backend.unregister(added);
            }
            return Err(format!("Could not update global shortcuts: {error}"));
        }
        removed.push(*shortcut);
    }
    current.summon = summon.shortcut;
    current.command = command.shortcut;
    Ok((summon.canonical, command.canonical))
}

// Compatibility helper for the single-shortcut transition tests; exercises the production pair logic.
#[cfg(test)]
fn switch_shortcut<B: ShortcutBackend>(
    backend: &mut B,
    current: &mut Option<Shortcut>,
    wanted: &str,
) -> Result<String, String> {
    let mut pair = Registered {
        summon: *current,
        command: None,
        ..Registered::default()
    };
    let result = switch_pair(backend, &mut pair, wanted, "");
    *current = pair.summon;
    result.map(|(summon, _)| summon)
}

/// Parses and validates an accelerator string (`""` = disabled). Requires at least one modifier
/// (`Ctrl`, `Alt`, `Shift`, `Super`/`Win`) and exactly one main key.
pub fn parse_hotkey(input: &str) -> Result<ParsedHotkey, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(ParsedHotkey {
            canonical: String::new(),
            shortcut: None,
        });
    }

    let mut mods = Modifiers::empty();
    let mut key: Option<Code> = None;

    for raw in trimmed.split('+') {
        let token = raw.trim();
        if token.is_empty() {
            return Err(format!("Некорректное сочетание клавиш «{trimmed}»"));
        }
        if key.is_some() {
            return Err(format!(
                "Некорректное сочетание клавиш «{trimmed}»: укажите модификаторы перед основной клавишей"
            ));
        }

        match token.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" | "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL"
            | "CMDORCONTROL" => {
                mods |= Modifiers::CONTROL;
            }
            "ALT" | "OPTION" => {
                mods |= Modifiers::ALT;
            }
            "SHIFT" => {
                mods |= Modifiers::SHIFT;
            }
            "SUPER" | "WIN" | "META" | "CMD" | "COMMAND" => {
                mods |= Modifiers::SUPER;
            }
            _ => {
                let code = parse_key_code(token).ok_or_else(|| {
                    format!("Неизвестная клавиша «{token}» в сочетании «{trimmed}»")
                })?;
                key = Some(code);
            }
        }
    }

    let Some(code) = key else {
        return Err(format!(
            "Некорректное сочетание клавиш «{trimmed}»: укажите основную клавишу"
        ));
    };

    if mods.is_empty() {
        return Err(format!(
            "Сочетание клавиш «{trimmed}» должно содержать модификатор (Ctrl, Alt, Shift или Win)"
        ));
    }

    let shortcut = Shortcut::new(Some(mods), code);
    let canonical = format_shortcut(mods, code);
    Ok(ParsedHotkey {
        canonical,
        shortcut: Some(shortcut),
    })
}

fn parse_key_code(token: &str) -> Option<Code> {
    match token.to_ascii_uppercase().as_str() {
        "SPACEBAR" => return Some(Code::Space),
        "RETURN" => return Some(Code::Enter),
        "DEL" => return Some(Code::Delete),
        "INS" => return Some(Code::Insert),
        "PGUP" => return Some(Code::PageUp),
        "PGDN" | "PGDOWN" => return Some(Code::PageDown),
        "PLUS" => return Some(Code::Equal),
        _ => {}
    }
    Shortcut::from_str(&format!("Ctrl+{token}"))
        .ok()
        .map(|s| s.key)
}

/// Formats modifiers + key code into canonical Tauri accelerator syntax (e.g. `"Ctrl+Alt+Space"`).
pub fn format_shortcut(mods: Modifiers, code: Code) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(5);
    if mods.contains(Modifiers::CONTROL) {
        parts.push("Ctrl".to_string());
    }
    if mods.contains(Modifiers::ALT) {
        parts.push("Alt".to_string());
    }
    if mods.contains(Modifiers::SHIFT) {
        parts.push("Shift".to_string());
    }
    if mods.contains(Modifiers::SUPER) {
        parts.push("Super".to_string());
    }
    parts.push(format_key_code(code));
    parts.join("+")
}

fn format_key_code(code: Code) -> String {
    match code {
        Code::Backquote => "`".to_string(),
        Code::Minus => "-".to_string(),
        Code::Equal => "=".to_string(),
        Code::BracketLeft => "[".to_string(),
        Code::BracketRight => "]".to_string(),
        Code::Backslash => "\\".to_string(),
        Code::Semicolon => ";".to_string(),
        Code::Quote => "'".to_string(),
        Code::Comma => ",".to_string(),
        Code::Period => ".".to_string(),
        Code::Slash => "/".to_string(),
        other => {
            let s = other.to_string();
            if let Some(letter) = s.strip_prefix("Key")
                && letter.len() == 1
            {
                return letter.to_string();
            }
            if let Some(digit) = s.strip_prefix("Digit")
                && digit.len() == 1
            {
                return digit.to_string();
            }
            s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[derive(Default)]
    struct FakeBackend {
        registered: HashSet<Shortcut>,
        occupied_externally: HashSet<Shortcut>,
    }

    impl ShortcutBackend for FakeBackend {
        fn register(&mut self, shortcut: Shortcut) -> Result<(), String> {
            if self.occupied_externally.contains(&shortcut) || self.registered.contains(&shortcut) {
                return Err("already registered".to_string());
            }
            self.registered.insert(shortcut);
            Ok(())
        }

        fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String> {
            self.registered.remove(&shortcut);
            Ok(())
        }
    }

    fn occupied(shortcuts: &[&str]) -> FakeBackend {
        FakeBackend {
            occupied_externally: shortcuts
                .iter()
                .map(|s| parse_hotkey(s).unwrap().shortcut.unwrap())
                .collect(),
            ..FakeBackend::default()
        }
    }

    #[test]
    fn startup_default_uses_first_free_fallback_in_order() {
        for (busy, expected) in [
            (vec![DEFAULT_COMMAND_HOTKEY], COMMAND_HOTKEY_FALLBACKS[0]),
            (
                vec![DEFAULT_COMMAND_HOTKEY, COMMAND_HOTKEY_FALLBACKS[0]],
                COMMAND_HOTKEY_FALLBACKS[1],
            ),
            (
                vec![
                    DEFAULT_COMMAND_HOTKEY,
                    COMMAND_HOTKEY_FALLBACKS[0],
                    COMMAND_HOTKEY_FALLBACKS[1],
                ],
                COMMAND_HOTKEY_FALLBACKS[2],
            ),
        ] {
            let mut backend = occupied(&busy);
            let mut current = Registered::default();
            register_startup(
                &mut backend,
                &mut current,
                DEFAULT_SUMMON_HOTKEY,
                DEFAULT_COMMAND_HOTKEY,
            );
            assert_eq!(current.configured_command, expected);
            assert_eq!(current.command, parse_hotkey(expected).unwrap().shortcut);
            assert_eq!(current.status.command, HotkeyRegState::Ok);
            assert_eq!(
                current.status.command_fallback_from.as_deref(),
                Some(DEFAULT_COMMAND_HOTKEY)
            );
            assert_eq!(backend.registered.len(), 2);
        }
    }

    #[test]
    fn startup_all_busy_preserves_default_and_reports_busy() {
        let mut busy = vec![DEFAULT_COMMAND_HOTKEY];
        busy.extend_from_slice(COMMAND_HOTKEY_FALLBACKS);
        let mut backend = occupied(&busy);
        let mut current = Registered::default();
        register_startup(
            &mut backend,
            &mut current,
            DEFAULT_SUMMON_HOTKEY,
            DEFAULT_COMMAND_HOTKEY,
        );
        assert_eq!(current.configured_command, DEFAULT_COMMAND_HOTKEY);
        assert_eq!(current.status.command, HotkeyRegState::Busy);
        assert_eq!(current.status.summon, HotkeyRegState::Ok);
        assert_eq!(current.status.command_fallback_from, None);
        assert_eq!(backend.registered.len(), 1);
    }

    #[test]
    fn startup_custom_busy_is_never_replaced() {
        let mut backend = occupied(&["Ctrl+Shift+X"]);
        let mut current = Registered::default();
        register_startup(&mut backend, &mut current, "", "Ctrl+Shift+X");
        assert_eq!(current.configured_command, "Ctrl+Shift+X");
        assert_eq!(current.status.command, HotkeyRegState::Busy);
        assert_eq!(current.status.summon, HotkeyRegState::Off);
        assert_eq!(current.status.command_fallback_from, None);
        assert!(backend.registered.is_empty());
    }

    #[test]
    fn startup_busy_summon_does_not_block_command_or_steal_a_fallback() {
        let mut backend = occupied(&[DEFAULT_SUMMON_HOTKEY]);
        let mut current = Registered::default();
        register_startup(
            &mut backend,
            &mut current,
            DEFAULT_SUMMON_HOTKEY,
            DEFAULT_COMMAND_HOTKEY,
        );
        assert_eq!(current.status.summon, HotkeyRegState::Busy);
        assert_eq!(current.status.command, HotkeyRegState::Ok);
        assert_eq!(current.configured_summon, DEFAULT_SUMMON_HOTKEY);

        let mut backend = occupied(&[DEFAULT_COMMAND_HOTKEY]);
        let mut current = Registered::default();
        register_startup(
            &mut backend,
            &mut current,
            COMMAND_HOTKEY_FALLBACKS[0],
            DEFAULT_COMMAND_HOTKEY,
        );
        assert_eq!(current.configured_command, COMMAND_HOTKEY_FALLBACKS[1]);
    }

    #[test]
    fn settings_hotkey_transition_retains_busy_other_and_rejects_atomically() {
        for busy_command in [false, true] {
            let mut settings = crate::settings::Settings::default();
            if busy_command {
                settings.command_hotkey = "Ctrl+Shift+X".into();
            }
            let busy = if busy_command {
                settings.command_hotkey.clone()
            } else {
                settings.summon_hotkey.clone()
            };
            let mut backend = occupied(&[&busy, "Ctrl+Alt+Z"]);
            let mut current = Registered::default();
            register_startup(
                &mut backend,
                &mut current,
                &settings.summon_hotkey,
                &settings.command_hotkey,
            );
            let patch = if busy_command {
                serde_json::json!({"summonHotkey": "Ctrl+Alt+K"})
            } else {
                serde_json::json!({"commandHotkey": "Ctrl+Alt+K"})
            };
            assert!(settings.merge_json(&patch).is_empty());
            apply_configured_pair(
                &mut backend,
                &mut current,
                &settings.summon_hotkey,
                &settings.command_hotkey,
            )
            .unwrap();
            let status = current.status.clone();
            assert_eq!(
                status.command,
                if busy_command {
                    HotkeyRegState::Busy
                } else {
                    HotkeyRegState::Ok
                }
            );
            assert_eq!(
                status.summon,
                if busy_command {
                    HotkeyRegState::Ok
                } else {
                    HotkeyRegState::Busy
                }
            );
            let registered = backend.registered.clone();
            assert!(
                apply_configured_pair(&mut backend, &mut current, "Ctrl+Alt+Z", "Ctrl+Shift+K")
                    .is_err()
            );
            assert_eq!(current.status, status);
            assert_eq!(backend.registered, registered);
            apply_configured_pair(&mut backend, &mut current, "", "").unwrap();
            assert_eq!(current.status, HotkeyStatus::default());
        }
    }

    #[test]
    fn fallback_marker_survives_summon_change_and_clears_on_command_change() {
        let mut backend = occupied(&[DEFAULT_COMMAND_HOTKEY]);
        let mut current = Registered::default();
        register_startup(
            &mut backend,
            &mut current,
            DEFAULT_SUMMON_HOTKEY,
            DEFAULT_COMMAND_HOTKEY,
        );
        let command = current.configured_command.clone();
        apply_configured_pair(&mut backend, &mut current, "Ctrl+Alt+K", &command).unwrap();
        assert_eq!(
            serde_json::to_value(&current.status).unwrap(),
            serde_json::json!({
                "summon": "ok", "command": "ok", "commandFallbackFrom": DEFAULT_COMMAND_HOTKEY
            })
        );
        apply_configured_pair(&mut backend, &mut current, "Ctrl+Alt+K", "Ctrl+Shift+X").unwrap();
        assert_eq!(current.status.command_fallback_from, None);
        let status = current.status.clone();
        assert!(
            apply_configured_pair(
                &mut backend,
                &mut current,
                "Ctrl+Alt+K",
                DEFAULT_COMMAND_HOTKEY
            )
            .is_err()
        );
        assert!(apply_configured_pair(&mut backend, &mut current, "Ctrl+Alt+K", "Space").is_err());
        assert_eq!(current.status, status);
    }

    #[test]
    fn command_and_summon_pair_is_atomic_on_conflict_and_can_swap() {
        let mut backend = FakeBackend::default();
        let mut current = Registered::default();
        switch_pair(
            &mut backend,
            &mut current,
            DEFAULT_SUMMON_HOTKEY,
            DEFAULT_COMMAND_HOTKEY,
        )
        .unwrap();
        let original = (current.summon, current.command);
        let busy = parse_hotkey("Ctrl+Shift+X").unwrap().shortcut.unwrap();
        backend.occupied_externally.insert(busy);
        assert!(switch_pair(&mut backend, &mut current, "Ctrl+Alt+K", "Ctrl+Shift+X").is_err());
        assert_eq!((current.summon, current.command), original);
        assert_eq!(backend.registered.len(), 2);
        assert!(backend.registered.contains(&original.0.unwrap()));
        assert!(backend.registered.contains(&original.1.unwrap()));
        assert!(switch_pair(&mut backend, &mut current, "Ctrl+Alt+I", "ctrl+alt+i").is_err());
        assert!(switch_pair(&mut backend, &mut current, DEFAULT_SUMMON_HOTKEY, "Space").is_err());
        assert_eq!((current.summon, current.command), original);
        switch_pair(
            &mut backend,
            &mut current,
            DEFAULT_COMMAND_HOTKEY,
            DEFAULT_SUMMON_HOTKEY,
        )
        .unwrap();
        assert_eq!((current.summon, current.command), (original.1, original.0));
        switch_pair(&mut backend, &mut current, DEFAULT_COMMAND_HOTKEY, "").unwrap();
        assert!(current.command.is_none());
        assert_eq!(backend.registered.len(), 1);
    }

    #[test]
    fn parses_and_normalizes_valid_shortcuts() {
        let p = parse_hotkey("Ctrl+Alt+Space").unwrap();
        assert_eq!(p.canonical, "Ctrl+Alt+Space");
        assert_eq!(
            p.shortcut,
            Some(Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::Space
            ))
        );

        let p2 = parse_hotkey("  shift + ctrl + keyk ").unwrap();
        assert_eq!(p2.canonical, "Ctrl+Shift+K");

        let p3 = parse_hotkey("Win+Alt+Digit5").unwrap();
        assert_eq!(p3.canonical, "Alt+Super+5");

        let p4 = parse_hotkey("CommandOrControl+F12").unwrap();
        assert_eq!(p4.canonical, "Ctrl+F12");
    }

    #[test]
    fn empty_string_disables_hotkey() {
        let p = parse_hotkey("   ").unwrap();
        assert_eq!(p.canonical, "");
        assert_eq!(p.shortcut, None);
    }

    #[test]
    fn rejects_invalid_or_modifierless_shortcuts() {
        for bad in [
            "Space",
            "K",
            "F12",
            "Ctrl",
            "Ctrl+Alt",
            "Ctrl+",
            "+Space",
            "Ctrl++Space",
            "Ctrl+A+B",
            "Ctrl+A+Shift",
            "Ctrl+UnknownKey",
        ] {
            assert!(parse_hotkey(bad).is_err(), "expected error for {bad:?}");
        }
    }

    #[test]
    fn switch_shortcut_registers_updates_and_disables() {
        let mut backend = FakeBackend::default();
        let mut current = None;

        let c1 = switch_shortcut(&mut backend, &mut current, "Ctrl+Alt+Space").unwrap();
        assert_eq!(c1, "Ctrl+Alt+Space");
        assert_eq!(backend.registered.len(), 1);

        let c2 = switch_shortcut(&mut backend, &mut current, "Ctrl+Shift+K").unwrap();
        assert_eq!(c2, "Ctrl+Shift+K");
        assert_eq!(backend.registered.len(), 1);
        assert!(backend.registered.contains(&current.unwrap()));

        let c3 = switch_shortcut(&mut backend, &mut current, "").unwrap();
        assert_eq!(c3, "");
        assert!(current.is_none());
        assert!(backend.registered.is_empty());
    }

    #[test]
    fn switch_shortcut_keeps_previous_when_new_is_invalid_or_occupied() {
        let mut backend = FakeBackend::default();
        let mut current = None;

        switch_shortcut(&mut backend, &mut current, "Ctrl+Alt+Space").unwrap();
        let initial = current.unwrap();

        // Invalid syntax: previous stays registered.
        assert!(switch_shortcut(&mut backend, &mut current, "Space").is_err());
        assert_eq!(current, Some(initial));
        assert!(backend.registered.contains(&initial));

        // Occupied by another application: rolls back to previous.
        let busy = parse_hotkey("Ctrl+Shift+X").unwrap().shortcut.unwrap();
        backend.occupied_externally.insert(busy);

        let err = switch_shortcut(&mut backend, &mut current, "Ctrl+Shift+X").unwrap_err();
        assert!(err.contains("Ctrl+Shift+X"));
        assert_eq!(current, Some(initial));
        assert!(backend.registered.contains(&initial));
    }

    #[test]
    fn temporary_escape_registers_only_on_summon_and_unregisters_on_collapse_focus_or_exit() {
        let mut backend = FakeBackend::default();
        let mut esc = EscapeShortcutState::new();
        let esc_sc = escape_shortcut();

        // Not registered initially (e.g. hover expansion never calls on_summoned).
        assert!(!esc.is_registered());
        assert!(!backend.registered.contains(&esc_sc));

        // Summon registers Escape.
        esc.on_summoned(&mut backend);
        assert!(esc.is_registered());
        assert!(esc.is_summoned_open());
        assert!(backend.registered.contains(&esc_sc));

        // Collapse unregisters Escape.
        esc.on_collapsed(&mut backend);
        assert!(!esc.is_registered());
        assert!(!esc.is_summoned_open());
        assert!(!backend.registered.contains(&esc_sc));

        // Summon again, then island acquires keyboard focus: Escape is unregistered immediately
        // and stays unregistered when focus is released.
        esc.on_summoned(&mut backend);
        assert!(esc.is_registered());
        esc.on_focus_changed(&mut backend, true);
        assert!(!esc.is_registered());
        assert!(!backend.registered.contains(&esc_sc));
        esc.on_focus_changed(&mut backend, false);
        assert!(!esc.is_registered());
        assert!(!backend.registered.contains(&esc_sc));

        // Summon while already holding keyboard focus does not register Escape.
        esc.on_focus_changed(&mut backend, true);
        esc.on_summoned(&mut backend);
        assert!(!esc.is_registered());
        assert!(!backend.registered.contains(&esc_sc));
        esc.on_focus_changed(&mut backend, false);

        // Exit unregisters an active Escape.
        esc.on_summoned(&mut backend);
        assert!(esc.is_registered());
        esc.on_exit(&mut backend);
        assert!(!esc.is_registered());
        assert!(!backend.registered.contains(&esc_sc));
    }

    #[test]
    fn temporary_escape_registration_failure_is_quiet_and_non_fatal() {
        let mut backend = FakeBackend::default();
        let esc_sc = escape_shortcut();
        backend.occupied_externally.insert(esc_sc);

        let mut esc = EscapeShortcutState::new();
        esc.on_summoned(&mut backend);
        assert!(!esc.is_registered());
        assert!(esc.is_summoned_open());

        // Collapse afterwards does not panic or unregister the external owner's shortcut.
        esc.on_collapsed(&mut backend);
        assert!(!esc.is_registered());
        assert!(!esc.is_summoned_open());
    }
}
