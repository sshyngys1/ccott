import type { MediaState } from "../../shared/types";
import { sourceDisplayName } from "./sourceDisplayName";

/** How long a paused session stays in the pill before the clock returns (spec §6.7). */
export const PAUSE_GRACE_MS = 30_000;

export const EMPTY_MEDIA: MediaState = {
  hasSession: false,
  sourceApp: "",
  title: "",
  artist: "",
  album: "",
  artwork: null,
  status: "stopped",
  positionMs: 0,
  durationMs: 0,
  positionSampledAt: 0,
  canPlayPause: false,
  canNext: false,
  canPrevious: false,
  canSeek: false,
};

/** Playback position at `now`: extrapolated from the sample while playing, the sample itself otherwise. Clamped to the duration. */
export function extrapolatePosition(m: MediaState, now: number): number {
  let pos = m.positionMs;
  if (m.status === "playing") pos += Math.max(0, now - m.positionSampledAt);
  if (m.durationMs > 0) pos = Math.min(pos, m.durationMs);
  return Math.max(0, pos);
}

/** 0..1 fraction of the track that has been played. */
export function progressFraction(positionMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

/** The pill shows the track while playing and for `PAUSE_GRACE_MS` after it was paused. */
export function isMediaActive(m: MediaState, pausedSince: number | null, now: number): boolean {
  if (!m.hasSession) return false;
  if (m.status === "playing") return true;
  if (m.status === "paused") return pausedSince !== null && now - pausedSince < PAUSE_GRACE_MS;
  return false;
}

/** Readable label shared by the full player and compact activity. */
export function sourceAppLabel(sourceApp: string): string {
  return sourceDisplayName(sourceApp);
}

/** Same track (so a late-arriving artwork / a position update does not need a new cover). */
export function sameTrack(a: MediaState, b: MediaState): boolean {
  return a.hasSession && b.hasSession && a.title === b.title && a.artist === b.artist && a.album === b.album && a.sourceApp === b.sourceApp;
}
