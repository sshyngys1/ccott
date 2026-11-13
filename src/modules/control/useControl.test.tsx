import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import type { ControlState } from "../../shared/types";
import { useControl } from "./useControl";

beforeEach(() => { resetMock(); resetIslandStore(); });
afterEach(() => { cleanup(); resetIslandStore(); vi.restoreAllMocks(); });
it("keeps the event snapshot when control_get resolves with an older snapshot", async () => {
  const old = await ipc.invoke("control_get");
  const fresh: ControlState = { ...old, darkMode: !old.darkMode };
  let resolve!: (value: ControlState) => void;
  const pending = new Promise<ControlState>(done => { resolve = done; });
  const original = ipc.invoke;
  vi.spyOn(ipc, "invoke").mockImplementation((...args: Parameters<typeof ipc.invoke>) => args[0] === "control_get" ? pending : original(...args));
  const { result } = renderHook(useControl);
  await waitFor(() => expect(mockListenerCount("control://changed")).toBe(1));
  act(() => mockEmit("control://changed", fresh));
  await act(async () => { resolve(old); });
  expect(result.current.state).toEqual(fresh);
});
it("uses the initial return snapshot without an event and ignores it after disable", async () => {
  const snapshot = await ipc.invoke("control_get");
  const { result, unmount } = renderHook(useControl);
  await waitFor(() => expect(result.current.state).toEqual(snapshot));
  unmount();
  let resolve!: (value: ControlState) => void;
  const pending = new Promise<ControlState>(done => { resolve = done; });
  const original = ipc.invoke;
  vi.spyOn(ipc, "invoke").mockImplementation((...args: Parameters<typeof ipc.invoke>) => args[0] === "control_get" ? pending : original(...args));
  const view = renderHook(useControl);
  await waitFor(() => expect(mockListenerCount("control://changed")).toBe(1));
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["control"] }));
  await act(async () => { resolve(snapshot); });
  expect(view.result.current.state).toBeNull();
});
