import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetIslandStore } from "../store";
import { usePrewarm } from "./usePrewarm";

afterEach(() => vi.unstubAllGlobals());

it("subscribes to prewarm once, coalesces events and cancels all work on unmount", async () => {
  resetMock();
  resetIslandStore();
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++next, callback);
    return next;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
  function Harness() {
    const target = useRef<HTMLDivElement>(null);
    usePrewarm(target);
    return <div ref={target} />;
  }
  const view = render(<Harness />);
  await waitFor(() => expect(mockListenerCount("island://prewarm")).toBe(1));
  act(() => {
    mockEmit("island://prewarm", null);
    mockEmit("island://prewarm", null);
  });
  expect(callbacks.size).toBe(1);
  view.unmount();
  expect(callbacks.size).toBe(0);
  expect(mockListenerCount("island://prewarm")).toBe(0);
  act(() => mockEmit("island://prewarm", null));
  expect(callbacks.size).toBe(0);
});
