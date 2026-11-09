// Owner: F1. Wires `island://hover` → HoverMachine → store.mode.
import { useEffect, useMemo, useRef } from "react";
import { listen } from "../ipc";
import { HoverMachine } from "./hover";
import { useIslandStore } from "./index";
import { useDockStore } from "../lib/dock/store";
import { useTilesEditStore } from "../lib/tiles/store";
import { useTabsEditStore } from "../shell/tabs/store";
const noop = () => {
};
export interface HoverControls {
  expandNow: () => void;
  collapseNow: () => void;
  /** Global hotkey: expand and stay open although the cursor is elsewhere (see `HoverMachine.summon`). */
  summon: () => void;
}
export function useHoverSync(): HoverControls {
  const machineRef = useRef<HoverMachine | null>(null);
  useEffect(() => {
    const initial = useIslandStore.getState();
    const machine = new HoverMachine({
      expandDelayMs: initial.hoverExpandDelayMs,
      collapseDelayMs: initial.hoverCollapseDelayMs,
      initialMode: initial.mode,
      onChange: (mode) => useIslandStore.getState().setMode(mode),
      onSuppressChange: (suppressed) => useIslandStore.getState().setHoverSuppressed(suppressed),
    });
    const syncHold = () => {
      const dock = useDockStore.getState();
      const island = useIslandStore.getState();
      const tabsEdit = useTabsEditStore.getState();
      const tilesEdit = useTilesEditStore.getState();
      // The command bar and active edit modes stay open with the cursor elsewhere until Esc/explicit exit.
      machine.setHold(
        island.keyboardFocus ||
          island.view === "cmd" ||
          dock.dragging ||
          dock.interacting ||
          tabsEdit.editing ||
          tabsEdit.menuOpen ||
          tilesEdit.editing,
      );
    };
    syncHold();
    machineRef.current = machine;
    const unsubscribeStore = useIslandStore.subscribe((s, prev) => {
      if (s.hoverExpandDelayMs !== prev.hoverExpandDelayMs || s.hoverCollapseDelayMs !== prev.hoverCollapseDelayMs) {
        machine.setDelays(s.hoverExpandDelayMs, s.hoverCollapseDelayMs);
      }
      // Typing in a field (keyboard focus) keeps the island open even when the cursor leaves.
      if (s.keyboardFocus !== prev.keyboardFocus || s.view !== prev.view)
        syncHold();
    });
    const offDock = useDockStore.subscribe(syncHold);
    const offTabsEdit = useTabsEditStore.subscribe(syncHold);
    const offTilesEdit = useTilesEditStore.subscribe(syncHold);
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen("island://hover", ({ inside }) => {
      useIslandStore.getState().setHoverInside(inside);
      machine.setInside(inside);
    }).then((u) => {
      if (disposed)
        u();
      else
        unlisten = u;
    }, noop);
    return () => {
      disposed = true;
      unlisten?.();
      unsubscribeStore();
      offDock();
      offTabsEdit();
      offTilesEdit();
      machine.dispose();
      machineRef.current = null;
    };
  }, []);
  return useMemo(() => ({
    expandNow: () => machineRef.current?.expandNow(),
    collapseNow: () => machineRef.current?.collapseNow(),
    summon: () => machineRef.current?.summon(),
  }), []);
}
