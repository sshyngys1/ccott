// Media (SMTC) state shared by the «Главная» tab and its pill activity. One subscription to `media://changed`.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { invoke } from "../../ipc";
import type { MediaAction, MediaState } from "../../shared/types";
import { createEventSync } from "../ipcSync";
import { EMPTY_MEDIA, PAUSE_GRACE_MS, extrapolatePosition, isMediaActive, sameTrack } from "./progress";

export interface MediaStore {
  media: MediaState;
  /** Epoch ms when the current pause started (null while playing / unknown). Drives the 30 s grace in the pill. */
  pausedSince: number | null;
  /** Merge a state coming from Rust. `fromLoad` = the very first snapshot (a session that is already paused does not flash in the pill). */
  applyState: (next: MediaState, fromLoad?: boolean) => void;
  playPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
}

export const useMediaStore = create<MediaStore>()((set, get) => ({
  media: EMPTY_MEDIA,
  pausedSince: null,

  applyState: (incoming, fromLoad = false) => {
    const prev = get().media;
    let next = incoming;
    // The artwork arrives ~1.5 s after the track metadata: keep the previous cover for the same track meanwhile.
    if (next.artwork === null && prev.artwork !== null && sameTrack(prev, next)) next = { ...next, artwork: prev.artwork };
    let pausedSince = get().pausedSince;
    if (next.status === "paused") {
      if (prev.status !== "paused" || !prev.hasSession) pausedSince = fromLoad ? 0 : Date.now();
    } else {
      pausedSince = null;
    }
    set({ media: next, pausedSince });
  },

  playPause: async () => {
    const m = get().media;
    if (!m.hasSession || !m.canPlayPause) return;
    const now = Date.now();
    // Optimistic flip; the backend event confirms (or corrects) it.
    get().applyState({ ...m, status: m.status === "playing" ? "paused" : "playing", positionMs: extrapolatePosition(m, now), positionSampledAt: now });
    await run("playPause");
  },
  next: () => run("next"),
  previous: () => run("previous"),

  seek: async (positionMs) => {
    const m = get().media;
    if (!m.hasSession || !m.canSeek) return;
    const target = Math.max(0, Math.min(m.durationMs || positionMs, Math.round(positionMs)));
    set({ media: { ...m, positionMs: target, positionSampledAt: Date.now() } });
    try {
      await invoke("media_seek", { positionMs: target });
    } catch (err) {
      console.warn("[island] media_seek failed", err);
      void sync.init();
    }
  },
}));

async function run(action: MediaAction): Promise<void> {
  try {
    await invoke("media_action", { action });
  } catch (err) {
    console.warn(`[island] media_action(${action}) failed`, err);
    try {
      useMediaStore.getState().applyState(await invoke("media_get_state"));
    } catch {
      /* the next media://changed will fix it */
    }
  }
}

const sync = createEventSync({
  event: "media://changed",
  load: () => invoke("media_get_state"),
  apply: (state, source) => useMediaStore.getState().applyState(state, source === "load"),
});

/** Idempotent: subscribes to `media://changed` and loads the current state once. */
export const initMedia = (): Promise<void> => sync.init();

/** Tests: drop the subscription and the state. */
export function resetMediaStore(): void {
  sync.reset();
  useMediaStore.setState({ media: EMPTY_MEDIA, pausedSince: null });
}

/** Hook for the tab: starts the sync and returns the media state. */
export function useMedia(): MediaState {
  useEffect(() => {
    void initMedia();
  }, []);
  return useMediaStore((s) => s.media);
}

/** Position (ms), re-extrapolated every `intervalMs` while playing. */
export function useMediaPosition(intervalMs = 250): number {
  const media = useMediaStore((s) => s.media);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (media.status !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [media, intervalMs]);
  return extrapolatePosition(media, now);
}

/** `compact.useIsActive` of the media activity: playing, or paused for less than 30 s. */
export function useIsMediaActive(): boolean {
  useEffect(() => {
    void initMedia();
  }, []);
  const media = useMediaStore((s) => s.media);
  const pausedSince = useMediaStore((s) => s.pausedSince);
  const [, force] = useState(0);
  useEffect(() => {
    if (media.status !== "paused" || pausedSince === null) return;
    const wait = pausedSince + PAUSE_GRACE_MS - Date.now();
    if (wait <= 0) return;
    const id = window.setTimeout(() => force((n) => n + 1), wait + 5);
    return () => window.clearTimeout(id);
  }, [media.status, pausedSince]);
  return isMediaActive(media, pausedSince, Date.now());
}
