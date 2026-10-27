import { describe, expect, it } from "vitest";
import { DEFAULT_GEOMETRY, islandShape } from "../design/geometry";
import { overshoot, springs } from "../design/motion";
import { ISLAND_WINDOW, type IslandShape } from "../shared/types";
import { coverShape, sameShape, unionShape } from "./shape";

const { pill, panel, top } = DEFAULT_GEOMETRY;
const pillShape = islandShape(pill, top, ISLAND_WINDOW.width);
const panelShape = islandShape(panel, top, ISLAND_WINDOW.width);

const contains = (outer: IslandShape, inner: IslandShape) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

describe("unionShape", () => {
  it("is the bounding box of both shapes with the larger radius", () => {
    const u = unionShape(pillShape, panelShape);
    expect(contains(u, pillShape)).toBe(true);
    expect(contains(u, panelShape)).toBe(true);
    expect(u).toEqual(panelShape); // the pill sits inside the panel
    expect(u.radius).toBe(Math.max(pillShape.radius, panelShape.radius));
  });
});

describe("coverShape (what is sent when a transition starts)", () => {
  it("expand: covers the spring overshoot of the panel (720 → ~747 px wide, ~415 px tall) but stays inside the window", () => {
    const c = coverShape(pillShape, panelShape, overshoot(springs.expand));
    // Peak of the real solver trace: width 746.9, height ≈ 416 (see springTrace.test.ts).
    const peakW = 747;
    const peakH = 416; // 396 + 19.5 (solver)
    expect(c.width).toBeGreaterThanOrEqual(peakW);
    expect(c.x + c.width / 2).toBeCloseTo(ISLAND_WINDOW.width / 2, 0); // stays centered
    expect(c.y + c.height).toBeGreaterThanOrEqual(top + peakH);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(ISLAND_WINDOW.width);
    expect(c.y + c.height).toBeLessThanOrEqual(ISLAND_WINDOW.height);
    expect(contains(c, panelShape)).toBe(true);
    expect(contains(c, pillShape)).toBe(true);
  });

  it("collapse: keeps the big current shape (nothing shrinks under the cursor) — critically damped, no extra growth", () => {
    const c = coverShape(panelShape, pillShape, overshoot(springs.collapse));
    expect(contains(c, panelShape)).toBe(true);
    expect(c.width - panelShape.width).toBeLessThanOrEqual(2); // only the 1px safety margin per side
  });

  it("never exceeds the window, whatever the overshoot", () => {
    const c = coverShape(pillShape, panelShape, 5);
    expect(c.x).toBe(0);
    expect(c.x + c.width).toBeLessThanOrEqual(ISLAND_WINDOW.width);
    expect(c.y + c.height).toBeLessThanOrEqual(ISLAND_WINDOW.height);
  });
});

describe("sameShape", () => {
  it("compares with an epsilon", () => {
    expect(sameShape(pillShape, { ...pillShape, width: pillShape.width + 0.01 })).toBe(true);
    expect(sameShape(pillShape, { ...pillShape, width: pillShape.width + 1 })).toBe(false);
    expect(sameShape(pillShape, { ...pillShape, width: pillShape.width + 1 }, 1.5)).toBe(true);
  });
});
