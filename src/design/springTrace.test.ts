// @vitest-environment node
// Runs the real Motion spring solver over our presets: pill ↔ panel width, the most visible animated value.
import { spring } from "motion";
import { describe, expect, it } from "vitest";
import { DEFAULT_GEOMETRY } from "./geometry";
import { springs } from "./motion";

type Preset = (typeof springs)[keyof typeof springs];

function trace(preset: Preset, from: number, to: number) {
  const gen = spring({ ...preset, keyframes: [from, to] });
  const values: number[] = [];
  let settledAt = -1;
  for (let t = 0; t <= 2000; t += 1000 / 120) {
    const { value, done } = gen.next(t);
    values.push(value as number);
    if (done && settledAt < 0) settledAt = t;
  }
  // Last sample that is still more than 2 px away from the target → "visually there" one frame later.
  let lastFar = 0;
  values.forEach((v, i) => {
    if (Math.abs(v - to) > 2) lastFar = i;
  });
  const within2pxAt = ((lastFar + 1) * 1000) / 120;
  return { values, settledAt, within2pxAt, max: Math.max(...values), min: Math.min(...values) };
}

describe("spring traces (Motion solver)", () => {
  const { pill, panel } = DEFAULT_GEOMETRY;

  it("expand overshoots the panel width by a few px, is visually there in < 320 ms and settles < 500 ms", () => {
    const r = trace(springs.expand, pill.width, panel.width);
    const over = r.max - panel.width;
    expect(over).toBeGreaterThan(4);
    expect(over).toBeLessThan(40); // panel + overshoot must stay inside the 800px window
    expect(panel.width + over).toBeLessThan(800);
    expect(r.settledAt).toBeGreaterThan(0);
    expect(r.settledAt).toBeLessThan(500);
    expect(r.within2pxAt).toBeLessThan(320);
  });

  it("collapse never undershoots the pill and settles < 360 ms", () => {
    const r = trace(springs.collapse, panel.width, pill.width);
    expect(r.min).toBeGreaterThanOrEqual(pill.width - 0.5);
    expect(r.settledAt).toBeGreaterThan(0);
    expect(r.settledAt).toBeLessThan(360);
    expect(r.within2pxAt).toBeLessThan(250);
  });

  it("expand height overshoot keeps the panel inside the 520px window", () => {
    const r = trace(springs.expand, pill.height, panel.height);
    expect(DEFAULT_GEOMETRY.top + r.max).toBeLessThan(520);
  });
});
