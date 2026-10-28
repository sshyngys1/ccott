import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetIslandStore, useIslandStore } from "../store";
import type { IslandModule } from "../shared/types";
import { useShellBus } from "./shellBus";

beforeEach(() => {
  resetMock();
  resetIslandStore();
});

async function harness() {
  let ready = () => {};
  const prepare = vi.fn(() => new Promise<void>((resolve) => { ready = resolve; }));
  const controls = {
    summon: vi.fn(() => useIslandStore.getState().setMode("expanded")),
    collapseNow: vi.fn(() => useIslandStore.getState().setMode("collapsed")),
    expandNow: vi.fn(() => useIslandStore.getState().setMode("expanded")),
  };
  const release = vi.fn(async () => {});
  const tabs: readonly IslandModule[] = [];
  const view = renderHook(() => useShellBus(controls, release, tabs, prepare));
  await waitFor(() => expect(mockListenerCount("island://summoned")).toBe(1));
  return { controls, prepare, view, ready: () => ready() };
}

it("summon waits for the wake-up frame before expanding", async () => {
  const test = await harness();
  act(() => mockEmit("island://summoned", null));
  expect(test.controls.summon).not.toHaveBeenCalled();
  await act(async () => test.ready());
  expect(test.controls.summon).toHaveBeenCalledOnce();
});

it.each(["second hotkey", "settings", "unmount"])("%s cancels a deferred summon", async (cancel) => {
  const test = await harness();
  act(() => mockEmit("island://summoned", null));
  if (cancel === "second hotkey") act(() => mockEmit("island://summoned", null));
  else if (cancel === "settings") act(() => mockEmit("island://open-settings", null));
  else test.view.unmount();
  await act(async () => test.ready());
  expect(test.controls.summon).not.toHaveBeenCalled();
  if (cancel === "settings") expect(useIslandStore.getState().view).toBe("settings");
});
