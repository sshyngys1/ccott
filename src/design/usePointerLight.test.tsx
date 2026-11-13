import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toLocalPoint, usePointerLight } from "./usePointerLight";

function Probe({ disabled = false }: { disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointerLight(ref, { disabled });
  return <div ref={ref} data-testid="glass" />;
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  pending.forEach((cb) => cb(0));
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(disabled = false) {
  const utils = render(<Probe disabled={disabled} />);
  const el = utils.getByTestId("glass");
  el.getBoundingClientRect = () => ({ left: 100, top: 20, width: 200, height: 40 }) as DOMRect;
  return { ...utils, el };
}

describe("toLocalPoint", () => {
  it("subtracts the rect origin and rounds to 0.1px", () => {
    expect(toLocalPoint(150.04, 30.06, { left: 100, top: 20 })).toEqual({ x: 50, y: 10.1 });
  });
});

describe("usePointerLight", () => {
  it("writes element-local coordinates once per frame", () => {
    const { el } = setup();
    fireEvent.pointerMove(el, { clientX: 110, clientY: 25 });
    fireEvent.pointerMove(el, { clientX: 160, clientY: 45 });
    expect(frames).toHaveLength(1); // coalesced
    expect(el.style.getPropertyValue("--ig-pointer-x")).toBe("");
    flushFrames();
    expect(el.style.getPropertyValue("--ig-pointer-x")).toBe("60px");
    expect(el.style.getPropertyValue("--ig-pointer-y")).toBe("25px");
  });

  it("toggles --ig-pointer-active on enter/leave", () => {
    const { el } = setup();
    fireEvent.pointerEnter(el, { clientX: 120, clientY: 30 });
    expect(el.style.getPropertyValue("--ig-pointer-active")).toBe("1");
    fireEvent.pointerLeave(el);
    expect(el.style.getPropertyValue("--ig-pointer-active")).toBe("0");
  });

  it("does nothing when disabled and cleans up on unmount", () => {
    const off = setup(true);
    fireEvent.pointerMove(off.el, { clientX: 110, clientY: 25 });
    expect(frames).toHaveLength(0);
    off.unmount();

    const on = setup();
    fireEvent.pointerEnter(on.el, { clientX: 120, clientY: 30 });
    flushFrames();
    const el = on.el;
    on.unmount();
    expect(el.style.getPropertyValue("--ig-pointer-active")).toBe("");
    expect(el.style.getPropertyValue("--ig-pointer-x")).toBe("");
  });
});
