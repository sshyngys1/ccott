// Owner: F1 (Frontend-Shell). Browser mock of the Tauri backend: plausible, mutable data + event emitter.
// Used automatically by src/ipc/index.ts when `window.__TAURI_INTERNALS__` is absent (npm run dev in a browser, vitest).
import type {
  AudioDevice,
  AudioState,
  ClipItem,
  DockItem,
  CommandArgs,
  CommandName,
  CommandResult,
  EventName,
  Events,
  FullscreenApp,
  IslandMode,
  IslandShape,
  MediaState,
  Note,
  Settings,
  UpdateInfo,
} from "../shared/types";
import {
  DEFAULT_AUTO_HIDE_APPS,
  normalizeAccelerator,
  normalizeAutoHideApps,
  normalizeFullscreenAllowlist,
} from "../shell/settings/hotkey";
import { t } from "../i18n";

// ───────────────────────────── helpers ─────────────────────────────

/** Gradient cover as a `data:` URL of a generated SVG. */
export function makeCover(from: string, to: string, accent = "rgba(255,255,255,0.35)"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="128" height="128" fill="url(#g)"/>` +
    `<circle cx="92" cy="40" r="34" fill="${accent}"/>` +
    `<circle cx="36" cy="100" r="22" fill="rgba(0,0,0,0.18)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

// ───────────────────────────── event emitter ─────────────────────────────

type Listener<E extends EventName> = (payload: Events[E]) => void;
const listeners = new Map<EventName, Set<Listener<EventName>>>();

export function mockListen<E extends EventName>(event: E, cb: Listener<E>): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  const fn = cb as Listener<EventName>;
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export function mockEmit<E extends EventName>(event: E, payload: Events[E]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const cb of [...set]) cb(clone(payload));
}

export function mockListenerCount(event: EventName): number {
  return listeners.get(event)?.size ?? 0;
}

/**
 * Mock for the Rust cursor poller: `island://hover` is generated from pointerenter/pointerleave of the island element.
 * Returns a cleanup function.
 */
export function registerHoverTarget(el: HTMLElement): () => void {
  const enter = () => mockEmit("island://hover", { inside: true });
  const leave = () => mockEmit("island://hover", { inside: false });
  el.addEventListener("pointerenter", enter);
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointerenter", enter);
    el.removeEventListener("pointerleave", leave);
  };
}

// ───────────────────────────── debug stats ─────────────────────────────

export interface MockStats {
  shapeCalls: number;
  modeCalls: number;
  lastShape: IslandShape | null;
  lastMode: IslandMode | null;
  /** performance.now() of the latest island_set_shape calls (capped), to check the "≤ 1 call per frame" rule. */
  shapeTimestamps: number[];
  /** The island "holds the keyboard" (last successful `island_set_keyboard_focus`). */
  keyboardFocus: boolean;
  /** Every `island_set_keyboard_focus` argument, in call order. */
  keyboardFocusCalls: boolean[];
  /** Last `clipboard_paste` request. */
  lastPaste: { id: number; mode: "paste" | "copy" } | null;
  /** Number of `updater_check` calls. */
  updaterChecks: number;
  /** Number of `updater_install` calls. */
  updaterInstalls: number;
}

export const mockStats: MockStats = {
  shapeCalls: 0,
  modeCalls: 0,
  lastShape: null,
  lastMode: null,
  shapeTimestamps: [],
  keyboardFocus: false,
  keyboardFocusCalls: [],
  lastPaste: null,
  updaterChecks: 0,
  updaterInstalls: 0,
};

/** Knobs for the keyboard-focus and hotkey mocks: R1 takes ~5–150 ms to hand the window the foreground, and may refuse. */
export const mockConfig = { keyboardFocusDelayMs: 30, failKeyboardFocus: false, failHotkeyRegistration: false, captureOutcome:"success" as "success" | "cancel" | "error" | "empty", qrText:"https://example.com/ccott", dockOpenError:false };

