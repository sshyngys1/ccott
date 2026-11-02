import { useEffect } from "react";
import { listenDockDrop, type DockDrop } from "../ipc/dock";
import { addDockPaths, useDockStore } from "../lib/dock/store";
import { addShelfPaths, useShelfStore } from "../modules/shelf/store";
import { useIslandStore } from "../store";
import type { HoverControls } from "../store/useHoverSync";

/** Tauri coordinates are physical client pixels; DOM rectangles use CSS pixels. */
export function dropZone(position?: { x: number; y: number }): "shelf" | "dock" | null {
  const state = useIslandStore.getState();
  if (state.mode !== "expanded") return "shelf";
  if (state.view !== "tabs") return null;
  if (!position) return state.activeTab === "shelf" ? "shelf" : state.activeTab === "home" ? "dock" : null;
  const x = position.x / window.devicePixelRatio, y = position.y / window.devicePixelRatio;
  const within = (selector: string) => Array.from(document.querySelectorAll(selector)).some(el => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (within("#ig-tab-shelf, [data-shelf-drop='true']")) return "shelf";
  return state.activeTab === "home" && within(".hm-dock") ? "dock" : null;
}

export async function handleDockDrop(event: DockDrop, controls: HoverControls): Promise<void> {
  if (useDockStore.getState().outgoing) return;
  const reset = () => {
    useShelfStore.setState({ dropTarget: null });
    useDockStore.setState({ dragging: false });
  };
  if (event.type === "leave") { reset(); return; }
  const pill = useShelfStore.getState().dropTarget === "pill" || useIslandStore.getState().mode !== "expanded";
  const target = pill ? "shelf" : dropZone(event.position);
  if (target === "shelf") {
    useShelfStore.setState({ dropTarget: pill ? "pill" : "shelf" });
    useDockStore.setState({ dragging: true });
    if (pill) controls.collapseNow();
  } else {
    useShelfStore.setState({ dropTarget: null });
    useDockStore.setState({ dragging: target === "dock" });
  }
  if (event.type === "drop") {
    try {
      if (target === "shelf") await addShelfPaths(event.paths ?? []);
      if (target === "dock") await addDockPaths(event.paths ?? []);
    } finally { reset(); }
  }
}

export function useDockDrop(controls: HoverControls) {
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const offMode = useIslandStore.subscribe(state => {
      if (state.mode === "expanded" && useShelfStore.getState().dropTarget === "pill") {
        controls.collapseNow();
        // External mode changes may precede the hover machine's own transition.
        useIslandStore.getState().setMode("collapsed");
      }
    });
    listenDockDrop(event => { void handleDockDrop(event, controls); }).then(off => {
      if (disposed) off(); else unlisten = off;
    }, () => console.warn("[island] file drop subscription failed"));
    return () => {
      disposed = true; unlisten(); offMode();
      useShelfStore.setState({ dropTarget: null });
      useDockStore.setState({ dragging: false });
    };
  }, [controls]);
}
