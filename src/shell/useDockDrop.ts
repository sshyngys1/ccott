import { useEffect } from "react";
import { t } from "../i18n";
import { listenDockDrop, type DockDrop } from "../ipc/dock";
import { addDockPaths, useDockStore } from "../lib/dock/store";
import { isFeatureEnabled, useFeatureEnabled } from "../lib/features";
import { addShelfPaths, useShelfStore } from "../modules/shelf/store";
import { useIslandStore } from "../store";
import type { HoverControls } from "../store/useHoverSync";
import {
  checkDockAcceptable,
  resetDropChoice,
  setDropChoiceHover,
  startDropChoice,
  useDropChoiceStore,
  type DropChoiceZone,
} from "./dropChoice/store";
import { showToast } from "./toast";

/** Hit-tests physical coordinates against the two drop-choice cards. */
export function dropChoiceZoneFromPosition(position?: { x: number; y: number }): DropChoiceZone | null {
  if (!position) return null;
  const x = position.x / window.devicePixelRatio;
  const y = position.y / window.devicePixelRatio;

  const dockEl = document.querySelector("[data-drop-zone='dock']");
  if (dockEl) {
    const r = dockEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return "dock";
    }
  }

  const shelfEl = document.querySelector("[data-drop-zone='shelf']");
  if (shelfEl) {
    const r = shelfEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return "shelf";
    }
  }

  return null;
}

/** Tauri coordinates are physical client pixels; DOM rectangles use CSS pixels. */
export function dropZone(position?: { x: number; y: number }): "shelf" | "dock" | null {
  const state = useIslandStore.getState();
  const shelfEnabled = isFeatureEnabled("shelf", state.settings.disabledFeatures);
  const dockEnabled = isFeatureEnabled("dock", state.settings.disabledFeatures);
  if (state.mode !== "expanded") return shelfEnabled ? "shelf" : null;
  if (state.view !== "tabs") return null;
  if (!position) {
    if (state.activeTab === "shelf") return shelfEnabled ? "shelf" : null;
    if (state.activeTab === "home") return dockEnabled ? "dock" : null;
    return null;
  }
  const x = position.x / window.devicePixelRatio, y = position.y / window.devicePixelRatio;
  const within = (selector: string) => Array.from(document.querySelectorAll(selector)).some(el => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (shelfEnabled && within("#ig-tab-shelf, [data-shelf-drop='true']")) return "shelf";
  return dockEnabled && state.activeTab === "home" && within(".hm-dock") ? "dock" : null;
}

export async function handleDockDrop(event: DockDrop, controls: HoverControls): Promise<void> {
  if (useDockStore.getState().outgoing) return;
  const reset = () => {
    useShelfStore.setState({ dropTarget: null });
    useDockStore.setState({ dragging: false });
    resetDropChoice();
  };
  const isDropChoiceActive = useDropChoiceStore.getState().active;

  if (event.type === "leave") {
    if (isDropChoiceActive) {
      reset();
      controls.collapseNow();
      return;
    }
    reset();
    return;
  }

  const state = useIslandStore.getState();
  const shelfEnabled = isFeatureEnabled("shelf", state.settings.disabledFeatures);
  const dockEnabled = isFeatureEnabled("dock", state.settings.disabledFeatures);
  const collapsed = state.mode !== "expanded";

  // When files enter the collapsed pill and both features are enabled -> drop choice mode (§22, v0.4)
  const shouldEnterDropChoice = (collapsed || isDropChoiceActive) && shelfEnabled && dockEnabled;

  if (shouldEnterDropChoice) {
    if (!isDropChoiceActive) {
      startDropChoice(event.paths ?? []);
      controls.expandNow();
    } else if (event.paths?.length) {
      useDropChoiceStore.setState({ paths: event.paths });
    }

    const choiceTarget = event.position ? dropChoiceZoneFromPosition(event.position) : null;
    if (event.position) {
      setDropChoiceHover(choiceTarget);
    }

    if (event.type === "drop") {
      try {
        const finalTarget = choiceTarget ?? useDropChoiceStore.getState().hoveredZone;
        const currentPaths = event.paths ?? useDropChoiceStore.getState().paths;
        if (finalTarget === "shelf") {
          await addShelfPaths(currentPaths);
        } else if (finalTarget === "dock") {
          const check = checkDockAcceptable(currentPaths);
          if (check.ok) {
            await addDockPaths(currentPaths);
          }
        }
      } finally {
        reset();
        controls.collapseNow();
      }
    }
    return;
  }

  // Single feature enabled or expanded island: previous behavior (§22, §23)
  const pill = shelfEnabled && (useShelfStore.getState().dropTarget === "pill" || collapsed);
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
      else if (target === "dock") await addDockPaths(event.paths ?? []);
      else if (collapsed && !shelfEnabled && dockEnabled && (event.paths?.length ?? 0) > 0) {
        showToast({ label: t("shelf.disabledToast") });
      }
    } finally { reset(); }
  }
}

export function useDockDrop(controls: HoverControls) {
  const shelfEnabled = useFeatureEnabled("shelf");
  const dockEnabled = useFeatureEnabled("dock");
  const anyDropEnabled = shelfEnabled || dockEnabled;

  useEffect(() => {
    if (!shelfEnabled) {
      if (useShelfStore.getState().dropTarget !== null) {
        useDockStore.setState({ dragging: false });
      }
      useShelfStore.setState({ dropTarget: null });
    }
  }, [shelfEnabled]);

  useEffect(() => {
    if (!dockEnabled && useShelfStore.getState().dropTarget === null) {
      useDockStore.setState({ dragging: false });
    }
  }, [dockEnabled]);

  useEffect(() => {
    if (!anyDropEnabled) {
      useShelfStore.setState({ dropTarget: null });
      useDockStore.setState({ dragging: false });
      resetDropChoice();
      return;
    }
    let disposed = false;
    let unlisten = () => {};
    const offMode = useIslandStore.subscribe(state => {
      const liveShelfEnabled = isFeatureEnabled("shelf", state.settings.disabledFeatures);
      const liveDockEnabled = isFeatureEnabled("dock", state.settings.disabledFeatures);
      if ((!liveShelfEnabled || !liveDockEnabled) && useDropChoiceStore.getState().active) {
        resetDropChoice();
        controls.collapseNow();
      }
      if (!liveShelfEnabled && useShelfStore.getState().dropTarget !== null) {
        useShelfStore.setState({ dropTarget: null });
        useDockStore.setState({ dragging: false });
      }
      if (!liveDockEnabled && useShelfStore.getState().dropTarget === null && useDockStore.getState().dragging) {
        useDockStore.setState({ dragging: false });
      }
      if (liveShelfEnabled && state.mode === "expanded" && useShelfStore.getState().dropTarget === "pill") {
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
      resetDropChoice();
    };
  }, [controls, anyDropEnabled]);
}
