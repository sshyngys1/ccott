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
export function useShellBus(controls: HoverControls, releaseKeyboard: () => Promise<void>, tabs: readonly IslandModule[], prepareExpand: () => Promise<void>): void {
  useEffect(() => {
    const deps: ShellBusDeps = {
      controls,
      releaseKeyboard,
      hasTab: (tab) => tabs.some((m) => m.id === tab),
    };
    let generation = 0;
    let pendingSummon = false;
    const cancelSummon = () => {
      generation++;
      pendingSummon = false;
    };
    const offBus = onShellRequest((req) => {
      if (req.type !== "toast") cancelSummon();
      return handleShellRequest(req, deps);
    });
    const offMode = useIslandStore.subscribe((state, previous) => {
      if (state.mode !== previous.mode) cancelSummon();
    });

    let disposed = false;
    let unlistenSettings: () => void = noop;
    let unlistenSummoned: () => void = noop;
    listen("island://open-settings", () => {
      cancelSummon();
      openSettings(controls);
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenSettings = u;
      },
      noop,
    );
    listen("island://summoned", () => {
      if (pendingSummon) {
        cancelSummon();
        controls.collapseNow();
      } else if (useIslandStore.getState().mode === "expanded") {
        void handleSummoned(controls, releaseKeyboard);
      } else {
        pendingSummon = true;
        const request = ++generation;
        void prepareExpand().then(() => {
          if (disposed || generation !== request) return;
          pendingSummon = false;
          controls.summon();
        });
      }
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenSummoned = u;
      },
      noop,
    );
    return () => {
      disposed = true;
      cancelSummon();
      offBus();
      offMode();
      unlistenSettings();
      unlistenSummoned();
    };
  }, [controls, releaseKeyboard, tabs, prepareExpand]);
}
