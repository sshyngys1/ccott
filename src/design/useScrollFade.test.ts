import { describe, expect, it } from "vitest";
import { scrollEdges } from "./useScrollFade";
import { clampProgress, ringRadius } from "./ProgressRing";

describe("scrollEdges", () => {
  it("no overflow → both edges reached (no fade)", () => {
    expect(scrollEdges(0, 200, 246)).toEqual({ atStart: true, atEnd: true });
  });
  it("top of a long list → fade only at the bottom", () => {
    expect(scrollEdges(0, 600, 246)).toEqual({ atStart: true, atEnd: false });
  });
  it("middle → fade at both edges", () => {
    expect(scrollEdges(120, 600, 246)).toEqual({ atStart: false, atEnd: false });
  });
  it("end (with sub-pixel shortfall at fractional DPI) → fade only at the top", () => {
    expect(scrollEdges(353.4, 600, 246)).toEqual({ atStart: false, atEnd: true });
  });
});

describe("ProgressRing helpers", () => {
  it("radius keeps the stroke inside the box", () => {
    expect(ringRadius(120, 6)).toBe(57);
    expect(ringRadius(22, 2.5)).toBe(9.75);
    expect(ringRadius(2, 6)).toBe(0);
  });
  it("clamps progress to 0..1", () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(3)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});
