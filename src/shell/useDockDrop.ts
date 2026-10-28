import { useEffect } from "react";
import { listenDockDrop, type DockDrop } from "../ipc/dock";
import { addDockPaths, useDockStore } from "../lib/dock/store";
import { useIslandStore } from "../store";
import type { HoverControls } from "../store/useHoverSync";

export async function handleDockDrop(event: DockDrop, controls: HoverControls): Promise<void> {
  if (useDockStore.getState().outgoing)
    return;
  if (event.type === "leave") {
    useDockStore.setState({ dragging: false });
    return;
  }
  if (event.type === "enter" || event.type === "over" || event.type === "drop") {
    useDockStore.setState({ dragging: true });
    useIslandStore.getState().setView("tabs");
    useIslandStore.getState().setActiveTab("home");
    controls.expandNow();
  }
  if (event.type === "drop") {
    try {
      await addDockPaths(event.paths ?? []);
    }
    finally {
      useDockStore.setState({ dragging: false });
    }
  }
}

export function useDockDrop(controls: HoverControls) {
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listenDockDrop(event => {
      void handleDockDrop(event, controls);
    }).then(off => {
      if (disposed)
        off();
      else
        unlisten = off;
    }, error => console.warn("[dock] drop subscription failed", error));
    return () => {
      disposed = true;
      unlisten();
      useDockStore.setState({ dragging: false });
    };
  }, [controls]);
}
