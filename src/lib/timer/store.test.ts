import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playChime = vi.fn(() => true);
const primeAudio = vi.fn();
vi.mock("./chime", () => ({ playChime: () => playChime(), primeAudio: () => primeAudio() }));

import { DONE_HOLD_MS, MINUTE_MS } from "./machine";
import { resetTimerStore, useIsTimerActive, useTimerRemaining, useTimerStore } from "./store";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0));
  playChime.mockClear();
  primeAudio.mockClear();
  resetTimerStore();
});
afterEach(() => {
  resetTimerStore();
  vi.useRealTimers();
});

const S = () => useTimerStore.getState();

describe("timer store", () => {
  it("counts down by timestamps and chimes exactly once when done", () => {
    S().selectPreset(1);
    S().toggle();
    expect(primeAudio).toHaveBeenCalled(); // «start» is a user gesture
    expect(S().timer.status).toBe("running");

    vi.advanceTimersByTime(30_000);
    expect(S().timer.status).toBe("running");
    expect(playChime).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(S().timer.status).toBe("done");
    expect(playChime).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact time even if the system clock jumps (sleep / throttled timers)", () => {
    S().selectPreset(5);
    S().toggle();
    vi.setSystemTime(Date.now() + 4 * MINUTE_MS); // timers did not fire, the clock did
    vi.advanceTimersByTime(1100);
    expect(S().timer.status).toBe("running");
    expect(S().timer.remainingMs - (S().now - (S().timer.startedAt ?? 0))).toBeLessThanOrEqual(MINUTE_MS);
    vi.advanceTimersByTime(MINUTE_MS);
    expect(S().timer.status).toBe("done");
  });

  it("pause stops the schedule; resume continues", () => {
    S().selectPreset(1);
    S().toggle();
    vi.advanceTimersByTime(20_000);
    S().toggle();
    expect(S().timer.status).toBe("paused");
    expect(S().timer.remainingMs).toBe(40_000);
    vi.advanceTimersByTime(10 * MINUTE_MS);
    expect(S().timer.status).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
    S().toggle();
    vi.advanceTimersByTime(40_000);
    expect(S().timer.status).toBe("done");
  });

  it("the done activity leaves the pill after 10 s, but the tab keeps the done state", () => {
    S().selectPreset(1);
    S().toggle();
    vi.advanceTimersByTime(MINUTE_MS);
    const { result } = renderHook(() => useIsTimerActive());
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(DONE_HOLD_MS - 500);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toBe(false);
    expect(S().timer.status).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clicking the done pill dismisses it right away", () => {
    S().selectPreset(1);
    S().toggle();
    vi.advanceTimersByTime(MINUTE_MS);
    const { result } = renderHook(() => useIsTimerActive());
    expect(result.current).toBe(true);
    act(() => S().dismissDone());
    expect(result.current).toBe(false);
  });

  it("starting again after done brings the pill back", () => {
    S().selectPreset(1);
    S().toggle();
    vi.advanceTimersByTime(MINUTE_MS);
    S().dismissDone();
    S().toggle();
    expect(S().timer.status).toBe("running");
    expect(S().doneDismissed).toBe(false);
  });

  it("idle is not shown in the pill, running and paused are", () => {
    const { result } = renderHook(() => useIsTimerActive());
    expect(result.current).toBe(false);
    act(() => S().toggle());
    expect(result.current).toBe(true);
    act(() => S().toggle());
    expect(result.current).toBe(true);
    act(() => S().reset());
    expect(result.current).toBe(false);
  });

  it("useTimerRemaining follows the clock second by second", () => {
    S().selectPreset(1);
    const { result } = renderHook(() => useTimerRemaining());
    expect(result.current).toBe(MINUTE_MS);
    act(() => S().toggle());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBeLessThanOrEqual(57_000);
    expect(result.current).toBeGreaterThan(55_000);
  });

  it("«+1 мин» extends a running timer", () => {
    S().selectPreset(1);
    S().toggle();
    vi.advanceTimersByTime(30_000);
    S().addMinute();
    vi.advanceTimersByTime(MINUTE_MS);
    expect(S().timer.status).toBe("running");
    vi.advanceTimersByTime(30_000);
    expect(S().timer.status).toBe("done");
  });

  it("presets reset and stop", () => {
    S().toggle();
    S().selectPreset(10);
    expect(S().timer).toMatchObject({ status: "idle", totalMs: 10 * MINUTE_MS });
    expect(vi.getTimerCount()).toBe(0);
  });
});
