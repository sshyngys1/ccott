// Media (SMTC) state shared by the «Главная» tab and its pill activity. One subscription to `media://changed`.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { invoke } from "../../ipc";
import type { MediaAction, MediaState } from "../../shared/types";
import { createEventSync } from "../ipcSync";
import { useDocumentVisible } from "../useDocumentVisible";
import { EMPTY_MEDIA, PAUSE_GRACE_MS, extrapolatePosition, isMediaActive, sameTrack } from "./progress";

export interface MediaStore {
  media: MediaState;
  /** Epoch ms when the current pause started (null while playing / unknown). Drives the 30 s grace in the pill. */
  pausedSince: number | null;
  /** Merge a state coming from Rust. `fromLoad` = the very first snapshot (a session that is already paused does not flash in the pill).
   *  `gapExpired` (internal) = a held "no track" state is applied after {@link TRACK_GAP_MS}. */
  applyState: (next: MediaState, fromLoad?: boolean, gapExpired?: boolean) => void;
  playPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
}

/** A player reports "no track" for a moment while it switches tracks (SMTC: the session or the title vanishes, then
 *  the next track appears). The previous track stays on screen this long, so the artwork flips from the old cover to
 *  the new one instead of blinking through "nothing playing". A real stop is shown once the gap outlasts it. */
export const TRACK_GAP_MS = 2000;
let gapTimer: ReturnType<typeof setTimeout> | null = null;

const hasTrack = (m: MediaState) => m.hasSession && (m.title !== "" || m.artist !== "");

function clearGap() {
  if (gapTimer !== null) clearTimeout(gapTimer);
  gapTimer = null;
}

export const useMediaStore = create<MediaStore>()((set, get) => ({
  media: EMPTY_MEDIA,
  pausedSince: null,

  applyState: (incoming, fromLoad = false, gapExpired = false) => {
    const prev = get().media;
    if (!fromLoad && !gapExpired && hasTrack(prev) && !hasTrack(incoming)) {
      // Hold the previous track; the latest empty state wins only if no track arrives in time.
      clearGap();
      gapTimer = setTimeout(() => {
        gapTimer = null;
        get().applyState(incoming, false, true);
      }, TRACK_GAP_MS);
      return;
    }
    clearGap();
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
    const requestedState = get().media;
    try {
      await invoke("media_seek", { positionMs: target });
    } catch (err) {
      console.warn("[island] media_seek failed", err);
      await correctRejectedCommand(requestedState);
    }
  },
}));

async function run(action: MediaAction): Promise<void> {
  const requestedState = useMediaStore.getState().media;
  try {
    await invoke("media_action", { action });
  } catch (err) {
    console.warn(`[island] media_action(${action}) failed`, err);
    await correctRejectedCommand(requestedState);
  }
}

async function correctRejectedCommand(requestedState: MediaState): Promise<void> {
  try {
    const corrected = await invoke("media_get_state");
    // A delayed failure must not overwrite a newer event or another optimistic command.
    if (useMediaStore.getState().media === requestedState) {
      useMediaStore.getState().applyState(corrected);
    }
  } catch {
    /* the next media://changed will fix it */
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
  clearGap();
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
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    if (media.status !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [media, intervalMs, visible]);
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
