import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { resetDockStore } from "../../lib/dock/store";
import { resetMediaStore } from "../../lib/media/store";
import { resetAudioStore } from "../../lib/audio/store";
import { useTilesEditStore } from "../../lib/tiles/store";
import { resetIslandStore, useIslandStore } from "../../store";
import { HomeTab } from "./HomeTab";

const preference = vi.hoisted(() => ({ reduce: false }));
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

// Keep real Motion/presence, exposing layout opt-ins at the component boundary.
vi.mock("motion/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("motion/react")>();
  const { createElement, forwardRef } = await import("react");
  const cache = new Map();
  const motion = new Proxy(original.motion, {
    get(target, key) {
      if (!cache.has(key)) {
        const Component = Reflect.get(target, key);
        cache.set(key, forwardRef((props: Record<string, unknown>, ref) => createElement(Component, {
          ...props, ref, "data-test-layout": props.layout ? String(props.layout) : undefined,
        })));
      }
      return cache.get(key);
    },
  });
  return { ...original, motion, useReducedMotion: () => preference.reduce };
});

beforeEach(() => {
  resetMock(); resetIslandStore(); resetDockStore(); resetMediaStore(); resetAudioStore();
  useIslandStore.getState().setMode("expanded");
  useTilesEditStore.setState({ editing: true });
  preference.reduce = false;
});
afterEach(() => {
  resetDockStore(); resetMediaStore(); resetAudioStore();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

it.each([false, true])("keeps hit-test order stable until pointerup after repeated moves (lite=%s)", async (liteMode) => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const quickTiles = [{ id: "region", size: "1x1" }, { id: "screen", size: "1x1" }] as const;
  useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, liteMode, quickTiles: [...quickTiles] });
  const { container } = render(<HomeTab />);
  await screen.findByRole("button", { name: "Terminal" });
  const entries = () => Array.from(container.querySelectorAll<HTMLElement>("[data-tile-id]"));
  const order = () => entries().map((entry) => entry.dataset.tileId);
  // Model a fixed second cell, whose occupant would change if a preview reordered the DOM.
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => entries()[1] });
  const source = entries()[0];
  const spy = vi.spyOn(ipc, "invoke");
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
  for (let move = 0; move < 4; move++) {
    fireEvent.pointerMove(source, { clientX: 100 + move, clientY: 10 });
    expect(order()).toEqual(["region", "screen"]);
    expect(entries()[1]).toHaveAttribute("data-drop-target", "true");
    expect(source).toHaveAttribute("data-reordering", "true");
    expect(spy).not.toHaveBeenCalledWith("settings_set", expect.anything());
  }
  fireEvent.pointerUp(source);
  await waitFor(() => expect(order()).toEqual(["screen", "region"]));
  expect(useIslandStore.getState().settings.quickTiles.map((tile) => tile.id)).toEqual(["screen", "region"]);
  expect(spy).toHaveBeenCalledWith("settings_set", { patch: { quickTiles: [quickTiles[1], quickTiles[0]] } });
  expect(container.querySelector('[data-drop-target="true"], [data-reordering="true"]')).toBeNull();
});

it.each(["lite", "reduced", "collapsed"])("disables every Home layout opt-in for %s", async (setting) => {
  const { container, rerender } = render(<HomeTab />);
  await screen.findByRole("button", { name: "Terminal" });
  expect(container.querySelectorAll("[data-test-layout]").length).toBeGreaterThan(0);
  act(() => {
    if (setting === "lite") useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, liteMode: true });
    if (setting === "reduced") {
      preference.reduce = true;
      rerender(<HomeTab />);
    }
    if (setting === "collapsed") useIslandStore.getState().setMode("collapsed");
  });
  expect(container.querySelectorAll("[data-test-layout]")).toHaveLength(0);
});

it("only projects positions on one level of editing tiles and dock entries", async () => {
  const { container } = render(<HomeTab />);
  await screen.findByRole("button", { name: "Terminal" });
  for (const node of container.querySelectorAll("[data-test-layout]")) {
    expect(node).toHaveAttribute("data-test-layout", "position");
    expect(node.matches(".hm-tile-entry, .hm-dock-entry")).toBe(true);
    expect(node.querySelector("[data-test-layout]")).toBeNull();
  }
  act(() => useTilesEditStore.setState({ editing: false }));
  expect(container.querySelectorAll(".hm-tools [data-test-layout]")).toHaveLength(0);
});
