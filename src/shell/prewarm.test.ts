import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompositorPrewarm } from "./prewarm";

let target: HTMLDivElement;
let warm: CompositorPrewarm;
let callbacks: Map<number, FrameRequestCallback>;
let nextId: number;

beforeEach(() => {
  nextId = 0;
  callbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
  target = document.createElement("div");
  target.style.width = "224px";
  target.textContent = "12:34";
  document.body.appendChild(target);
  warm = new CompositorPrewarm(target);
});

afterEach(() => {
  warm.dispose();
  target.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame() {
  const pending = [...callbacks.values()];
  callbacks.clear();
  pending.forEach((callback) => callback(performance.now()));
}

it("paints one wake-up frame, restores its surface and never changes island geometry or content", async () => {
  const before = target.outerHTML;
  const ready = warm.pulse();
  expect(warm.pulse()).toBe(ready);
  expect(target.style.getPropertyValue("--ig-prewarm-alpha")).toBe("0.99999");
  expect(target.style.width).toBe("224px");
  expect(target.textContent).toBe("12:34");
  frame();
  expect(callbacks.size).toBe(1);
  frame();
  await ready;
  expect(target.outerHTML).toBe(before);
  expect(callbacks.size).toBe(0);
  expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  await warm.pulse(); // coalesces an immediate repeated event
  expect(callbacks.size).toBe(0);
});

it("cancels the outstanding frame and resolves waiters when unmounted", async () => {
  const ready = warm.pulse();
  frame();
  warm.dispose();
  await ready;
  expect(callbacks.size).toBe(0);
  expect(target.style.getPropertyValue("--ig-prewarm-alpha")).toBe("");
  await warm.pulse();
  expect(callbacks.size).toBe(0);
});