/** Helpers for poking the app from the browser console / devtools: `__ISLAND_MOCK__.openSettings()`, … */
export interface MockHelpers {
  /** Simulates the tray item «Настройки» (`island://open-settings`). */
  openSettings: () => void;
  /** Simulates pressing the global summon hotkey (`island://summoned`). */
  summon: () => void;
  /** Simulates a copy in another app (`clipboard://added` + `clipboard://changed`). */
  copy: (text: string, kind?: ClipItem["kind"]) => ClipItem;
  /** Simulates the user clicking another window while the island holds the keyboard (`island://focus-changed`). */
  loseFocus: () => void;
  /** Patches the media state (e.g. `{ hasSession: false }`) and emits `media://changed`. */
  setMedia: (patch: Partial<MediaState>) => void;
  /** Sets the available update for `updater_check` (and optionally emits `updater://available`). */
  setUpdate: (update: UpdateInfo | null, emit?: boolean) => void;
  /** Replaces the list returned by `window_recent_fullscreen_apps`. */
  setFullscreenApps: (apps: FullscreenApp[]) => void;
  config: typeof mockConfig;
}

// ───────────────────────────── mutable state ─────────────────────────────

/** Sample data language: Russian in tests and in a Russian browser, English otherwise —
 *  so the browser mode and README screenshots read naturally in either language. */
const SAMPLE_RU = import.meta.env.MODE === "test" || typeof navigator === "undefined" || /^ru/i.test(navigator.language);
const sample = (ru: string, en: string): string => (SAMPLE_RU ? ru : en);

interface Track {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  artwork: string;
}

const TRACKS: Track[] = [
  {
    title: sample("Полночный маршрут", "Midnight Route"),
    artist: sample("Северные огни", "Northern Lights"),
    album: sample("Ночная смена", "Night Shift"),
    durationMs: 214_000,
    artwork: makeCover("#5b3df5", "#e94cc0"),
  },
  {
    title: sample("Стекло и дождь", "Glass and Rain"),
    artist: sample("Лунный прибой", "Lunar Surf"),
    album: sample("Прозрачность", "Transparency"),
    durationMs: 187_000,
    artwork: makeCover("#0ea5a4", "#1d4ed8", "rgba(255,255,255,0.28)"),
  },
  {
    title: sample("Тихий порт", "Quiet Harbor"),
    artist: sample("Северные огни", "Northern Lights"),
    album: sample("Ночная смена", "Night Shift"),
    durationMs: 242_000,
    artwork: makeCover("#f59e0b", "#dc2626", "rgba(255,255,255,0.3)"),
  },
];

interface MockState {
  dock: DockItem[];
  nextDockId:number;
  trackIndex: number;
  media: MediaState;
  audio: AudioState;
  devices: AudioDevice[];
  settings: Settings;
  fullscreenApps: FullscreenApp[];
  maximizedApps: FullscreenApp[];
  update: UpdateInfo | null;
  clips: ClipItem[];
  notes: Note[];
  nextClipId: number;
  nextNoteId: number;
}

function mediaFor(index: number, now: number, status: MediaState["status"], positionMs: number): MediaState {
  const t = TRACKS[index];
  return {
    hasSession: true,
    sourceApp: "Spotify.exe",
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: t.artwork,
    status,
    positionMs,
    durationMs: t.durationMs,
    positionSampledAt: now,
    canPlayPause: true,
    canNext: true,
    canPrevious: true,
    canSeek: true,
  };
}

function clip(
  id: number,
  kind: ClipItem["kind"],
  text: string,
  sourceApp: string,
  createdAt: number,
  pinned = false,
  preview = text,
): ClipItem {
  return { id, kind, text, preview: preview.slice(0, kind === "image" ? undefined : 200), sourceApp, createdAt, pinned };
}

