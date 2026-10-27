import { describe, expect, it } from "vitest";
import {
  DONE_HOLD_MS,
  MINUTE_MS,
  addMinute,
  createTimer,
  isPillActive,
  nextWakeMs,
  pause,
  remainingAt,
  reset,
  ringValue,
  selectPreset,
  start,
  tick,
  toggle,
} from "./machine";

const T0 = 1_000_000;

describe("timer machine", () => {
  it("starts idle with 5 minutes", () => {
    const s = createTimer();
    expect(s).toMatchObject({ status: "idle", totalMs: 5 * MINUTE_MS, remainingMs: 5 * MINUTE_MS });
    expect(remainingAt(s, T0)).toBe(5 * MINUTE_MS);
  });

  it("remaining time is derived from timestamps, not from ticks", () => {
    const s = start(createTimer(), T0);
    expect(s.status).toBe("running");
    expect(remainingAt(s, T0 + 1000)).toBe(5 * MINUTE_MS - 1000);
    // Nobody ticked for a minute (hidden tab, throttled timers): still exact.
    expect(remainingAt(s, T0 + 60_000)).toBe(4 * MINUTE_MS);
  });

  it("pause freezes the remainder, resume continues from it", () => {
    let s = start(createTimer(), T0);
    s = pause(s, T0 + 90_000);
    expect(s).toMatchObject({ status: "paused", remainingMs: 210_000, startedAt: null });
    expect(remainingAt(s, T0 + 10 * MINUTE_MS)).toBe(210_000);
    s = start(s, T0 + 200_000);
    expect(remainingAt(s, T0 + 200_000 + 10_000)).toBe(200_000);
  });

  it("toggle switches between running and paused", () => {
    let s = toggle(createTimer(), T0);
    expect(s.status).toBe("running");
    s = toggle(s, T0 + 1000);
    expect(s.status).toBe("paused");
    s = toggle(s, T0 + 2000);
    expect(s.status).toBe("running");
  });

  it("tick finishes the timer exactly when the time is up and not before", () => {
    const s = start(selectPreset(createTimer(), 1), T0);
    expect(tick(s, T0 + 59_999)).toBe(s);
    const done = tick(s, T0 + 60_000);
    expect(done).toMatchObject({ status: "done", remainingMs: 0, startedAt: null, finishedAt: T0 + 60_000 });
    expect(tick(done, T0 + 61_000)).toBe(done);
  });

  it("tick after a long sleep still ends in done", () => {
    const s = start(createTimer(), T0);
    expect(tick(s, T0 + 3_600_000).status).toBe("done");
  });

  it("start on a done timer repeats the same interval", () => {
    const done = tick(start(selectPreset(createTimer(), 3), T0), T0 + 3 * MINUTE_MS);
    const again = start(done, T0 + 4 * MINUTE_MS);
    expect(again).toMatchObject({ status: "running", totalMs: 3 * MINUTE_MS, remainingMs: 3 * MINUTE_MS, finishedAt: null });
  });

  it("reset returns to the full interval, stopped", () => {
    const s = reset(pause(start(selectPreset(createTimer(), 10), T0), T0 + 5000));
    expect(s).toEqual(createTimer(10 * MINUTE_MS));
  });

  it("presets reset and stop the timer", () => {
    const running = start(createTimer(), T0);
    const s = selectPreset(running, 25);
    expect(s).toEqual(createTimer(25 * MINUTE_MS));
  });

  it("«+1 мин» adds to the remainder and the total in every state", () => {
    const idle = addMinute(createTimer(), T0);
    expect(idle).toMatchObject({ status: "idle", totalMs: 6 * MINUTE_MS, remainingMs: 6 * MINUTE_MS });

    const running = addMinute(start(createTimer(), T0), T0 + 30_000);
    expect(running).toMatchObject({ status: "running", totalMs: 6 * MINUTE_MS });
    expect(remainingAt(running, T0 + 30_000)).toBe(5 * MINUTE_MS - 30_000 + MINUTE_MS);

    const paused = addMinute(pause(start(createTimer(), T0), T0 + 60_000), T0 + 70_000);
    expect(paused).toMatchObject({ status: "paused", totalMs: 6 * MINUTE_MS, remainingMs: 5 * MINUTE_MS });
  });

  it("«+1 мин» on a finished timer continues with a fresh minute", () => {
    const done = tick(start(selectPreset(createTimer(), 1), T0), T0 + MINUTE_MS);
    const s = addMinute(done, T0 + MINUTE_MS + 5000);
    expect(s).toMatchObject({ status: "running", totalMs: MINUTE_MS, remainingMs: MINUTE_MS, finishedAt: null });
  });

  it("ringValue is remaining/total; done is a full ring", () => {
    const s = start(createTimer(), T0);
    expect(ringValue(s, T0)).toBe(1);
    expect(ringValue(s, T0 + 150_000)).toBe(0.5);
    expect(ringValue(tick(s, T0 + 5 * MINUTE_MS), T0 + 5 * MINUTE_MS)).toBe(1);
    expect(ringValue({ ...createTimer(), totalMs: 0, remainingMs: 0 }, T0)).toBe(0);
  });

  it("start with nothing left does nothing", () => {
    const empty = { ...createTimer(), remainingMs: 0 };
    expect(start(empty, T0)).toBe(empty);
  });
});

describe("pill activity", () => {
  it("running and paused are active, idle is not", () => {
    const r = start(createTimer(), T0);
    expect(isPillActive(createTimer(), T0, false)).toBe(false);
    expect(isPillActive(r, T0, false)).toBe(true);
    expect(isPillActive(pause(r, T0 + 1), T0 + 1, false)).toBe(true);
  });
  it("done stays for 10 s, or until dismissed", () => {
    const done = tick(start(createTimer(), T0), T0 + 5 * MINUTE_MS);
    const f = T0 + 5 * MINUTE_MS;
    expect(isPillActive(done, f + DONE_HOLD_MS - 1, false)).toBe(true);
    expect(isPillActive(done, f + DONE_HOLD_MS, false)).toBe(false);
    expect(isPillActive(done, f + 100, true)).toBe(false);
  });
});

describe("nextWakeMs", () => {
  it("running: aligned to the next displayed second", () => {
    const s = start(createTimer(), T0);
    expect(nextWakeMs(s, T0, false)).toBe(1000);
    expect(nextWakeMs(s, T0 + 250, false)).toBe(750);
    expect(nextWakeMs(s, T0 + 1000, false)).toBe(1000);
  });
  it("done: until the end of the hold; dismissed / idle / paused: nothing", () => {
    const done = tick(start(createTimer(), T0), T0 + 5 * MINUTE_MS);
    expect(nextWakeMs(done, T0 + 5 * MINUTE_MS + 4000, false)).toBe(DONE_HOLD_MS - 4000);
    expect(nextWakeMs(done, T0 + 5 * MINUTE_MS, true)).toBeNull();
    expect(nextWakeMs(createTimer(), T0, false)).toBeNull();
    expect(nextWakeMs(pause(start(createTimer(), T0), T0 + 1), T0 + 1, false)).toBeNull();
  });
});
