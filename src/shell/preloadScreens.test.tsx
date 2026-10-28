import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { deferredScreen } from "../lib/deferredScreen";
import { resetIslandStore, useIslandStore } from "../store";
import { backgroundScreens, scheduleScreenPreload } from "./preloadScreens";

let nextId: number;
let frames: Map<number, FrameRequestCallback>;
let idleCallbacks: Map<number, IdleRequestCallback>;
const stops: (() => void)[] = [];

beforeEach(() => {
  resetMock();
  resetIslandStore();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  nextId = 0;
  frames = new Map();
  idleCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idleCallbacks.delete(id));
});

afterEach(() => {
  cleanup();
  stops.splice(0).forEach(stop => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(performance.now()));
}

function idleTurn() {
  const pending = [...idleCallbacks.values()];
  idleCallbacks.clear();
  pending.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
}

it("preloads real screens after paint/idle so switching tabs never renders a Suspense fallback", async () => {
  expect(backgroundScreens.every(tab => !tab.isLoaded())).toBe(true);
  const preloads = backgroundScreens.map(tab => vi.spyOn(tab, "preload"));
  stops.push(scheduleScreenPreload());
  frame();
  frame();
  await vi.advanceTimersByTimeAsync(1499);
  expect(idleCallbacks.size).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  for (const [index, tab] of backgroundScreens.entries()) {
    expect(idleCallbacks.size).toBe(1);
    await act(async () => {
      idleTurn();
      expect(preloads[index]).toHaveBeenCalledOnce();
      await preloads[index].mock.results[0].value;
    });
    expect(tab.isLoaded()).toBe(true);
  }
  expect(idleCallbacks.size).toBe(0);
  const fallback = vi.fn();
  function Fallback() {
    fallback();
    return <div data-testid="screen-fallback" />;
  }
  const view = render(<div />);
  const names = ["Буфер обмена", "Текст", "Заметки"];
  for (const [index, tab] of backgroundScreens.slice(0, 3).entries()) {
    await act(async () => {
      view.rerender(<Suspense fallback={<Fallback />}>{createElement(tab.Screen)}</Suspense>);
    });
    expect(screen.getByRole("heading", { name: names[index] })).toBeInTheDocument();
    expect(screen.queryByTestId("screen-fallback")).toBeNull();
  }
  expect(fallback).not.toHaveBeenCalled();
});

it.each(["hover", "prewarm"])("defers imports during a recent %s transition", async (activity) => {
  const importer = vi.fn(async () => ({ default: () => null }));
  const tab = deferredScreen(importer);
  stops.push(scheduleScreenPreload([tab]));
  frame();
  frame();
  await vi.advanceTimersByTimeAsync(1400);
  if (activity === "hover") useIslandStore.getState().setHoverInside(true);
  else {
    expect(mockListenerCount("island://prewarm")).toBe(1);
    mockEmit("island://prewarm", null);
  }
  await vi.advanceTimersByTimeAsync(100);
  idleTurn();
  expect(importer).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(650);
  idleTurn();
  expect(importer).toHaveBeenCalledOnce();
  await importer.mock.results[0].value;
});

it("cancels pending paint/idle work on unmount and supports the timeout fallback", async () => {
  const importer = vi.fn(async () => ({ default: () => null }));
  const tab = deferredScreen(importer);
  const cancel = scheduleScreenPreload([tab]);
  cancel();
  expect(frames.size).toBe(0);
  vi.stubGlobal("requestIdleCallback", undefined);
  stops.push(scheduleScreenPreload([tab]));
  frame();
  frame();
  await vi.advanceTimersByTimeAsync(1501);
  expect(importer).toHaveBeenCalledOnce();
  expect(tab.isLoaded()).toBe(true);
});
