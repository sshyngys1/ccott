import { t } from "../../i18n";
import type { FullscreenApp } from "../../shared/types";
// Owner: F1. Pure helpers for the summon-hotkey recorder and the fullscreen allowlist in Settings.

export const DEFAULT_SUMMON_HOTKEY = "Ctrl+Alt+I";

export const DEFAULT_AUTO_HIDE_APPS: readonly string[] = [
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "browser.exe",
  "opera.exe",
  "brave.exe",
  "vivaldi.exe",
];

const MODIFIER_KEYS = new Set([
  "Control",
  "ControlLeft",
  "ControlRight",
  "Shift",
  "ShiftLeft",
  "ShiftRight",
  "Alt",
  "AltLeft",
  "AltRight",
  "AltGraph",
  "Meta",
  "MetaLeft",
  "MetaRight",
  "OS",
  "Super",
]);

const CODE_TO_TOKEN: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backquote: "`",
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
};

const KEY_TO_TOKEN: Record<string, string> = {
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "Up",
  up: "Up",
  arrowdown: "Down",
  down: "Down",
  arrowleft: "Left",
  left: "Left",
  arrowright: "Right",
  right: "Right",
  "`": "`",
  "~": "`",
  backquote: "`",
  "-": "Minus",
  minus: "Minus",
  "=": "Equal",
  equal: "Equal",
  "[": "BracketLeft",
  bracketleft: "BracketLeft",
  "]": "BracketRight",
  bracketright: "BracketRight",
  "\\": "Backslash",
  backslash: "Backslash",
  ";": "Semicolon",
  semicolon: "Semicolon",
  "'": "Quote",
  quote: "Quote",
  ",": "Comma",
  comma: "Comma",
  ".": "Period",
  period: "Period",
  "/": "Slash",
  slash: "Slash",
};

export interface KeyComboEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

function keyTokenFromCode(code: string | undefined): string | null {
  if (!code || MODIFIER_KEYS.has(code)) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const fnKey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fnKey) return `F${fnKey[1]}`;
  return CODE_TO_TOKEN[code] ?? null;
}

function keyTokenFromKey(key: string): string | null {
  if (!key || MODIFIER_KEYS.has(key)) return null;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  const fnKey = /^[fF]([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (fnKey) return `F${fnKey[1]}`;
  return KEY_TO_TOKEN[key] ?? KEY_TO_TOKEN[key.toLowerCase()] ?? null;
}

/**
 * Builds a canonical Tauri accelerator string (e.g. `"Ctrl+Alt+Space"`) from a `keydown` event.
 * Returns `null` if no modifier is held or only modifier keys are pressed.
 */
export function formatAcceleratorFromKeyEvent(event: KeyComboEvent): string | null {
  if (MODIFIER_KEYS.has(event.key) || (event.code && MODIFIER_KEYS.has(event.code))) {
    return null;
  }
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Super");
  if (mods.length === 0) return null;

  const mainKey = keyTokenFromCode(event.code) ?? keyTokenFromKey(event.key);
  if (!mainKey) return null;

  return [...mods, mainKey].join("+");
}

/**
 * Validates and normalizes an accelerator string (matching Rust `hotkeys::parse_hotkey`).
 * Empty string `""` is valid (hotkey disabled). Throws a localized error if invalid.
 */
export function normalizeAccelerator(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const parts = trimmed
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  let ctrl = false;
  let alt = false;
  let shift = false;
  let superKey = false;
  let mainKey: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "commandorcontrol" || lower === "cmdorctrl") {
      ctrl = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (lower === "super" || lower === "meta" || lower === "win" || lower === "command" || lower === "cmd") {
      superKey = true;
    } else {
      if (mainKey !== null) {
        throw new Error(t("invalidShortcutUseOnlyOneMainKey", { p0: trimmed }));
      }
      const token = keyTokenFromCode(part) ?? keyTokenFromKey(part);
      if (!token) {
        throw new Error(t("unsupportedKeyInShortcut", { p0: part, p1: trimmed }));
      }
      mainKey = token;
    }
  }

  if (!ctrl && !alt && !shift && !superKey) {
    throw new Error(t("shortcutNeedsAModifierCtrlAltShiftOrWin", { p0: trimmed }));
  }
  if (!mainKey) {
    throw new Error(t("shortcutHasNoMainKey", { p0: trimmed }));
  }

  const out: string[] = [];
  if (ctrl) out.push("Ctrl");
  if (alt) out.push("Alt");
  if (shift) out.push("Shift");
  if (superKey) out.push("Super");
  out.push(mainKey);
  return out.join("+");
}

/** Normalizes an array of allowlisted exe names (trimmed, lower-case, deduplicated). */
export function normalizeFullscreenAllowlist(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const exe = raw.trim().toLowerCase();
    if (exe && !out.includes(exe)) {
      out.push(exe);
    }
  }
  return out;
}

