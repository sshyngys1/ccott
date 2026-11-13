import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNow } from "./useNow";
import { useMediaPosition, useMediaStore, resetMediaStore } from "./media/store";
import { EMPTY_MEDIA } from "./media/progress";

afterEach(() => { resetMediaStore(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("stops display intervals while hidden and immediately catches up on resume", () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const start = Date.now();
  useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, status: "playing", positionSampledAt: start, durationMs: 60_000 });
  const { result, unmount } = renderHook(() => ({ now: useNow(1000), position: useMediaPosition() }));
  expect(vi.getTimerCount()).toBe(2);
  act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current).toEqual({ now: start, position: 0 });
  act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current).toEqual({ now: start + 10_000, position: 10_000 });
  expect(vi.getTimerCount()).toBe(2);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
