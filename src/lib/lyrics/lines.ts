// Owner: F2. Pure helpers of the synced-lyrics feature (§30, design-spec §6.11). No DOM, no IPC.
import { lyricsMotion } from "../../design/motion";
import type { LyricsLine, MediaState } from "../../shared/types";

/** An interlude starts this long after the last sung line when the gap to the next line is longer than `interludeMs`. */
export const INTERLUDE_LEAD_IN_MS = 4000;

type TrackFields = Pick<MediaState, "hasSession" | "title" | "artist" | "album" | "durationMs">;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Cache key of a track, same recipe as Rust: `title|artist|album|round(duration / 2 s)`. "" = nothing to look up. */
export function trackKey(m: TrackFields): string {
  if (!m.hasSession || !m.title.trim()) return "";
  return `${norm(m.title)}|${norm(m.artist)}|${norm(m.album)}|${Math.round(Math.max(0, m.durationMs) / 2000)}`;
}

/**
 * Lines as the view shows them: a long pause between two sung lines gets an explicit empty line (the "• • •" interlude),
 * so the active line, the dots and the pill all follow from one list. Input must be sorted by `timeMs`.
 */
export function withInterludes(lines: readonly LyricsLine[]): LyricsLine[] {
  const out: LyricsLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const next = lines[i + 1];
    if (next && line.text !== "" && next.timeMs - line.timeMs > lyricsMotion.interludeMs) {
      out.push({ timeMs: line.timeMs + INTERLUDE_LEAD_IN_MS, text: "" });
    }
  }
  return out;
}

/** Plain lyrics → display rows: blank-line runs collapse into one empty row (a stanza gap). */
export function plainRows(text: string): string[] {
  const rows: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (row === "" && (rows.length === 0 || rows[rows.length - 1] === "")) continue;
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/** How many of the three interlude dots are lit at `positionMs` (1…3, thirds of the pause). */
export function interludeDots(startMs: number, endMs: number, positionMs: number): 1 | 2 | 3 {
  const span = Math.max(1, endMs - startMs);
  const third = Math.floor(((positionMs - startMs) / span) * 3) + 1;
  return Math.min(3, Math.max(1, third)) as 1 | 2 | 3;
}

/** End of the interlude that starts at `lines[index]`. */
export function interludeEnd(lines: readonly LyricsLine[], index: number): number {
  return lines[index + 1]?.timeMs ?? lines[index].timeMs + lyricsMotion.interludeMs;
}

/** Wait (ms) before announcing a pill line: it must hold 1.2 s, and announcements are 4 s apart. */
export const ANNOUNCE_HOLD_MS = 1200;
export const ANNOUNCE_GAP_MS = 4000;
export function announceDelay(now: number, lastAnnouncedAt: number): number {
  return Math.max(ANNOUNCE_HOLD_MS, lastAnnouncedAt + ANNOUNCE_GAP_MS - now);
}

/** Wheel/trackpad: accumulates `deltaY` and returns whole line steps (±1 per `LINE_WHEEL_PX`). */
export const LINE_WHEEL_PX = 48;
export function wheelSteps(accumulated: number, delta: number): { steps: number; rest: number } {
  const total = accumulated + delta;
  const steps = Math.trunc(total / LINE_WHEEL_PX);
  return { steps, rest: total - steps * LINE_WHEEL_PX };
}

/** Art column size of the view: `clamp(112, bodyHeight − 136, 176)` (design-spec §6.11.3). */
export function lyricsArtSize(bodyHeight: number): number {
  return Math.min(176, Math.max(112, Math.round(bodyHeight - 136)));
}
