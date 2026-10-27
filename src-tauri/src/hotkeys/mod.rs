//! Global summon shortcut (`Settings::summonHotkey`) via `tauri-plugin-global-shortcut`.
//! Owner: R1 (Rust-Shell). Contract: `docs/contracts.md` section 8.
//!
//! Pressing the shortcut shows the island (even over a fullscreen app that is not in the allowlist),
//! reasserts `HWND_TOPMOST` without stealing focus, and emits `island://summoned`.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const DEFAULT_SUMMON_HOTKEY: &str = "Ctrl+Alt+I";

#[derive(Default)]
pub struct HotkeyState {
    registered: Mutex<Option<Shortcut>>,
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
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::window::summon_for_runtime(app);
            }
        })
        .build()
}

/// Registers the initial `summonHotkey` from `SettingsState`. Must run after `settings::setup` and
/// `window::setup`. If the default or stored shortcut is already taken by another process at
/// startup, logs a warning and starts without a registered shortcut instead of aborting startup.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(HotkeyState::default());
    let wanted = crate::settings::current(app.handle()).summon_hotkey;
    if let Err(e) = apply(app.handle(), &wanted) {
        log::warn!("hotkeys: cannot register startup shortcut {wanted:?}: {e}");
    }
    Ok(())
}

/// Applies a new `summonHotkey` value (or `""` to disable). On invalid syntax or registration
/// failure (shortcut occupied by another app), keeps the previous shortcut registered and returns
/// a human-readable Russian error message for the UI.
pub fn apply(app: &AppHandle, wanted: &str) -> Result<String, String> {
    let state = app.state::<HotkeyState>();
    let mut current = state.registered.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = TauriShortcutBackend { app };
    let result = switch_shortcut(&mut backend, &mut current, wanted);
    if let Ok(ref canonical) = result {
        log::debug!("hotkeys: summonHotkey = {canonical:?}");
    }
    result
}

/// Pure transition: validates `wanted`, unregisters the old shortcut if different, registers the
/// new one, and rolls back to the old one if registration fails.
pub fn switch_shortcut<B: ShortcutBackend>(
    backend: &mut B,
    current: &mut Option<Shortcut>,
    wanted: &str,
) -> Result<String, String> {
    let parsed = parse_hotkey(wanted)?;
    if *current == parsed.shortcut {
        return Ok(parsed.canonical);
    }

    let previous = *current;
    if let Some(old_sc) = previous {
        if let Err(e) = backend.unregister(old_sc) {
            log::warn!("hotkeys: failed to unregister previous shortcut {old_sc}: {e}");
        }
        *current = None;
    }

    if let Some(new_sc) = parsed.shortcut {
        if let Err(err) = backend.register(new_sc) {
            log::warn!(
                "hotkeys: cannot register {}: {err}; restoring previous shortcut",
                parsed.canonical
            );
            if let Some(old_sc) = previous {
                match backend.register(old_sc) {
                    Ok(()) => *current = Some(old_sc),
                    Err(restore_err) => {
                        log::error!(
                            "hotkeys: failed to restore previous shortcut {old_sc}: {restore_err}"
                        );
                    }
                }
            }
            return Err(format!(
                "Сочетание клавиш «{}» уже занято другим приложением или системой",
                parsed.canonical
            ));
        }
        *current = Some(new_sc);
    }

    Ok(parsed.canonical)
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
}
