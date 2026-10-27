import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import type { MediaState } from "../../shared/types";
import { PAUSE_GRACE_MS } from "./progress";
import { initMedia, resetMediaStore, useIsMediaActive, useMediaStore } from "./store";

const track = (over: Partial<MediaState> = {}): MediaState => ({
  hasSession: true,
  sourceApp: "Spotify.exe",
  title: "A",
  artist: "B",
  album: "C",
  artwork: "data:image/png;base64,AAA",
  status: "playing",
  positionMs: 0,
  durationMs: 100_000,
  positionSampledAt: Date.now(),
  canPlayPause: true,
  canNext: true,
  canPrevious: true,
  canSeek: true,
  ...over,
});

beforeEach(() => {
  resetMock();
  resetMediaStore();
});
afterEach(() => {
  resetMediaStore();
  vi.useRealTimers();
});

describe("media store", () => {
  it("initMedia loads the state once and subscribes once", async () => {
    await Promise.all([initMedia(), initMedia()]);
    await initMedia();
    expect(useMediaStore.getState().media.hasSession).toBe(true);
    expect(useMediaStore.getState().media.title).toBe("Полночный маршрут");
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
  });

  it("follows media://changed", async () => {
    await initMedia();
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
    act(() => mockEmit("media://changed", track({ title: "Новая" })));
    expect(useMediaStore.getState().media.title).toBe("Новая");
  });

  it("keeps the previous cover while the artwork of the same track has not arrived yet", () => {
    const { applyState } = useMediaStore.getState();
    applyState(track());
    applyState(track({ artwork: null, positionMs: 5 }));
    expect(useMediaStore.getState().media.artwork).toBe("data:image/png;base64,AAA");
    applyState(track({ title: "Другой", artwork: null }));
    expect(useMediaStore.getState().media.artwork).toBeNull();
    applyState(track({ title: "Другой", artwork: "data:image/png;base64,BBB" }));
    expect(useMediaStore.getState().media.artwork).toBe("data:image/png;base64,BBB");
  });

  it("remembers when the pause started; a paused snapshot at load does not count", () => {
    const { applyState } = useMediaStore.getState();
    applyState(track({ status: "paused" }), true);
    expect(useMediaStore.getState().pausedSince).toBe(0);
    applyState(track({ status: "playing" }));
    expect(useMediaStore.getState().pausedSince).toBeNull();
    const before = Date.now();
    applyState(track({ status: "paused" }));
    expect(useMediaStore.getState().pausedSince).toBeGreaterThanOrEqual(before);
  });

  it("playPause flips optimistically and calls the backend", async () => {
    await initMedia();
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
    await act(async () => {
      await useMediaStore.getState().playPause();
    });
    expect(useMediaStore.getState().media.status).toBe("paused");
  });

  it("seek updates the position immediately and clamps to the duration", async () => {
    await initMedia();
    // Freeze track-end timers: seeking to duration schedules the mock's next track at delay 0.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await act(async () => {
      await useMediaStore.getState().seek(10_000_000);
    });
    expect(useMediaStore.getState().media.positionMs).toBe(useMediaStore.getState().media.durationMs);
  });

  it("controls do nothing without a session", async () => {
    const spy = vi.spyOn(console, "warn");
    await useMediaStore.getState().playPause();
    await useMediaStore.getState().seek(1000);
    expect(useMediaStore.getState().media.hasSession).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useIsMediaActive", () => {
  it("true while playing, stays true for 30 s of pause, then false", async () => {
    await initMedia(); // load the mock snapshot first so it cannot overwrite the states below
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useMediaStore.getState().applyState(track());
    const { result } = renderHook(() => useIsMediaActive());
    expect(result.current).toBe(true);

    act(() => useMediaStore.getState().applyState(track({ status: "paused" })));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(PAUSE_GRACE_MS - 1000);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(false);

    act(() => useMediaStore.getState().applyState(track({ status: "playing" })));
    expect(result.current).toBe(true);
  });

  it("false without a session", () => {
    const { result } = renderHook(() => useIsMediaActive());
    expect(result.current).toBe(false);
  });
});
