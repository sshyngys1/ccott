// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ISLAND_WINDOW } from "../shared/types";
import { DEFAULT_GEOMETRY, hoveredPill, islandShape, parsePx } from "./geometry";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url).href), "utf8");
const token = (name: string) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return parsePx(m[1], NaN);
};

describe("parsePx", () => {
  it("parses px values", () => {
    expect(parsePx("224px")).toBe(224);
    expect(parsePx(" 12.5px ")).toBe(12.5);
    expect(parsePx("-4px")).toBe(-4);
  });
  it("falls back on anything else", () => {
    expect(parsePx("", 7)).toBe(7);
    expect(parsePx("2rem", 7)).toBe(7);
    expect(parsePx(null, 3)).toBe(3);
  });
});

describe("tokens.css ↔ DEFAULT_GEOMETRY", () => {
  it("stay in sync", () => {
    expect(token("--ig-pill-top")).toBe(DEFAULT_GEOMETRY.top);
    expect(token("--ig-pill-width")).toBe(DEFAULT_GEOMETRY.pill.width);
    expect(token("--ig-pill-height")).toBe(DEFAULT_GEOMETRY.pill.height);
    expect(token("--ig-radius-pill")).toBe(DEFAULT_GEOMETRY.pill.radius);
    expect(token("--ig-pill-width-activity")).toBe(DEFAULT_GEOMETRY.pillActivity.width);
    expect(token("--ig-pill-width-toast")).toBe(DEFAULT_GEOMETRY.pillToast.width);
    expect(token("--ig-pill-hover-grow")).toBe(DEFAULT_GEOMETRY.pillHoverGrow);
    expect(token("--ig-panel-width")).toBe(DEFAULT_GEOMETRY.panel.width);
    expect(token("--ig-panel-height")).toBe(DEFAULT_GEOMETRY.panel.height);
    expect(token("--ig-radius-panel")).toBe(DEFAULT_GEOMETRY.panel.radius);
  });

  it("pill radius is half its height (true capsule)", () => {
    expect(DEFAULT_GEOMETRY.pill.radius * 2).toBe(DEFAULT_GEOMETRY.pill.height);
  });

  it("panel + outer shadow fit into the 800×520 window", () => {
    const { panel, top } = DEFAULT_GEOMETRY;
    // --ig-shadow worst layer: 0 28px 56px -20px → reaches 36px sideways, 28+36 = 64px down, 36−28 = 8px up.
    const side = (ISLAND_WINDOW.width - panel.width) / 2;
    expect(side).toBeGreaterThanOrEqual(36);
    expect(top + panel.height + 64).toBeLessThanOrEqual(ISLAND_WINDOW.height);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("all pill variants fit the window", () => {
    const { pillActivity, pillToast, pill, pillHoverGrow } = DEFAULT_GEOMETRY;
    for (const p of [pill, pillActivity, pillToast, hoveredPill(pillToast, pillHoverGrow)]) {
      expect(p.width).toBeLessThan(ISLAND_WINDOW.width);
    }
  });
});

describe("islandShape", () => {
  it("centers the box at the top of the window", () => {
    expect(islandShape({ width: 224, height: 36, radius: 18 }, 8, 800)).toEqual({
      x: 288,
      y: 8,
      width: 224,
      height: 36,
      radius: 18,
    });
  });
  it("rounds outward for fractional sizes mid-animation", () => {
    const s = islandShape({ width: 301.3, height: 40.4, radius: 19.6 }, 8, 800);
    expect(s.x).toBe(249);
    expect(s.x + s.width).toBe(551);
    expect(s.height).toBe(41);
    expect(s.radius).toBe(20);
  });
});

describe("hoveredPill", () => {
  it("grows and stays a capsule", () => {
    const h = hoveredPill({ width: 224, height: 36, radius: 18 }, 12);
    expect(h).toEqual({ width: 236, height: 38, radius: 19 });
  });
});
