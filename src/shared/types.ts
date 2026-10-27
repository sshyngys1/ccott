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
  "settings://changed": Settings;
  "updater://available": UpdateInfo;
  "media://changed": MediaState;
  "audio://changed": AudioState;
  "clipboard://added": ClipItem;
  "clipboard://changed": null;
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
