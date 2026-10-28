import { useEffect } from "react";
import { listen } from "../ipc";
import { deferredTabs } from "../modules/registry";
import { useIslandStore } from "../store";
import { settingsScreen } from "./settings/deferred";

export const backgroundScreens = [...deferredTabs, settingsScreen];

/** Import one screen per idle turn, after the first paint and outside island transitions. */
export function scheduleScreenPreload(screens = backgroundScreens): () => void {
  let stopped = false;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let next = 0;
  let lastActivity = performance.now();
  let unlisten = () => {};
  const offStore = useIslandStore.subscribe((state, previous) => {
    if (state.mode !== previous.mode || state.hoverInside !== previous.hoverInside) {
      lastActivity = performance.now();
    }
  });
  void listen("island://prewarm", () => { lastActivity = performance.now(); }).then((off) => {
    if (stopped) off();
    else unlisten = off;
  }, () => {});

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    clearTimeout(timer);
    offStore();
    unlisten();
  };

  const scheduleIdle = () => {
    if (stopped) return;
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(loadNext, { timeout: 2000 });
    } else {
      timer = setTimeout(loadNext, 0);
    }
  };

  const loadNext = () => {
    idle = undefined;
    if (stopped) return;
    const quietFor = performance.now() - lastActivity;
    if (quietFor < 750) {
      timer = setTimeout(scheduleIdle, 750 - quietFor);
      return;
    }
    const screen = screens[next++];
    if (!screen) {
      stop();
      return;
    }
    void screen.preload().catch((error: unknown) => {
      console.warn("[island] background screen preload failed", error);
    }).finally(() => {
      if (stopped) return;
      if (next === screens.length) stop();
      else scheduleIdle();
    });
  };

  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      frame = undefined;
      timer = setTimeout(scheduleIdle, 1500);
    });
  });
  return stop;
}

export function useScreenPreload(): void {
  useEffect(() => scheduleScreenPreload(), []);
}
