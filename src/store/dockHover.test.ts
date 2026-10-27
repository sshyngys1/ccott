import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mockEmit, resetMock } from "../ipc/mock";
import { resetDockStore, useDockStore } from "../lib/dock/store";
import { resetIslandStore, useIslandStore } from ".";
import { useHoverSync } from "./useHoverSync";
afterEach(()=>{resetDockStore();resetIslandStore();vi.useRealTimers();});
it("keeps the panel open during native drag/dialog, then resumes ordinary hover collapse",async()=>{
  resetMock();resetDockStore();resetIslandStore();vi.useFakeTimers();
  const hook=renderHook(()=>useHoverSync());
  await act(async()=>{});
  act(()=>{useDockStore.setState({dragging:true});hook.result.current.expandNow();mockEmit("island://hover",{inside:false});vi.advanceTimersByTime(1000);});
  expect(useIslandStore.getState().mode).toBe("expanded");
  act(()=>{useDockStore.setState({interacting:true,dragging:false});vi.advanceTimersByTime(1000);});
  expect(useIslandStore.getState().mode).toBe("expanded");
  act(()=>{useDockStore.setState({interacting:false});vi.advanceTimersByTime(400);});
  expect(useIslandStore.getState().mode).toBe("collapsed");hook.unmount();
});
