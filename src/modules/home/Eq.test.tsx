import { render, act, waitFor, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAudioStore, useAudioStore } from "../../lib/audio/store";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import { Eq } from "./Eq";
import { visualizerManager } from "../../lib/audio/visualizerStore";

describe("Eq component", () => {
  beforeEach(() => {
    visualizerManager.resetForTests();
    resetAudioStore();
    resetMock();
  });

  afterEach(() => { cleanup(); visualizerManager.resetForTests(); resetAudioStore(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("keeps one subscription across StrictMode setup/cleanup and releases everything on unmount", async () => {
    const view = render(<StrictMode><Eq playing /></StrictMode>);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    expect(visualizerManager.getActiveConsumers()).toBe(1);
    expect(mockListenerCount("audio://changed")).toBe(1);
    view.unmount();
    await visualizerManager.settled();
    expect(visualizerManager.getActiveConsumers()).toBe(0);
    expect(mockListenerCount("audio://spectrum")).toBe(0);
    expect(mockListenerCount("audio://changed")).toBe(0);
  });

  it.each([{ volume: 64, muted: true }, { volume: 0, muted: false }])(
    "stays quiet from real initial audio state before Home mounts: %o", async initial => {
      const original = ipc.invoke;
      const spy = vi.spyOn(ipc, "invoke").mockImplementation(((...args: Parameters<typeof ipc.invoke>) => {
        if (args[0] === "audio_get_state") return Promise.resolve({ ...initial, device: null });
        return original(...args);
      }) as typeof ipc.invoke);
      const { container, unmount } = render(<Eq playing />);
      await waitFor(() => expect(useAudioStore.getState().ready).toBe(true));
      expect(spy).toHaveBeenCalledWith("audio_get_state");
      expect(visualizerManager.getActiveConsumers()).toBe(0);
      expect([...container.querySelectorAll("i")].every(bar => bar.style.transform === "scaleY(0.2)")).toBe(true);
      act(() => mockEmit("audio://changed", { volume: 60, muted: false, device: null }));
      await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
      await visualizerManager.settled();
      act(() => mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() }));
      expect(container.querySelector("i")?.style.transform).toBe("scaleY(1)");
      act(() => mockEmit("audio://changed", { volume: 0, muted: false, device: null }));
      expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
      expect(visualizerManager.getActiveConsumers()).toBe(0);
      unmount();
      expect(mockListenerCount("audio://spectrum")).toBe(0);
      expect(mockListenerCount("audio://changed")).toBe(0);
    },
  );

  it("updates Eq without rerendering its parent at spectrum frequency", async () => {
    const parent = vi.fn(() => <Eq playing />);
    const Parent = parent;
    render(<Parent />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    for (let i = 0; i < 10; i++) {
      act(() => mockEmit("audio://spectrum", { available: true, bands: [i / 10, 0, 0, 0], sampledAt: Date.now() }));
    }
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it("limits 20 Hz input to 12–15 DOM frames/s, using the latest sample without a frame loop", async () => {
    const { container, unmount } = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    vi.useFakeTimers();
    const first = container.querySelector("i")!;
    const times: number[] = [];
    const stylePrototype = Object.getPrototypeOf(first.style) as CSSStyleDeclaration;
    const setter = Object.getOwnPropertyDescriptor(stylePrototype, "transform")!.set!;
    const writes = vi.spyOn(stylePrototype, "transform", "set").mockImplementation(function (this: CSSStyleDeclaration, value: string) {
      if (this === first.style) times.push(performance.now());
      setter.call(this, value);
    });
    for (let frame = 0; frame < 200; frame++) {
      act(() => {
        vi.advanceTimersByTime(50);
        const level = ((frame * 7) % 97 + 1) / 100;
        mockEmit("audio://spectrum", { available: true, bands: [level, level, level, level], sampledAt: Date.now() });
      });
    }
    console.info("PERF_EQ_DOM", JSON.stringify({ inputFrames: 200, simulatedMs: 10_000, paintedFrames: times.length, styleWrites: writes.mock.calls.length }));
    expect(times.length).toBeGreaterThanOrEqual(190);
    expect(times.length).toBeLessThanOrEqual(201);
    expect(writes.mock.calls.length).toBe(times.length * 4);
    expect(times.slice(1).every((time, index) => time - times[index] >= 50)).toBe(true);
    // The last input at 10000ms trails the 9950ms paint; do not lose that final sample.
    act(() => vi.advanceTimersByTime(25));
    expect(first.style.transform).toBe("scaleY(0.5)");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not write styles for subpixel spectrum noise", async () => {
    const { container } = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    vi.useFakeTimers();
    act(() => mockEmit("audio://spectrum", { available: true, bands: [0.5, 0.5, 0.5, 0.5], sampledAt: Date.now() }));
    const writes = vi.spyOn(Object.getPrototypeOf(container.querySelector("i")!.style) as CSSStyleDeclaration, "transform", "set");
    for (let frame = 0; frame < 20; frame++) {
      act(() => {
        vi.advanceTimersByTime(50);
        const level = frame % 2 ? 0.501 : 0.499;
        mockEmit("audio://spectrum", { available: true, bands: [level, level, level, level], sampledAt: Date.now() });
      });
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "pause", "hide", "unmount"])("cancels a pending frame on %s", async reason => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const view = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    vi.useFakeTimers();
    const bar = view.container.querySelector("i")!;
    act(() => mockEmit("audio://spectrum", { available: true, bands: [0.5, 0.5, 0.5, 0.5], sampledAt: Date.now() }));
    act(() => {
      // Inside the 50 ms paint interval: this sample is queued, not painted yet.
      vi.advanceTimersByTime(25);
      mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() });
    });
    expect(bar.style.transform).toBe("scaleY(0.6)");
    if (reason === "pause") view.rerender(<Eq playing={false} />);
    else if (reason === "unmount") view.unmount();
    else if (reason === "hide") act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
    else act(() => mockEmit("audio://spectrum", { available: false, bands: [0, 0, 0, 0], sampledAt: Date.now() }));
    expect(bar.style.transform).toBe("scaleY(0.2)");
    act(() => vi.advanceTimersByTime(600));
    expect(bar.style.transform).toBe("scaleY(0.2)");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires an aging queued sample before it can reach the DOM", async () => {
    const { container } = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    vi.useFakeTimers();
    // Keep the producer timestamp within the current activation but almost stale.
    act(() => vi.advanceTimersByTime(500));
    act(() => mockEmit("audio://spectrum", { available: true, bands: [0.5, 0.5, 0.5, 0.5], sampledAt: Date.now() - 490 }));
    act(() => {
      vi.advanceTimersByTime(10);
      mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() - 490 });
    });
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.6)");
    // The accepted sample expires at 501ms age, before its 75ms paint deadline.
    act(() => vi.advanceTimersByTime(11));
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
    act(() => vi.advanceTimersByTime(600));
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders resting bars when playing is false", () => {
    const { container } = render(<Eq playing={false} />);
    const eq = container.querySelector(".ig-eq");
    expect(eq).toHaveAttribute("data-playing", "false");
    const bars = container.querySelectorAll(".ig-eq > i");
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      expect((bar as HTMLElement).style.transform).toBe("scaleY(0.2)");
    }
  });

  it("releases capture when hidden, ignores hidden frames and resumes without stale bars", async () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const { container } = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    const emit = () => mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() });
    act(emit);
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(1)");
    act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
    await visualizerManager.settled();
    expect(mockListenerCount("audio://spectrum")).toBe(0);
    expect(visualizerManager.getActiveConsumers()).toBe(0);
    act(emit);
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
    act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
    act(emit);
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(1)");
  });

  it("clears the DOM bars after 500ms without a producer and leaves no frame loop", async () => {
    const { container, unmount } = render(<Eq playing />);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    vi.useFakeTimers();
    act(() => mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() }));
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(1)");
    act(() => vi.advanceTimersByTime(501));
    expect(container.querySelector("i")?.style.transform).toBe("scaleY(0.2)");
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("updates bar transforms when spectrum events arrive while playing", async () => {
    const { container } = render(<Eq playing={true} />);
    const eq = container.querySelector(".ig-eq");
    expect(eq).toHaveAttribute("data-playing", "true");

    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    act(() => {
      mockEmit("audio://spectrum", {
        available: true,
        bands: [0.5, 0.25, 0.75, 1.0],
        sampledAt: Date.now(),
      });
    });

    const bars = container.querySelectorAll(".ig-eq > i");
    expect(bars).toHaveLength(4);
    // scale(b0 = 0.5) = 0.2 + 0.5 * 0.8 = 0.6
    expect((bars[0] as HTMLElement).style.transform).toBe("scaleY(0.6)");
    // scale(b1 = 0.25) = 0.2 + 0.25 * 0.8 = 0.4
    expect((bars[1] as HTMLElement).style.transform).toBe("scaleY(0.4)");
    // scale(b2 = 0.75) = 0.2 + 0.75 * 0.8 = 0.8
    expect((bars[2] as HTMLElement).style.transform).toBe("scaleY(0.8)");
    // scale(b3 = 1.0) = 0.2 + 1.0 * 0.8 = 1
    expect((bars[3] as HTMLElement).style.transform).toBe("scaleY(1)");
  });
});
