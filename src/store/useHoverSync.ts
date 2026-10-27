// Owner: F1. Wires `island://hover` → HoverMachine → store.mode.
import { useEffect, useMemo, useRef } from "react";
import { listen } from "../ipc";
import { HoverMachine } from "./hover";
import { useIslandStore } from "./index";

const noop = () => {};

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
    });
    machine.setHold(initial.keyboardFocus);
    machineRef.current = machine;

    const unsubscribeStore = useIslandStore.subscribe((s, prev) => {
      if (s.hoverExpandDelayMs !== prev.hoverExpandDelayMs || s.hoverCollapseDelayMs !== prev.hoverCollapseDelayMs) {
        machine.setDelays(s.hoverExpandDelayMs, s.hoverCollapseDelayMs);
      }
      // Typing in a field (keyboard focus) keeps the island open even when the cursor leaves.
      if (s.keyboardFocus !== prev.keyboardFocus) machine.setHold(s.keyboardFocus);
    });

    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen("island://hover", ({ inside }) => {
      useIslandStore.getState().setHoverInside(inside);
      machine.setInside(inside);
    }).then(
      (u) => {
        if (disposed) u();
        else unlisten = u;
      },
      noop,
    );

    return () => {
      disposed = true;
      unlisten?.();
      unsubscribeStore();
      machine.dispose();
      machineRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      expandNow: () => machineRef.current?.expandNow(),
      collapseNow: () => machineRef.current?.collapseNow(),
      summon: () => machineRef.current?.summon(),
    }),
    [],
  );
}
