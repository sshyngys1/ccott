// Owner: F1. Shell-side handling of module → shell requests (src/shared/shellBus.ts), `island://open-settings` and `island://summoned`.
import { useEffect } from "react";
import { listen } from "../ipc";
import { onShellRequest, type ShellRequest } from "../shared/shellBus";
import type { IslandModule, ModuleId } from "../shared/types";
import { useIslandStore } from "../store";
import { showToast } from "./toast";
import type { HoverControls } from "../store/useHoverSync";

const noop = () => {};

export interface ShellBusDeps {
  controls: HoverControls;
  /** Release the keyboard focus (blur + `island_set_keyboard_focus(false)`). */
  releaseKeyboard: () => Promise<void>;
  hasTab: (tab: ModuleId) => boolean;
}

/** `collapse` → collapse now and release the keyboard; `openTab` → expand and show that tab; `toast` → pill toast. */
export function handleShellRequest(req: ShellRequest, deps: ShellBusDeps): void | Promise<void> {
  const store = useIslandStore.getState();
  switch (req.type) {
    case "collapse": {
      const released = deps.releaseKeyboard();
      deps.controls.collapseNow();
      return released;
    }
    case "toast":
      showToast({ label: req.text });
      break;
    case "openTab":
      if (deps.hasTab(req.tab)) store.setActiveTab(req.tab);
      store.setView("tabs");
      deps.controls.expandNow();
      break;
  }
}

/** Opens the settings view and expands the island (tray «Настройки»). */
export function openSettings(controls: HoverControls): void {
  useIslandStore.getState().setView("settings");
  controls.expandNow();
}

/** Toggles the island when `island://summoned` arrives from the global hotkey: expand if collapsed, collapse if expanded. */
export function handleSummoned(controls: HoverControls, releaseKeyboard: () => Promise<void>): void | Promise<void> {
  if (useIslandStore.getState().mode === "expanded") {
    const released = releaseKeyboard();
    controls.collapseNow();
    return released;
  }
  controls.summon();
}

/** Subscribes once to the shell bus, `island://open-settings` and `island://summoned`. All arguments must be referentially stable. */
export function useShellBus(controls: HoverControls, releaseKeyboard: () => Promise<void>, tabs: readonly IslandModule[]): void {
  useEffect(() => {
    const deps: ShellBusDeps = {
      controls,
      releaseKeyboard,
      hasTab: (tab) => tabs.some((m) => m.id === tab),
    };
    const offBus = onShellRequest((req) => handleShellRequest(req, deps));

    let disposed = false;
    let unlistenSettings: () => void = noop;
    let unlistenSummoned: () => void = noop;
    listen("island://open-settings", () => openSettings(controls)).then(
      (u) => {
        if (disposed) u();
        else unlistenSettings = u;
      },
      noop,
    );
    listen("island://summoned", () => {
      void handleSummoned(controls, releaseKeyboard);
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenSummoned = u;
      },
      noop,
    );
    return () => {
      disposed = true;
      offBus();
      unlistenSettings();
      unlistenSummoned();
    };
  }, [controls, releaseKeyboard, tabs]);
}
