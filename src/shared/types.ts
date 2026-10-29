/**
 * Shared IPC contract between Rust (src-tauri) and the React UI.
 * Owner: Orchestrator. Human-readable spec: docs/contracts.md.
 *
 * Rules:
 * - Rust structs mirror these types with `#[serde(rename_all = "camelCase")]`.
 * - Enums are string unions on the TS side and `#[serde(rename_all = "camelCase")]` enums in Rust.
 * - Changing this file requires an Orchestrator decision (agents propose changes in their report).
 */
import type { ComponentType } from "react";

// ───────────────────────────── Window / shell (wave 1) ─────────────────────────────

/** Fixed size of the native island window, in CSS (logical) px. The visible shape lives inside it. */
export const ISLAND_WINDOW = { width: 800, height: 520 } as const;

/** Rectangle in CSS px relative to the island window's top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Current visible island shape. Rust uses it for hit-testing (click-through) and the window region. */
export interface IslandShape extends Rect {
  /** Corner radius in CSS px. */
  radius: number;
}

export type IslandMode = "collapsed" | "expanded";

/** Payload of `island://focus-changed`: whether the island window currently holds keyboard focus. */
export interface KeyboardFocusPayload {
  active: boolean;
}

/** Payload of `island://hover`. */
export interface HoverPayload {
  /** Cursor is inside the current IslandShape. */
  inside: boolean;
}

export type VibrancyMode = "acrylic" | "mica" | "none";

/** Result of `window_set_vibrancy`: what was actually applied (may fall back to "none"). */
export interface VibrancyResult {
  requested: VibrancyMode;
  applied: VibrancyMode;
  error: string | null;
}

