// Owner: F1. Shell-side handling of module → shell requests (src/shared/shellBus.ts) and `island://summoned`.
import { useEffect } from "react";
import { listen } from "../ipc";
import { onShellRequest, type ShellRequest } from "../shared/shellBus";
import type { IslandModule, ModuleId } from "../shared/types";
import { useIslandStore } from "../store";
import { showToast } from "./toast";
import type { HoverControls } from "../store/useHoverSync";
import { useHotkeyFallbackToast } from "./hotkeys";

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
    case "openCommand":
      store.setView("cmd");
      deps.controls.expandNow();
      break;
    case "collapse": {
      const released = deps.releaseKeyboard();
      deps.controls.collapseNow();
      return released;
    }
    case "toast":
      showToast({ label: req.text, actions: req.actions });
      break;
    case "openTab":
      if (deps.hasTab(req.tab)) store.setActiveTab(req.tab);
      store.setView("tabs");
      deps.controls.expandNow();
      break;
  }
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

/** Subscribes once to the shell bus and `island://summoned`. All arguments must be referentially stable. */
export function useShellBus(controls: HoverControls, releaseKeyboard: () => Promise<void>, tabs: readonly IslandModule[], prepareExpand: () => Promise<void>): void {
  useHotkeyFallbackToast(controls);
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
    let unlistenSummoned: () => void = noop;
    let unlistenCmdOpen: () => void = noop;
    let unlistenFocus: () => void = noop;
    listen("cmd://open", () => {
      cancelSummon();
      const state = useIslandStore.getState();
      if (state.mode === "expanded" && state.view === "cmd") {
        void releaseKeyboard();
        controls.collapseNow();
      } else {
        state.setView("cmd");
        controls.expandNow();
      }
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenCmdOpen = u;
      },
      noop,
    );
    // The command bar is held open regardless of the cursor; another window taking focus closes it.
    listen("island://focus-changed", ({ active }) => {
      const state = useIslandStore.getState();
      if (!active && state.mode === "expanded" && state.view === "cmd") controls.collapseNow();
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenFocus = u;
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
      unlistenSummoned();
      unlistenCmdOpen();
      unlistenFocus();
    };
  }, [controls, releaseKeyboard, tabs, prepareExpand]);
}