/** Adds or removes `exe` (case-insensitively) from `allowlist`, returning a normalized lower-case list. */
export function toggleFullscreenAllowlist(allowlist: readonly string[], exe: string, allow: boolean): string[] {
  const target = exe.trim().toLowerCase();
  if (!target) return normalizeFullscreenAllowlist(allowlist);
  const filtered = normalizeFullscreenAllowlist(allowlist).filter((item) => item !== target);
  return allow ? [...filtered, target] : filtered;
}

/** Normalizes a user-entered executable name (trims path, lower-cases, ensures `.exe` suffix). */
export function normalizeAutoHideExe(raw: string): string {
  const trimmed = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  const base = (trimmed.split(/[\\/]/).pop() ?? "").trim().toLowerCase();
  if (!base || base === ".exe") return "";
  return base.endsWith(".exe") ? base : `${base}.exe`;
}

/** Normalizes an array of auto-hide exe names (trimmed, lower-case, deduplicated). */
export function normalizeAutoHideApps(list: readonly string[]): string[] {
  return normalizeFullscreenAllowlist(list);
}

/** Adds or removes `exe` (case-insensitively) from `autoHideApps`, returning a normalized lower-case list. */
export function toggleAutoHideApp(autoHideApps: readonly string[], exe: string, hide: boolean): string[] {
  return toggleFullscreenAllowlist(autoHideApps, exe, hide);
}

export interface AutoHideAppRow {
  exe: string;
  title: string;
  enabled: boolean;
}

/**
 * Builds the merged list of rows for the "Hide the island over apps" section from
 * `settings.autoHideApps`, session-remembered exes, and recently seen maximized apps.
 */
export function buildAutoHideAppRows(
  autoHideApps: readonly string[],
  recentApps: readonly FullscreenApp[],
  sessionExes: readonly string[] = [],
  dismissedExes: readonly string[] = [],
): AutoHideAppRow[] {
  const activeSet = new Set(normalizeAutoHideApps(autoHideApps));
  const dismissedSet = new Set(normalizeAutoHideApps(dismissedExes));
  const titleByExe = new Map<string, string>();
  for (const app of recentApps) {
    const exe = app.exe.trim().toLowerCase();
    if (exe && !titleByExe.has(exe) && app.title.trim()) {
      titleByExe.set(exe, app.title.trim());
    }
  }

  const orderedExes: string[] = [];
  const pushExe = (raw: string, allowDismissed: boolean) => {
    const exe = raw.trim().toLowerCase();
    if (!exe || orderedExes.includes(exe)) return;
    if (!allowDismissed && dismissedSet.has(exe) && !activeSet.has(exe)) return;
    orderedExes.push(exe);
  };

  for (const exe of sessionExes) pushExe(exe, false);
  for (const exe of autoHideApps) pushExe(exe, true);
  for (const app of recentApps) pushExe(app.exe, false);

  return orderedExes.map((exe) => ({
    exe,
    title: titleByExe.get(exe) || exe,
    enabled: activeSet.has(exe),
  }));
}
