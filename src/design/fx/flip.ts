// Owner: motion-fx. Pure logic of the artwork flip (CoverFlip.tsx). Spec: docs/design-spec.md §9b.1.
import { sameTrack } from "../../lib/media/progress";
import type { MediaState } from "../../shared/types";

export type FlipDirection = 1 | -1;

/** What a face of the cover shows: the track identity and its artwork (null → note icon). */
export type Cover = { id: string; artwork: string | null };

export function coverOf(media: MediaState): Cover {
  return {
    id: media.hasSession ? JSON.stringify([media.sourceApp, media.title, media.artist, media.album]) : "",
    artwork: media.hasSession ? media.artwork : null,
  };
}

/**
 * A flip only when the track identity changed with a session on both sides. Pause, seek, position updates and a late
 * artwork keep the identity; "no session → track" and "track → no session" are plain cross-fades.
 */
export function shouldFlip(prev: MediaState, next: MediaState): boolean {
  return prev.hasSession && next.hasSession && !sameTrack(prev, next);
}

/** A skip pressed in the app counts for the next track change within this window. */
export const SKIP_INTENT_MS = 3000;

let intent: { dir: FlipDirection; at: number } | null = null;

/** Called by the player buttons: «Следующий» → 1, «Предыдущий» → -1. */
export function noteSkip(dir: FlipDirection, now = performance.now()): void {
  intent = { dir, at: now };
}

/** Direction for a track change happening now. A change without a button press in the app counts as «Следующий». */
export function takeSkipDirection(now = performance.now()): FlipDirection {
  const dir = intent && now - intent.at <= SKIP_INTENT_MS ? intent.dir : 1;
  intent = null;
  return dir;
}

export function resetSkipIntent(): void {
  intent = null;
}

const mod360 = (deg: number) => ((deg % 360) + 360) % 360;

/** The front face (rotateX = θ) is turned away from the viewer; the back face (θ + 180°) is facing it. */
export function frontHidden(theta: number): boolean {
  const m = mod360(theta);
  return m > 90 && m < 270;
}

/**
 * Where a flip toward `dir` ends when it starts (or is retargeted) at `theta`: the nearest whole turn in that direction
 * that still passes through "front hidden", so the front face is swapped to the newest track before it faces the viewer.
 * θ = 0 → ±360. Mid-air the current turn is kept when the front has not come back yet; otherwise one more turn.
 */
export function flipTarget(theta: number, dir: FlipDirection): number {
  const s = theta * dir;
  return dir * 360 * (Math.floor((s + 90) / 360) + 1) || 0;
}

/** Duration of a (re)targeted flip, scaled by the remaining angle so a retarget keeps roughly the same angular speed. */
export function flipDuration(from: number, to: number, base: number): number {
  const turns = Math.abs(to - from) / 360;
  return base * Math.min(1.4, Math.max(0.6, turns));
}
