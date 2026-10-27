// Owner: F1. Global UI state of the shell (Zustand).
import { create } from "zustand";
import type { IslandMode, ModuleId, Settings, ThemeMode, UpdateInfo, VibrancyMode } from "../shared/types";
import { DEFAULT_COLLAPSE_DELAY_MS, DEFAULT_EXPAND_DELAY_MS } from "./hover";

export type ResolvedTheme = "light" | "dark";

/** What the expanded panel shows: the module tabs or the settings view (spec §6.8). */
export type PanelView = "tabs" | "settings";

/** Values used until `settings_get` answers (equal to the Rust defaults). */
export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  vibrancy: "none",
  monitor: "primary",
  autostart: false,
  doNotDisturb: false,
  hoverExpandDelayMs: DEFAULT_EXPAND_DELAY_MS,
  hoverCollapseDelayMs: DEFAULT_COLLAPSE_DELAY_MS,
  hideInFullscreen: true,
  summonHotkey: "Ctrl+Alt+I",
  fullscreenAllowlist: [],
};

export interface PillToast {
  /** Unique per toast, so a new one restarts the hold timer. */
  id: number;
  /** Bold text, e.g. «Скопировано». */
  label: string;
  /** Secondary text after the label (copied text); empty for plain messages. */
  preview: string;
}

export interface IslandState {
  mode: IslandMode;
  activeTab: ModuleId;
  /** Tabs or the settings view; the settings view is reset to tabs whenever the island collapses. */
  view: PanelView;
  /** The island window holds keyboard focus (a text field is being edited): hover must not collapse it. */
  keyboardFocus: boolean;
  /** Last known settings (defaults until loaded). Theme mode, hover delays and DND below are derived from it. */
  settings: Settings;
  /** Cursor is inside the island (from `island://hover`). */
  hoverInside: boolean;
  /** What native blur is actually applied (`VibrancyResult.applied`). */
  vibrancy: VibrancyMode;
  /** Resolved theme written to `<html data-theme>`. */
  theme: ResolvedTheme;
  /** Theme preference from settings (auto → follow prefers-color-scheme). */
  themeMode: ThemeMode;
  hoverExpandDelayMs: number;
  hoverCollapseDelayMs: number;
  /** Do-not-disturb: no «Скопировано» toasts in the pill. */
  doNotDisturb: boolean;
  /** «Скопировано» toast shown in the pill (from `clipboard://added`), or null. */
  toast: PillToast | null;
  /** Latest update discovered via `updater://available` or `updater_check`. */
  availableUpdate: UpdateInfo | null;
  /** Version for which the one-time «Доступно обновление» toast has already been shown. */
  updateToastShownFor: string | null;

  setToast: (toast: PillToast | null) => void;
  setAvailableUpdate: (update: UpdateInfo | null) => void;
  markUpdateToastShown: (version: string) => void;
  setMode: (mode: IslandMode) => void;
  setActiveTab: (tab: ModuleId) => void;
  setView: (view: PanelView) => void;
  setKeyboardFocus: (active: boolean) => void;
  /** Stores a full Settings snapshot and derives theme mode, hover delays and DND from it. */
  applySettings: (settings: Settings) => void;
  setHoverInside: (inside: boolean) => void;
  setVibrancy: (vibrancy: VibrancyMode) => void;
  setTheme: (theme: ResolvedTheme) => void;
}

const initialState = () => ({
  mode: "collapsed" as IslandMode,
  activeTab: "home" as ModuleId,
  view: "tabs" as PanelView,
  keyboardFocus: false,
  settings: DEFAULT_SETTINGS,
  hoverInside: false,
  vibrancy: "none" as VibrancyMode,
  theme: "dark" as ResolvedTheme,
  themeMode: "auto" as ThemeMode,
  hoverExpandDelayMs: DEFAULT_EXPAND_DELAY_MS,
  hoverCollapseDelayMs: DEFAULT_COLLAPSE_DELAY_MS,
  doNotDisturb: false,
  toast: null as PillToast | null,
  availableUpdate: null as UpdateInfo | null,
  updateToastShownFor: null as string | null,
});

export const useIslandStore = create<IslandState>()((set) => ({
  ...initialState(),

  setToast: (toast) => set({ toast }),
  setAvailableUpdate: (availableUpdate) => set({ availableUpdate }),
  markUpdateToastShown: (version) => set({ updateToastShownFor: version }),
  setMode: (mode) => set((s) => (mode === "collapsed" && s.view !== "tabs" ? { mode, view: "tabs" } : { mode })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setView: (view) => set({ view }),
  setKeyboardFocus: (keyboardFocus) => set({ keyboardFocus }),
  applySettings: (settings) =>
    set((s) => ({
      settings,
      themeMode: settings.theme,
      hoverExpandDelayMs: settings.hoverExpandDelayMs,
      hoverCollapseDelayMs: settings.hoverCollapseDelayMs,
      doNotDisturb: settings.doNotDisturb,
      // DND switched on while a toast is visible: drop it right away.
      toast: settings.doNotDisturb ? null : s.toast,
    })),
  setHoverInside: (hoverInside) => set({ hoverInside }),
  setVibrancy: (vibrancy) => set({ vibrancy }),
  setTheme: (theme) => set({ theme }),
}));

/** Reset to initial values (tests). */
export function resetIslandStore(): void {
  useIslandStore.setState(initialState());
}
