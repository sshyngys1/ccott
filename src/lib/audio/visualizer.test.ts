import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visualizerManager } from "./visualizerStore";
import { waitFor } from "@testing-library/react";
import { mockListenerCount, resetMock } from "../../ipc/mock";
import type { AudioSpectrum } from "../../shared/types";

describe("visualizerManager", () => {
  beforeEach(() => {
    visualizerManager.resetForTests();
    resetMock();
  });
  afterEach(() => visualizerManager.resetForTests());
  async function activate() {
    visualizerManager.registerConsumer();
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
  }

  it("updates bands for valid fresh frame", async () => {
    await activate();
    const fresh: AudioSpectrum = {
      available: true,
      bands: [0.2, 0.5, 0.8, 1.0],
      sampledAt: Date.now(),
    };
    visualizerManager.handleSpectrumEvent(fresh);
    expect(visualizerManager.getSnapshot()).toEqual([0.2, 0.5, 0.8, 1.0]);
  });

  it("discards stale frames (> 500 ms) and sets silence", async () => {
    await activate();
    const stale: AudioSpectrum = {
      available: true,
      bands: [0.9, 0.9, 0.9, 0.9],
      sampledAt: Date.now() - 600, // 600 ms old
    };
    visualizerManager.handleSpectrumEvent(stale);
    expect(visualizerManager.getSnapshot()).toEqual([0, 0, 0, 0]);
  });

  it("resets to silence when available is false", async () => {
    await activate();
    const active: AudioSpectrum = {
      available: true,
      bands: [0.5, 0.5, 0.5, 0.5],
      sampledAt: Date.now(),
    };
    visualizerManager.handleSpectrumEvent(active);
    expect(visualizerManager.getSnapshot()).toEqual([0.5, 0.5, 0.5, 0.5]);

    const unavailable: AudioSpectrum = {
      available: false,
      bands: [0.5, 0.5, 0.5, 0.5],
      sampledAt: Date.now(),
    };
    visualizerManager.handleSpectrumEvent(unavailable);
    expect(visualizerManager.getSnapshot()).toEqual([0, 0, 0, 0]);
  });

  it("sanitizes NaN and clamps out of bounds values", async () => {
    await activate();
    const invalid: AudioSpectrum = {
      available: true,
      bands: [Number.NaN, -0.5, 1.5, Infinity],
      sampledAt: Date.now(),
    };
    visualizerManager.handleSpectrumEvent(invalid);
    expect(visualizerManager.getSnapshot()).toEqual([0, 0, 1.0, 0]);
  });

  it("manages active consumer count and capture state", () => {
    expect(visualizerManager.getActiveConsumers()).toBe(0);
    expect(visualizerManager.isCaptureEnabled()).toBe(false);

    visualizerManager.registerConsumer();
    expect(visualizerManager.getActiveConsumers()).toBe(1);
    expect(visualizerManager.isCaptureEnabled()).toBe(true);

    visualizerManager.registerConsumer();
    expect(visualizerManager.getActiveConsumers()).toBe(2);

    visualizerManager.unregisterConsumer();
    expect(visualizerManager.getActiveConsumers()).toBe(1);
    expect(visualizerManager.isCaptureEnabled()).toBe(true);

    visualizerManager.unregisterConsumer();
    expect(visualizerManager.getActiveConsumers()).toBe(0);
    expect(visualizerManager.isCaptureEnabled()).toBe(false);
  });
});