export interface MonitorInfo {
  id: string;
  name: string;
  /** Physical px. */
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

// ───────────────────────────── Settings (wave 2, R1) ─────────────────────────────

export type ThemeMode = "auto" | "light" | "dark";

/** UI language (v0.2). "auto" = Windows display language: Russian → "ru", anything else → "en". */
export type LanguageMode = "auto" | "ru" | "en";

export interface Settings {
  theme: ThemeMode;
  vibrancy: VibrancyMode;
  /** MonitorInfo.id or "primary". */
  monitor: string;
  autostart: boolean;
  doNotDisturb: boolean;
  /** Delay before hover expands the island. */
  hoverExpandDelayMs: number;
  /** Delay before the island collapses after the cursor leaves. */
  hoverCollapseDelayMs: number;
  /** Hide the island while a fullscreen app/game is in the foreground. */
  hideInFullscreen: boolean;
  /** Global shortcut that summons the island (also over fullscreen apps), Tauri accelerator syntax,
   *  e.g. "Ctrl+Alt+Space". "" = disabled. Default "Ctrl+Alt+I". */
  summonHotkey: string;
  /** Lower-case exe names (e.g. "chrome.exe") where the island stays visible over fullscreen. Default []. */
  fullscreenAllowlist: string[];
  /** v0.2: lower-case exe names; while such an app is the maximized foreground window, the pill hides itself
   *  (shown again by the summon hotkey or a ~400 ms cursor dwell at the top edge). Default: common browsers. */
  autoHideApps: string[];
  /** v0.2.1: OCR recognizer language — "auto" (Windows user-profile languages) or a BCP-47 tag from
   *  `capture_ocr_languages`, e.g. "en-US", "ru". Default "auto". */
  ocrLanguage: string;
  /** UI and tray language. Default "auto". */
  language: LanguageMode;
}

/** A fullscreen app R1 has seen recently (for the allowlist UI). */
export interface FullscreenApp {
  /** Lower-case exe name, e.g. "cs2.exe". */
  exe: string;
  /** Last window title seen (may be ""). */
  title: string;
  /** Epoch ms. */
  lastSeen: number;
}

// ───────────────────────────── Updater (v0.1, R1) ─────────────────────────────

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

// ───────────────────────────── Media / audio (wave 2, R2) ─────────────────────────────

export type PlaybackStatus = "playing" | "paused" | "stopped" | "unknown";

export interface MediaState {
  /** false → no active SMTC session; the other fields are defaults. */
  hasSession: boolean;
  /** Source app id, e.g. "Spotify.exe". */
  sourceApp: string;
  title: string;
  artist: string;
  album: string;
  /** data: URL (image/png|jpeg) or null. */
  artwork: string | null;
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
  /** Epoch ms when positionMs was sampled — UI extrapolates progress while playing. */
  positionSampledAt: number;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
}

export type MediaAction = "playPause" | "next" | "previous";

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioState {
  /** 0..100 */
  volume: number;
  muted: boolean;
  device: AudioDevice | null;
}

/** v0.2.2: measured spectrum of the default Windows render endpoint, never microphone input. */
export interface AudioSpectrum {
  /** false when capture is inactive, unavailable or being reinitialised. */
  available: boolean;
  /** Four ascending frequency bands. Finite normalised amplitudes in 0..1; zero for silence. */
  bands: [number, number, number, number];
  /** Epoch ms. Consumers discard stale frames rather than looping old values. */
  sampledAt: number;
}

/** v0.2.2: system power status. null means Windows could not determine the value. */
export interface BatteryState {
  hasBattery: boolean | null;
  /** 0..100, including 0. null when absent or unknown. */
  percent: number | null;
  charging: boolean | null;
  acConnected: boolean | null;
  saver: boolean | null;
  /** Estimated remaining seconds, null when unavailable. */
  remainingSeconds: number | null;
}

// ───────────────────────────── Clipboard (wave 2, R2) ─────────────────────────────

export type ClipKind = "text" | "link" | "image" | "files";

export interface ClipItem {
  id: number;
  kind: ClipKind;
  /** Text / URL / newline-joined file paths. For images: empty string. */
  text: string;
  /** Short preview for the list (≤ 200 chars). For images: data: URL thumbnail. */
  preview: string;
  /** Executable name of the foreground app at copy time, e.g. "Telegram.exe". May be "". */
  sourceApp: string;
  /** Epoch ms. */
  createdAt: number;
  pinned: boolean;
}

/** `clipboard_paste` mode: "paste" = put into clipboard + Ctrl+V into the previously focused window; "copy" = clipboard only (Shift+click). */
export type PasteMode = "paste" | "copy";

// ───────────────────────────── Notes (wave 2, R2 storage) ─────────────────────────────

export interface Note {
  id: number;
  /** Folder/tab name, e.g. "Заметка", "Работа". */
  folder: string;
  title: string;
  /** Rich text serialized as HTML (sanitized by the UI before rendering). */
  body: string;
  updatedAt: number;
}

// ───────────────────────────── Capture (v0.2, R2 + R1) ─────────────────────────────

/** "region" = user drags a rectangle on a frozen screen overlay; "screen" = the whole monitor under the cursor. */
export type CaptureMode = "region" | "screen";
/** "copy" = PNG to the clipboard; "save" = PNG file in the screenshots folder (and to the clipboard); "ocr" = recognized text to the clipboard. */
export type CaptureAction = "copy" | "save" | "ocr" | "qr";

export interface CaptureResult {
  action: CaptureAction;
  /** Captured size in physical pixels. */
  width: number;
  height: number;
  /** Saved file path for "save", else null. */
  path: string | null;
  /** Recognized text for "ocr" / decoded QR payload for "qr" ("" if nothing was found), else null. */
  text: string | null;
}

/** A color picked from the screen (v0.2). */
/** An OCR recognizer language installed in Windows (v0.2.1). */
export interface OcrLanguage {
  /** BCP-47 tag, e.g. "en-US", "ru". */
  tag: string;
  /** Display name as Windows gives it, e.g. "English (United States)". */
  name: string;
}

export interface PickedColor {
  /** "#RRGGBB", upper-case. */
  hex: string;
  r: number;
  g: number;
  b: number;
}

// ───────────────────────────── Dock (v0.2, R2) ─────────────────────────────

export type DockKind = "app" | "folder" | "file";

export interface DockItem {
  /** Stable id (R2-generated). */
  id: string;
  /** Absolute path as dropped (.exe, .lnk, folder or file). Opened with the shell default action. */
  path: string;
  /** Display name: shortcut / file name without extension, folder name. */
  name: string;
  kind: DockKind;
  /** 64×64 PNG icon as a data: URL ("" if Windows gave none). */
  icon: string;
}

// ───────────────────────────── Command & event registry ─────────────────────────────

/**
 * Every Tauri command: name → [args, result]. Args keys are camelCase (Tauri converts to snake_case params).
 * The UI calls them only through src/ipc (typed wrappers + browser mock).
 */
export interface Commands {
  // window (R1, wave 1)
  island_set_shape: [{ shape: IslandShape }, void];
  island_set_mode: [{ mode: IslandMode }, void];
  window_set_vibrancy: [{ mode: VibrancyMode }, VibrancyResult];
  window_list_monitors: [Record<string, never>, MonitorInfo[]];
  /** Wave 2. true → remember the current foreground window, make the island the active window (keys reach inputs).
   *  false → restore the remembered foreground window and go back to NOACTIVATE. Idempotent. */
  island_set_keyboard_focus: [{ active: boolean }, void];
  // settings (R1, wave 2)
  settings_get: [Record<string, never>, Settings];
  settings_set: [{ patch: Partial<Settings> }, Settings];
  /** Recently seen fullscreen apps, newest first (≤ 20, persisted by R1). */
  window_recent_fullscreen_apps: [Record<string, never>, FullscreenApp[]];
  /** v0.2: recently seen maximized foreground apps, newest first (for the auto-hide list, §14). */
  window_recent_maximized_apps: [Record<string, never>, FullscreenApp[]];
  // updater (R1, v0.1)
  updater_check: [Record<string, never>, UpdateInfo | null];
  updater_install: [Record<string, never>, void];
  // media / audio (R2, wave 2)
  media_get_state: [Record<string, never>, MediaState];
  media_action: [{ action: MediaAction }, void];
  media_seek: [{ positionMs: number }, void];
  audio_get_state: [Record<string, never>, AudioState];
  audio_set_volume: [{ volume: number }, void];
  audio_set_muted: [{ muted: boolean }, void];
  audio_list_devices: [Record<string, never>, AudioDevice[]];
  audio_set_device: [{ id: string }, void];
  /** v0.2.2: idempotent demand signal. Capture also suspends while the native island is hidden. */
  audio_visualizer_set_enabled: [{ enabled: boolean }, void];
  system_get_battery: [Record<string, never>, BatteryState];
  // clipboard (R2, wave 2)
  clipboard_list: [{ query: string; limit: number }, ClipItem[]];
  clipboard_paste: [{ id: number; mode: PasteMode }, void];
  clipboard_pin: [{ id: number; pinned: boolean }, void];
  clipboard_delete: [{ id: number }, void];
  clipboard_clear: [{ keepPinned: boolean }, void];
  // notes (R2, wave 2)
  notes_list: [Record<string, never>, Note[]];
  notes_save: [{ note: Omit<Note, "id" | "updatedAt"> & { id: number | null } }, Note];
  notes_delete: [{ id: number }, void];
  // capture (v0.2). Resolves when done; null = cancelled (Esc / right click). Rejects with a user-facing reason
  // (e.g. OCR language pack missing). The island hides itself for the duration of the capture.
  capture_start: [{ mode: CaptureMode; action: CaptureAction }, CaptureResult | null];
  /** Folder for "save" captures (default: Pictures\Screenshots\CCOTT, created on demand). */
  capture_open_folder: [Record<string, never>, void];
  /** v0.2: frozen-screen overlay with a magnifier; click picks the pixel, HEX goes to the clipboard. null = cancelled. */
  capture_pick_color: [Record<string, never>, PickedColor | null];
  /** v0.2.1: OCR languages available on this PC (OcrEngine.AvailableRecognizerLanguages). */
  capture_ocr_languages: [Record<string, never>, OcrLanguage[]];
  // dock (R2, v0.2). Order of the returned list = display order.
  dock_list: [Record<string, never>, DockItem[]];
  /** Adds paths in order (duplicates by path are ignored, max 12 items); returns the new list. */
  dock_add: [{ paths: string[] }, DockItem[]];
  dock_remove: [{ id: string }, DockItem[]];
  /** `ids` = full new order. */
  dock_reorder: [{ ids: string[] }, DockItem[]];
  /** Opens the item with the shell default action; rejects with a user-facing reason if the path is gone. */
  dock_open: [{ id: string }, void];
  /** Starts a native copy drag of the item's file/folder (drag-out of the dock). Rejects if the path is gone. */
  dock_start_drag: [{ id: string }, void];
}

export type CommandName = keyof Commands;
export type CommandArgs<C extends CommandName> = Commands[C][0];
export type CommandResult<C extends CommandName> = Commands[C][1];

/** Every event emitted by Rust: name → payload. */
export interface Events {
  "island://hover": HoverPayload;
  /** R1: keyboard focus changed (incl. lost externally, e.g. user clicked another app). */
  "island://focus-changed": KeyboardFocusPayload;
  /** R1: tray «Настройки» clicked → UI expands and opens the settings view. */
  "island://open-settings": null;
  /** R1: the summon hotkey was pressed. The island is already shown (even over fullscreen); UI toggles expand/collapse. */
  "island://summoned": null;
  /** v0.2.1, R1: the cursor is approaching the collapsed pill (or the summon hotkey was pressed) — the UI wakes the
   *  WebView2 compositor with one cheap invisible frame so the coming expand starts smoothly. Throttled by R1. */
  "island://prewarm": null;
  "settings://changed": Settings;
  "updater://available": UpdateInfo;
  "media://changed": MediaState;
  "audio://changed": AudioState;
  /** v0.2.2: at most 20 Hz while the visible media indicator requests capture. */
  "audio://spectrum": AudioSpectrum;
  "system://battery": BatteryState;
  "clipboard://added": ClipItem;
  "clipboard://changed": null;
  /** R2: the dock list changed (any window/source). */
  "dock://changed": DockItem[];
}

export type EventName = keyof Events;

// ───────────────────────────── UI module interface ─────────────────────────────

export type ModuleId =
  | "home"
  | "clipboard"
  | "text"
  | "notes"
  | "shelf"
  | "palette"
  | "weather"
  | "control"
  | "agents";

export interface ModuleIconProps {
  size?: number;
  className?: string;
}

/** Live activity shown inside the collapsed pill (e.g. playing track, running timer). */
export interface CompactActivity {
  /** Hook: true while this activity wants to be shown in the pill. */
  useIsActive: () => boolean;
  /** Higher wins when several activities are active. */
  priority: number;
  /** Rendered inside the collapsed pill. Keep it within the pill's height token. */
  View: ComponentType;
}

/** A tab of the expanded island. Registered in src/modules/registry.ts. */
export interface IslandModule {
  id: ModuleId;
  /** Tab label (ru). */
  title: string;
  icon: ComponentType<ModuleIconProps>;
  /** Full tab content rendered inside the expanded panel. */
  Tab: ComponentType;
  compact?: CompactActivity;
  /** Tab order, ascending. */
  order: number;
}
