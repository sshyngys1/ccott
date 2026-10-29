import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import * as ipc from "../../ipc";
import { mockListenerCount, mockSetBattery, resetMock } from "../../ipc/mock";
import { initBatteryStore, useBatteryStore } from "./batteryStore";
import type { BatteryState } from "../../shared/types";

const cleanups: Array<() => void> = [];
beforeEach(() => resetMock());
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

it("shares one battery listener until the final consumer releases it", async () => {
  const first = initBatteryStore(); const second = initBatteryStore();
  cleanups.push(first, second);
  await waitFor(() => expect(mockListenerCount("system://battery")).toBe(1));
  first(); first();
  expect(mockListenerCount("system://battery")).toBe(1);
  second();
  expect(mockListenerCount("system://battery")).toBe(0);
});

it("keeps a newer battery event when an older initial load finishes later", async () => {
  let finish!: (state: BatteryState) => void;
  const original = ipc.invoke;
  vi.spyOn(ipc, "invoke").mockImplementation(((...args: Parameters<typeof ipc.invoke>) => {
    if (args[0] === "system_get_battery") return new Promise<BatteryState>(resolve => { finish = resolve; });
    return original(...args);
  }) as typeof ipc.invoke);
  cleanups.push(initBatteryStore());
  await waitFor(() => expect(mockListenerCount("system://battery")).toBe(1));
  mockSetBattery({ hasBattery: true, percent: 100, charging: false });
  finish({ hasBattery: false, percent: null, charging: null, acConnected: true, saver: null, remainingSeconds: null });
  await Promise.resolve();
  expect(useBatteryStore.getState().battery.percent).toBe(100);
});

it("unsubscribes even when listen resolves after the last unmount", async () => {
  let finish!: (stop: () => void) => void;
  vi.spyOn(ipc, "listen").mockImplementation((() => new Promise(resolve => { finish = resolve; })) as typeof ipc.listen);
  const release = initBatteryStore(); cleanups.push(release);
  release();
  const unlisten = vi.fn();
  finish(unlisten);
  await Promise.resolve();
  expect(unlisten).toHaveBeenCalledTimes(1);
});
