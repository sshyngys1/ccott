import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import { VisualizerManager } from "./visualizerStore";

let manager: VisualizerManager;
beforeEach(() => { resetMock(); manager = new VisualizerManager({ tail: Promise.resolve() }); });
afterEach(async () => { manager.dispose(); await manager.settled(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function activate() {
  const release = manager.registerConsumer();
  await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
  await manager.settled();
  return release;
}

it("ignores late frames with no consumers and disposes subscription and stale timer", async () => {
  expect(mockListenerCount("audio://spectrum")).toBe(0);
  const release = await activate();
  mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() });
  expect(manager.getSnapshot()).toEqual([1, 1, 1, 1]);
  release(); release();
  expect(mockListenerCount("audio://spectrum")).toBe(0);
  manager.handleSpectrumEvent({ available: true, bands: [1, 1, 1, 1], sampledAt: Date.now() });
  expect(manager.getSnapshot()).toEqual([0, 0, 0, 0]);
  expect(manager.getActiveConsumers()).toBe(0);
});

it("clears a silent producer at 500ms and rejects invalid or far-future timestamps", async () => {
  await activate();
  vi.useFakeTimers();
  const time = Date.now();
  mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt: time });
  expect(manager.getSnapshot()).toEqual([1, 1, 1, 1]);
  vi.advanceTimersByTime(501);
  expect(manager.getSnapshot()).toEqual([0, 0, 0, 0]);
  for (const sampledAt of [NaN, Infinity, -1, time - 501, Date.now() + 101]) {
    mockEmit("audio://spectrum", { available: true, bands: [1, 1, 1, 1], sampledAt });
    expect(manager.getSnapshot()).toEqual([0, 0, 0, 0]);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("unsubscribes a late listen result and never enables after release", async () => {
  let finish!: (unlisten: () => void) => void;
  vi.spyOn(ipc, "listen").mockImplementation((() => new Promise(resolve => { finish = resolve; })) as typeof ipc.listen);
  const invoke = vi.spyOn(ipc, "invoke");
  const release = manager.registerConsumer();
  release();
  const unlisten = vi.fn();
  finish(unlisten);
  await Promise.resolve();
  await manager.settled();
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls.filter(call => call[0] === "audio_visualizer_set_enabled"))
    .toEqual([["audio_visualizer_set_enabled", { enabled: false }]]);
});

it("handles rejected listen without an unhandled rejection or capture loop", async () => {
  const listen = vi.spyOn(ipc, "listen").mockRejectedValue(new Error("listen rejected"));
  const invoke = vi.spyOn(ipc, "invoke");
  manager.registerConsumer();
  await Promise.resolve();
  await Promise.resolve();
  expect(listen).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
  expect(manager.getSnapshot()).toEqual([0, 0, 0, 0]);
});

it("serializes delayed enable, dispose and replacement enable using the same HMR queue", async () => {
  const queue = { tail: Promise.resolve() };
  manager = new VisualizerManager(queue);
  let completeEnable!: () => void;
  const commands: boolean[] = [];
  vi.spyOn(ipc, "invoke").mockImplementation(((command: string, args: { enabled: boolean }) => {
    if (command !== "audio_visualizer_set_enabled") throw new Error("unexpected command");
    commands.push(args.enabled);
    if (commands.length === 1) return new Promise<void>(resolve => { completeEnable = resolve; });
    return Promise.resolve();
  }) as typeof ipc.invoke);
  manager.registerConsumer();
  await waitFor(() => expect(commands).toEqual([true]));
  manager.dispose();
  const replacement = new VisualizerManager(queue);
  replacement.registerConsumer();
  await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
  expect(commands).toEqual([true]);
  completeEnable();
  await replacement.settled();
  expect(commands).toEqual([true, false, true]);
  replacement.dispose();
  await replacement.settled();
  expect(commands).toEqual([true, false, true, false]);
});