function createState(): MockState {
  const now = Date.now();
  const min = 60_000;
  const devices: AudioDevice[] = [
    { id: "dev-speakers", name: sample("Динамики", "Speakers"), isDefault: true },
    { id: "dev-headphones", name: sample("Наушники (Bluetooth)", "Headphones (Bluetooth)"), isDefault: false },
    { id: "dev-monitor", name: sample("Монитор (HDMI)", "Monitor (HDMI)"), isDefault: false },
  ];
  const clips: ClipItem[] = [
    clip(1, "link", "https://github.com/tauri-apps/tauri", "chrome.exe", now - 95 * min, true),
    clip(2, "text", sample("Созвон с командой в 15:30, ссылка в календаре", "Team call at 3:30 PM, link in the calendar"), "Telegram.exe", now - 2 * min),
    clip(3, "text", "npm run tauri dev", "WindowsTerminal.exe", now - 7 * min),
    clip(4, "link", "https://developer.mozilla.org/ru/docs/Web/CSS/backdrop-filter", "chrome.exe", now - 18 * min),
    clip(5, "text", sample("ул. Абая, 150, офис 12", "221B Baker Street, London"), "Telegram.exe", now - 41 * min),
    clip(6, "image", "", "SnippingTool.exe", now - 63 * min, false, makeCover("#0f172a", "#38bdf8")),
    clip(
      7,
      "files",
      sample("C:\\Users\\user\\Documents\\Отчёт.pdf\nC:\\Users\\user\\Documents\\Смета.xlsx", "C:\\Users\\user\\Documents\\Report.pdf\nC:\\Users\\user\\Documents\\Budget.xlsx"),
      "explorer.exe",
      now - 120 * min,
      false,
      sample("Отчёт.pdf, Смета.xlsx", "Report.pdf, Budget.xlsx"),
    ),
    clip(8, "text", "hello@example.com", "Notepad.exe", now - 300 * min, true),
    clip(9, "text", 'const [mode, setMode] = useState<IslandMode>("collapsed");', "Code.exe", now - 26 * 60 * min),
    clip(10, "link", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "msedge.exe", now - 50 * 60 * min),
  ];
  const notes: Note[] = [
    {
      id: 1,
      folder: "Заметка",
      title: sample("Идеи для острова", "Island ideas"),
      body: sample("<p>Блик за курсором, <b>живые активности</b> в пилюле, перетаскивание файлов на полку.</p>", "<p>Cursor highlight, <b>live activities</b> in the pill, drag files onto a shelf.</p>"),
      updatedAt: now - 15 * min,
    },
    {
      id: 2,
      folder: sample("Работа", "Work"),
      title: sample("План на неделю", "Plan for the week"),
      body: sample("<ul><li>Собрать каркас оболочки</li><li>Проверить acrylic на Windows 10</li><li>Написать тесты</li></ul>", "<ul><li>Build the shell</li><li>Check acrylic on Windows 10</li><li>Write tests</li></ul>"),
      updatedAt: now - 3 * 60 * min,
    },
    { id: 3, folder: "Заметка", title: sample("Список покупок", "Shopping list"), body: sample("<p>Молоко, кофе, USB-C кабель.</p>", "<p>Milk, coffee, USB-C cable.</p>"), updatedAt: now - 30 * 60 * min },
  ];
  return {
    trackIndex: 0,
    dock:["Terminal", "Documents", "Projects", "Sketches", "Notes"].map((name,index)=>({id:`dock-${index+1}`,name,path:`C:\\CCOTT\\${name}${index===0?".lnk":""}`,kind:index===0?"app" as const:"folder" as const,icon:makeCover(["#315a76","#706244","#42685c","#695584","#80575f"][index],"#272a32")})),
    nextDockId:6,
    media: mediaFor(0, now, "playing", 73_000),
    audio: { volume: 64, muted: false, device: devices[0] },
    devices,
    settings: {
      language: "auto",
      theme: "auto",
      vibrancy: "none",
      monitor: "primary",
      autostart: false,
      doNotDisturb: false,
      hoverExpandDelayMs: 120,
      hoverCollapseDelayMs: 350,
      hideInFullscreen: true,
      summonHotkey: "Ctrl+Alt+I",
      fullscreenAllowlist: [],
      autoHideApps: [...DEFAULT_AUTO_HIDE_APPS],
    },
    fullscreenApps: [
      { exe: "chrome.exe", title: "YouTube — Google Chrome", lastSeen: now - 60_000 },
      { exe: "cs2.exe", title: "Counter-Strike 2", lastSeen: now - 3_600_000 },
    ],
    maximizedApps: [
      { exe: "code.exe", title: "Visual Studio Code", lastSeen: now - 120_000 },
    ],
    update: null,
    clips,
    notes,
    nextClipId: 11,
    nextNoteId: 4,
  };
}

