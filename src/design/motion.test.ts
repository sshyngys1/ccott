import { describe, expect, it } from "vitest";
import { dampingRatio, durations, fades, overshoot, springs } from "./motion";

describe("springs", () => {
  it("expand is underdamped with a light overshoot (2–10 %)", () => {
    const z = dampingRatio(springs.expand);
    expect(z).toBeGreaterThan(0.55);
    expect(z).toBeLessThan(0.85);
    expect(overshoot(springs.expand)).toBeGreaterThan(0.02);
    expect(overshoot(springs.expand)).toBeLessThan(0.1);
  });

  it("collapse is critically damped or stiffer → no bounce", () => {
    expect(dampingRatio(springs.collapse)).toBeGreaterThanOrEqual(1);
    expect(overshoot(springs.collapse)).toBe(0);
  });

  it("collapse is faster than expand (higher natural frequency)", () => {
    expect(Math.sqrt(springs.collapse.stiffness)).toBeGreaterThan(Math.sqrt(springs.expand.stiffness));
  });

  it("tab and press barely overshoot (< 2 %)", () => {
    expect(overshoot(springs.tab)).toBeLessThan(0.02);
    expect(overshoot(springs.press)).toBeLessThan(0.02);
  });

  it("wave 2: view slide barely overshoots, list reorder never does", () => {
    expect(overshoot(springs.view)).toBeLessThan(0.01);
    expect(dampingRatio(springs.list)).toBeGreaterThanOrEqual(0.98);
    expect(overshoot(springs.list)).toBeLessThan(0.001);
  });

  it("all presets are springs", () => {
    for (const s of Object.values(springs)) expect(s.type).toBe("spring");
  });
});

describe("speed (polish pass: ~30 % faster than the first spike)", () => {
  it("natural frequency of every preset is at least 1.3× the original", () => {
    const original = { expand: 340, collapse: 700, tab: 520, press: 900, pill: 420 } as const;
    for (const [name, k] of Object.entries(original)) {
      const now = springs[name as keyof typeof original].stiffness;
      expect(Math.sqrt(now / k)).toBeGreaterThanOrEqual(1.3);
    }
  });

  it("keeps the feel: damping ratios of the original presets are preserved (±0.02)", () => {
    expect(dampingRatio(springs.expand)).toBeCloseTo(0.678, 1);
    expect(dampingRatio(springs.collapse)).toBeCloseTo(1.02, 1);
    expect(dampingRatio(springs.tab)).toBeCloseTo(0.833, 1);
    expect(dampingRatio(springs.press)).toBeCloseTo(0.8, 1);
    expect(dampingRatio(springs.pill)).toBeCloseTo(0.732, 1);
  });

  it("durations and content fades are shorter than before", () => {
    expect(durations.fast).toBeLessThanOrEqual(0.1);
    expect(durations.med).toBeLessThanOrEqual(0.16);
    expect(durations.slow).toBeLessThanOrEqual(0.26);
    expect(fades.panelIn.duration + fades.panelIn.delay).toBeLessThanOrEqual(0.22);
    expect(fades.panelOut.duration).toBeLessThan(fades.panelIn.duration);
  });
});

describe("dampingRatio", () => {
  it("matches the textbook formula", () => {
    expect(dampingRatio({ stiffness: 100, damping: 20 })).toBeCloseTo(1);
    expect(dampingRatio({ stiffness: 100, damping: 10, mass: 4 })).toBeCloseTo(0.25);
  });
});
