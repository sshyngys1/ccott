// Timer state machine. Pure: every function takes `now` (epoch ms) and returns a new state — nothing accumulates
// between ticks, so the remaining time is always derived from timestamps and survives tab switches / throttled timers.

export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface TimerState {
  status: TimerStatus;
  /** Full length of the current interval, ms (the «из N мин» label; grows with «+1 мин»). */
  totalMs: number;
  /** running: what was left at `startedAt`; idle/paused: the frozen remainder; done: 0. */
  remainingMs: number;
  /** Epoch ms when the current run started (running only). */
  startedAt: number | null;
  /** Epoch ms when the timer was detected as finished (done only). */
  finishedAt: number | null;
}

export const MINUTE_MS = 60_000;
export const TIMER_PRESETS_MIN = [1, 3, 5, 10, 25] as const;
export const DEFAULT_TIMER_MS = 5 * MINUTE_MS;
/** How long the «Время вышло» activity stays in the pill. */
export const DONE_HOLD_MS = 10_000;

export function createTimer(totalMs: number = DEFAULT_TIMER_MS): TimerState {
  return { status: "idle", totalMs, remainingMs: totalMs, startedAt: null, finishedAt: null };
}

/** Time left at `now`. */
export function remainingAt(s: TimerState, now: number): number {
  if (s.status === "running" && s.startedAt !== null) return Math.max(0, s.remainingMs - Math.max(0, now - s.startedAt));
  if (s.status === "done") return 0;
  return s.remainingMs;
}

/** Marks a running timer as done once its time is up. Returns the same object when nothing changed. */
export function tick(s: TimerState, now: number): TimerState {
  if (s.status !== "running" || remainingAt(s, now) > 0) return s;
  return { ...s, status: "done", remainingMs: 0, startedAt: null, finishedAt: now };
}

/** idle/paused → running; done → run the same interval again; running → unchanged. */
export function start(s: TimerState, now: number): TimerState {
  if (s.status === "running") return s;
  if (s.status === "done") return { ...s, status: "running", remainingMs: s.totalMs, startedAt: now, finishedAt: null };
  if (s.remainingMs <= 0) return s;
  return { ...s, status: "running", startedAt: now };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", remainingMs: remainingAt(s, now), startedAt: null };
}

export function toggle(s: TimerState, now: number): TimerState {
  return s.status === "running" ? pause(s, now) : start(s, now);
}

/** Back to the full interval, stopped. */
export function reset(s: TimerState): TimerState {
  return createTimer(s.totalMs);
}

/** Choosing a preset resets and stops the timer (spec §6.6). */
export function selectPreset(_s: TimerState, minutes: number): TimerState {
  return createTimer(Math.max(1, Math.round(minutes)) * MINUTE_MS);
}

/**
 * «+1 мин»: adds a minute to the remainder and to the total. On a finished timer it continues with a fresh minute
 * (the ring would otherwise show 1 of N minutes).
 */
export function addMinute(s: TimerState, now: number): TimerState {
  switch (s.status) {
    case "done":
      return { status: "running", totalMs: MINUTE_MS, remainingMs: MINUTE_MS, startedAt: now, finishedAt: null };
    case "running":
      return { ...s, totalMs: s.totalMs + MINUTE_MS, remainingMs: remainingAt(s, now) + MINUTE_MS, startedAt: now };
    default:
      return { ...s, totalMs: s.totalMs + MINUTE_MS, remainingMs: s.remainingMs + MINUTE_MS };
  }
}

/** Ring value: remaining / total (the ring «melts» clockwise); a finished timer shows a full ring. */
export function ringValue(s: TimerState, now: number): number {
  if (s.status === "done") return 1;
  if (s.totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, remainingAt(s, now) / s.totalMs));
}

/** The pill activity is on for a running/paused timer and for `DONE_HOLD_MS` after it finished. */
export function isPillActive(s: TimerState, now: number, doneDismissed: boolean): boolean {
  if (s.status === "running" || s.status === "paused") return true;
  if (s.status === "done" && s.finishedAt !== null) return !doneDismissed && now - s.finishedAt < DONE_HOLD_MS;
  return false;
}

/**
 * Delay (ms) until the next moment something visible changes: the displayed second, the finish, or the end of the
 * «done» hold. null → nothing to schedule.
 */
export function nextWakeMs(s: TimerState, now: number, doneDismissed: boolean): number | null {
  if (s.status === "running") {
    const rem = remainingAt(s, now);
    if (rem <= 0) return 0;
    return rem % 1000 || 1000;
  }
  if (s.status === "done" && s.finishedAt !== null && !doneDismissed) {
    return Math.max(0, s.finishedAt + DONE_HOLD_MS - now);
  }
  return null;
}