let state = createState();

/** Reset all mutable mock data and counters (tests). Listeners stay registered. */
export function resetMock(): void {
  state = createState();
  mockStats.shapeCalls = 0;
  mockStats.modeCalls = 0;
  mockStats.lastShape = null;
  mockStats.lastMode = null;
  mockStats.shapeTimestamps = [];
  mockStats.keyboardFocus = false;
  mockStats.keyboardFocusCalls = [];
  mockStats.lastPaste = null;
  mockStats.updaterChecks = 0;
  mockStats.updaterInstalls = 0;
  mockConfig.keyboardFocusDelayMs = 30;
  mockConfig.failKeyboardFocus = false;
  mockConfig.failHotkeyRegistration = false;
  mockConfig.captureOutcome = "success";
  mockConfig.qrText = "https://example.com/ccott";
  mockConfig.dockOpenError=false;
  clearTimeout(artworkTimer);
  artworkTimer = undefined;
  scheduleTrackEnd();
}

/** Real SMTC delivers the cover ~1.5 s after the track metadata. */
export const ARTWORK_DELAY_MS = 1500;
let artworkTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Switches to another track: `media://changed` first with `artwork: null`, then again with the cover
 * `ARTWORK_DELAY_MS` later (unless the track changed again meanwhile).
 */
function changeTrack(index: number): void {
  clearTimeout(artworkTimer);
  state.trackIndex = index;
  const track = TRACKS[index];
  setMedia({ ...mediaFor(index, Date.now(), "playing", 0), artwork: null });
  artworkTimer = setTimeout(() => {
    artworkTimer = undefined;
    if (state.trackIndex !== index || state.media.title !== track.title) return;
    state.media = { ...state.media, artwork: track.artwork };
    mockEmit("media://changed", state.media);
  }, ARTWORK_DELAY_MS);
}

/** The real player moves on by itself when a track ends; so does the mock (while "playing"). */
let trackEndTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleTrackEnd(): void {
  clearTimeout(trackEndTimer);
  trackEndTimer = undefined;
  const m = state.media;
  if (!m.hasSession || m.status !== "playing") return;
  const remaining = Math.max(0, m.durationMs - currentPosition(Date.now()));
  trackEndTimer = setTimeout(() => {
    changeTrack((state.trackIndex + 1) % TRACKS.length);
  }, remaining);
}

function setMedia(next: MediaState): void {
  state.media = next;
  mockEmit("media://changed", state.media);
  scheduleTrackEnd();
}

function currentPosition(now: number): number {
  const m = state.media;
  if (m.status !== "playing") return m.positionMs;
  return Math.min(m.durationMs, m.positionMs + (now - m.positionSampledAt));
}

function sortClips(items: ClipItem[]): ClipItem[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
}

// ───────────────────────────── command handlers ─────────────────────────────

type Handlers = {
  [C in CommandName]: (args: CommandArgs<C>) => CommandResult<C> | Promise<CommandResult<C>>;
};

