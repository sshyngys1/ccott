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

  afterEach(() => { cleanup(); visualizerManager.resetForTests(); resetAudioStore(); vi.restoreAllMocks(); });

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
