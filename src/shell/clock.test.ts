import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock, msUntilNextMinute, useClock } from "./clock";

describe("clock helpers", () => {
  it("formats HH:MM with zero padding", () => {
    expect(formatClock(new Date(2026, 0, 1, 7, 5))).toBe("07:05");
    expect(formatClock(new Date(2026, 0, 1, 23, 59))).toBe("23:59");
  });

  it("computes the time to the next minute boundary", () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 10, 0, 0, 0))).toBe(60_000);
    expect(msUntilNextMinute(new Date(2026, 0, 1, 10, 0, 59, 500))).toBe(500);
    expect(msUntilNextMinute(new Date(2026, 0, 1, 10, 0, 30, 0))).toBe(30_000);
  });
});

describe("useClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks once per minute, aligned to the minute start (not every second)", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0, 45, 0));
    const { result } = renderHook(() => useClock());
    expect(result.current).toBe("10:00");

    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    expect(result.current).toBe("10:00");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("10:01");

    // Next change only a full minute later.
    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(result.current).toBe("10:01");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("10:02");
  });

  it("schedules a single timer, not an interval of seconds", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0, 10, 0));
    renderHook(() => useClock());
    expect(vi.getTimerCount()).toBe(1);
  });
});