const handlers: Handlers = {
  dock_list:()=>{mockEmit("dock://changed",state.dock);return state.dock;},
  dock_add:({paths})=>{
    const key=(p:string)=>p.replace(/\//g,"\\").replace(/\\+$/,"").toLowerCase();
    const keys=new Set(state.dock.map(i=>key(i.path)));
    const fresh=paths.filter(p=>{const k=key(p);if(keys.has(k))return false;keys.add(k);return true;});
    if(state.dock.length+fresh.length>12)throw new Error(t("dock.limit"));
    state.dock=[...state.dock,...fresh.map(path=>({id:`dock-${state.nextDockId++}`,path,name:path.split(/[\\/]/).filter(Boolean).slice(-1)[0]?.replace(/\.(exe|lnk|url)$/i,"")??path,kind:/\.(exe|lnk|url)$/i.test(path)?"app" as const:"folder" as const,icon:makeCover("#42685c","#272a32")}))];
    mockEmit("dock://changed",state.dock);return state.dock;
  },
  dock_remove:({id})=>{state.dock=state.dock.filter(i=>i.id!==id);mockEmit("dock://changed",state.dock);return state.dock;},
  dock_reorder:({ids})=>{if(ids.length!==state.dock.length||new Set(ids).size!==ids.length||ids.some(id=>!state.dock.some(i=>i.id===id)))throw new Error(t("dock.order"));state.dock=ids.map(id=>state.dock.find(i=>i.id===id)!);mockEmit("dock://changed",state.dock);return state.dock;},
  dock_open:({id})=>{if(mockConfig.dockOpenError||!state.dock.some(i=>i.id===id))throw new Error(t("dock.notFound"));},
  dock_start_drag: ({ id }) => {
    if (!state.dock.some((i) => i.id === id)) throw new Error(t("dock.notFound"));
  },
  island_set_shape: ({ shape }) => {
    mockStats.shapeCalls += 1;
    mockStats.lastShape = shape;
    mockStats.shapeTimestamps.push(typeof performance !== "undefined" ? performance.now() : Date.now());
    if (mockStats.shapeTimestamps.length > 2000) mockStats.shapeTimestamps.shift();
  },
  island_set_mode: ({ mode }) => {
    mockStats.modeCalls += 1;
    mockStats.lastMode = mode;
  },
  window_set_vibrancy: ({ mode }) => ({
    requested: mode,
    applied: "none",
    error: "Native blur is unavailable in the browser mock",
  }),
  window_list_monitors: () => [
    { id: "mon-1", name: sample("Основной монитор", "Main display"), width: 2560, height: 1440, scaleFactor: 1.25, isPrimary: true },
    { id: "mon-2", name: sample("Второй монитор", "Second display"), width: 1920, height: 1080, scaleFactor: 1, isPrimary: false },
  ],
  // Like R1: the call returns once the window is (de)activated (takes a few ms), a refusal rejects.
  // Unlike the earlier stub it does NOT echo `island://focus-changed` — Rust only emits that when focus is lost by itself
  // (see `mockLoseKeyboardFocus`).
  island_set_keyboard_focus: async ({ active }) => {
    mockStats.keyboardFocusCalls.push(active);
    if (mockConfig.keyboardFocusDelayMs > 0) await new Promise((r) => setTimeout(r, mockConfig.keyboardFocusDelayMs));
    if (active && mockConfig.failKeyboardFocus) throw new Error("Cannot acquire keyboard focus (mock)");
    mockStats.keyboardFocus = active;
  },

  window_recent_fullscreen_apps: () => state.fullscreenApps,
  window_recent_maximized_apps: () => mockRecentMaximizedApps(),
  settings_get: () => state.settings,
  settings_set: ({ patch }) => {
    const next: Settings = { ...state.settings, ...patch };
    if (patch.summonHotkey !== undefined) {
      const normalized = normalizeAccelerator(patch.summonHotkey);
      if (normalized && mockConfig.failHotkeyRegistration) {
        throw new Error(t("hotkey.registration", { shortcut: normalized }));
      }
      next.summonHotkey = normalized;
    }
    if (patch.fullscreenAllowlist !== undefined) {
      next.fullscreenAllowlist = normalizeFullscreenAllowlist(patch.fullscreenAllowlist);
    }
    if (patch.autoHideApps !== undefined) {
      next.autoHideApps = normalizeAutoHideApps(patch.autoHideApps);
    }
    next.hoverExpandDelayMs = Math.max(0, Math.min(1000, Math.round(next.hoverExpandDelayMs)));
    next.hoverCollapseDelayMs = Math.max(0, Math.min(2000, Math.round(next.hoverCollapseDelayMs)));
    state.settings = next;
    mockEmit("settings://changed", state.settings);
    return state.settings;
  },
  updater_check: () => {
    mockStats.updaterChecks += 1;
    if (state.update) mockEmit("updater://available", state.update);
    return state.update;
  },
  updater_install: () => {
    mockStats.updaterInstalls += 1;
  },

  media_get_state: () => state.media,
  media_action: ({ action }) => {
    const now = Date.now();
    if (!state.media.hasSession) return;
    if (action === "playPause") {
      const position = currentPosition(now);
      setMedia({
        ...state.media,
        status: state.media.status === "playing" ? "paused" : "playing",
        positionMs: position,
        positionSampledAt: now,
      });
    } else {
      const delta = action === "next" ? 1 : -1;
      changeTrack((state.trackIndex + delta + TRACKS.length) % TRACKS.length);
    }
  },
  media_seek: ({ positionMs }) => {
    setMedia({
      ...state.media,
      positionMs: Math.max(0, Math.min(state.media.durationMs, positionMs)),
      positionSampledAt: Date.now(),
    });
  },

  audio_get_state: () => state.audio,
  audio_set_volume: ({ volume }) => {
    state.audio = { ...state.audio, volume: Math.max(0, Math.min(100, Math.round(volume))) };
    mockEmit("audio://changed", state.audio);
  },
  audio_set_muted: ({ muted }) => {
    state.audio = { ...state.audio, muted };
    mockEmit("audio://changed", state.audio);
  },
  audio_list_devices: () => state.devices.map((d) => ({ ...d, isDefault: d.id === state.audio.device?.id })),
  audio_set_device: ({ id }) => {
    const device = state.devices.find((d) => d.id === id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    state.audio = { ...state.audio, device: { ...device, isDefault: true } };
    mockEmit("audio://changed", state.audio);
  },

  clipboard_list: ({ query, limit }) => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? state.clips.filter((c) => c.text.toLowerCase().includes(q) || c.sourceApp.toLowerCase().includes(q))
      : state.clips;
    return sortClips(filtered).slice(0, Math.max(0, limit));
  },
  clipboard_paste: ({ id, mode }) => {
    const item = state.clips.find((c) => c.id === id);
    if (!item) throw new Error(`Clipboard entry not found: ${id}`);
    mockStats.lastPaste = { id, mode };
    // The clipboard monitor sees the entry being written back and moves it to the top of the history.
    item.createdAt = Date.now();
    mockEmit("clipboard://changed", null);
  },
  clipboard_pin: ({ id, pinned }) => {
    const item = state.clips.find((c) => c.id === id);
    if (!item) throw new Error(`Clipboard entry not found: ${id}`);
    item.pinned = pinned;
    mockEmit("clipboard://changed", null);
  },
  clipboard_delete: ({ id }) => {
    state.clips = state.clips.filter((c) => c.id !== id);
    mockEmit("clipboard://changed", null);
  },
  clipboard_clear: ({ keepPinned }) => {
    state.clips = keepPinned ? state.clips.filter((c) => c.pinned) : [];
    mockEmit("clipboard://changed", null);
  },

  notes_list: () => [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt),
  capture_start: ({ mode, action }) => {
    if (mockConfig.captureOutcome === "cancel") return null;
    if (mockConfig.captureOutcome === "error") throw new Error(t("capture.error"));
    const width = mode === "region" ? 640 : 2560;
    const height = mode === "region" ? 360 : 1440;
    const textAction = action === "ocr" || action === "qr";
    const text = textAction ? mockConfig.captureOutcome === "empty" ? "" : action === "qr" ? mockConfig.qrText : "CCOTT OCR sample" : null;
    if (!textAction || text) mockCopy({ kind:textAction ? "text" : "image", text:text ?? "", preview:textAction ? text ?? "" : makeCover("#202020", "#444444"), sourceApp:"island-win.exe" });
    return { action, width, height, path:action === "save" ? "C:\\Users\\user\\Pictures\\Screenshots\\CCOTT\\CCOTT 2026-10-27 12-00-00.png" : null, text };
  },
  capture_open_folder: () => {},
  capture_pick_color: () => {
    if (mockConfig.captureOutcome === "cancel") return null;
    if (mockConfig.captureOutcome === "error") throw new Error(t("color.error"));
    mockCopy({kind:"text", text:"#336699", sourceApp:"island-win.exe"});
    return {hex:"#336699",r:51,g:102,b:153};
  },
  notes_save: ({ note }) => {
    const now = Date.now();
    if (note.id === null) {
      const created: Note = {
        id: state.nextNoteId++,
        folder: note.folder,
        title: note.title,
        body: note.body,
        updatedAt: now,
      };
      state.notes.push(created);
      return created;
    }
    const existing = state.notes.find((n) => n.id === note.id);
    if (!existing) throw new Error(`Note not found: ${note.id}`);
    Object.assign(existing, { folder: note.folder, title: note.title, body: note.body, updatedAt: now });
    return existing;
  },
  notes_delete: ({ id }) => {
    state.notes = state.notes.filter((n) => n.id !== id);
  },
};

/** Test/dev helper: add a clipboard entry as if the user copied something (emits `clipboard://added` + `changed`). */
export function mockCopy(partial: Pick<ClipItem, "kind" | "text"> & Partial<ClipItem>): ClipItem {
  const item: ClipItem = {
    id: state.nextClipId++,
    preview: partial.text.slice(0, 200),
    sourceApp: "",
    createdAt: Date.now(),
    pinned: false,
    ...partial,
  };
  state.clips.push(item);
  mockEmit("clipboard://added", item);
  mockEmit("clipboard://changed", null);
  return clone(item);
}

/** Test/dev helper: the user clicked another window while the island held the keyboard (Rust emits `island://focus-changed`). */
export function mockLoseKeyboardFocus(): void {
  if (!mockStats.keyboardFocus) return;
  mockStats.keyboardFocus = false;
  mockEmit("island://focus-changed", { active: false });
}

/** Test/dev helper: the tray item «Настройки» was clicked. */
export function mockOpenSettings(): void {
  mockEmit("island://open-settings", null);
}

/** Test/dev helper: the global summon hotkey was pressed (`island://summoned`). */
export function mockSummon(): void {
  mockEmit("island://summoned", null);
}

/** Test/dev helper: replaces the list returned by `window_recent_fullscreen_apps`. */
export function mockSetFullscreenApps(apps: FullscreenApp[]): void {
  state.fullscreenApps = clone(apps);
}

/** Returns the list of recently seen maximized apps (`window_recent_maximized_apps`). */
export function mockRecentMaximizedApps(): FullscreenApp[] {
  return clone(state.maximizedApps);
}

/** Test/dev helper: replaces the list returned by `window_recent_maximized_apps`. */
export function mockSetMaximizedApps(apps: FullscreenApp[]): void {
  state.maximizedApps = clone(apps);
}

/** Test/dev helper: replaces fields of the media state (e.g. `{ hasSession: false, status: "stopped" }`). */
export function mockSetMedia(patch: Partial<MediaState>): void {
  setMedia({ ...state.media, positionSampledAt: Date.now(), ...patch });
}

/** Test/dev helper: sets the update returned by `updater_check` (and optionally emits `updater://available`). */
export function mockSetUpdate(update: UpdateInfo | null, emit = false): void {
  state.update = update ? clone(update) : null;
  if (emit && state.update) mockEmit("updater://available", state.update);
}

if (typeof window !== "undefined") {
  const helpers: MockHelpers = {
    openSettings: mockOpenSettings,
    summon: mockSummon,
    copy: (text, kind = /^https?:\/\//.test(text) ? "link" : "text") => mockCopy({ kind, text, sourceApp: "chrome.exe" }),
    loseFocus: mockLoseKeyboardFocus,
    setMedia: mockSetMedia,
    setUpdate: mockSetUpdate,
    setFullscreenApps: mockSetFullscreenApps,
    config: mockConfig,
  };
  // The stats object stays the one on `window` (older checks read `__ISLAND_MOCK__.shapeCalls` etc.), helpers are added to it.
  (window as unknown as { __ISLAND_MOCK__?: MockStats & MockHelpers }).__ISLAND_MOCK__ = Object.assign(mockStats, helpers);
}

scheduleTrackEnd();

export async function mockInvoke<C extends CommandName>(cmd: C, args?: CommandArgs<C>): Promise<CommandResult<C>> {
  const handler = handlers[cmd] as ((a: CommandArgs<C>) => CommandResult<C> | Promise<CommandResult<C>>) | undefined;
  if (!handler) throw new Error(`mock: unknown command ${String(cmd)}`);
  const result = await handler(clone((args ?? {}) as CommandArgs<C>));
  return clone(result);
}
