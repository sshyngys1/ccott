// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, type RGB } from "./contrast";
import {
  LYRICS_CONTRAST,
  LYRICS_FALLBACK,
  activeLineIndex,
  dominantColors,
  hslToRgb,
  lineState,
  lyricLevel,
  lyricsPalette,
  paletteContrast,
  rgbToHsl,
  staggerSteps,
} from "./lyrics";

/** Solid w×h RGBA bitmap, optionally with a second colour on the right `split` fraction. */
function bitmap(main: RGB, other?: RGB, split = 0.3, size = 24): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = other && x >= size * (1 - split) ? other : main;
      const i = (y * size + x) * 4;
      data.set([c[0], c[1], c[2], 255], i);
    }
  return data;
}

const mix = (a: string, b: string): RGB => {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return [0, 1, 2].map((i) => (x[i] + y[i]) / 2) as unknown as RGB;
};

describe("HSL round trip", () => {
  it("converts back to the same colour", () => {
    for (const c of [[255, 0, 0], [12, 200, 180], [90, 90, 90], [240, 200, 40]] as RGB[]) {
      const [h, s, l] = rgbToHsl(c);
      const back = hslToRgb(h, s, l);
      back.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThanOrEqual(1));
    }
  });
});

describe("dominantColors", () => {
  it("prefers the saturated colour over a larger black area", () => {
    const [first] = dominantColors(bitmap([8, 8, 8], [230, 60, 120], 0.35));
    expect(rgbToHsl(first)[1]).toBeGreaterThan(0.5);
  });
  it("returns distinct hues only", () => {
    const colors = dominantColors(bitmap([230, 60, 40], [40, 90, 230], 0.5));
    expect(colors.length).toBe(2);
  });
  it("ignores transparent pixels", () => {
    expect(dominantColors(new Uint8ClampedArray(24 * 24 * 4))).toEqual([]);
  });
});

describe("lyricsPalette keeps white text readable", () => {
  const covers: Record<string, Uint8ClampedArray> = {
    white: bitmap([255, 255, 255]),
    yellow: bitmap([255, 230, 40]),
    pastel: bitmap([250, 200, 220], [200, 240, 255]),
    sunset: bitmap([255, 120, 40], [200, 40, 140], 0.4),
    black: bitmap([0, 0, 0]),
    grey: bitmap([128, 128, 128]),
    teal: bitmap([30, 220, 200], [250, 250, 250], 0.2),
  };
  for (const theme of ["dark", "light"] as const) {
    for (const [name, data] of Object.entries(covers)) {
      it(`${theme} × ${name}: every stop and every midpoint ≥ target`, () => {
        const p = lyricsPalette(data, theme);
        expect(paletteContrast(p)).toBeGreaterThanOrEqual(LYRICS_CONTRAST[theme]);
        for (const [x, y] of [[p.a, p.b], [p.b, p.c], [p.a, p.c]]) {
          expect(contrastRatio([255, 255, 255], mix(x, y))).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
  it("grey covers stay grey (no invented hue)", () => {
    const p = lyricsPalette(bitmap([128, 128, 128]), "dark");
    expect(rgbToHsl(hexToRgb(p.a))[1]).toBeLessThan(0.1);
  });
  it("falls back without pixels; the fallback matches tokens.css and is readable", () => {
    expect(lyricsPalette(new Uint8ClampedArray(16), "dark")).toEqual(LYRICS_FALLBACK);
    expect(paletteContrast(LYRICS_FALLBACK)).toBeGreaterThanOrEqual(LYRICS_CONTRAST.dark);
    const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    for (const k of ["a", "b", "c"] as const) expect(css).toContain(`--ig-lyrics-bg-${k}: ${LYRICS_FALLBACK[k]};`);
  });
});

describe("active line and levels", () => {
  const lines = [{ timeMs: 1000 }, { timeMs: 4000 }, { timeMs: 7000 }, { timeMs: 9000 }];
  it("finds the active line with a lead", () => {
    expect(activeLineIndex(lines, 0, 0)).toBe(-1);
    expect(activeLineIndex(lines, 1000, 0)).toBe(0);
    expect(activeLineIndex(lines, 3900, 0)).toBe(0);
    expect(activeLineIndex(lines, 3900, 150)).toBe(1);
    expect(activeLineIndex(lines, 60000, 0)).toBe(3);
    expect(activeLineIndex([], 5000)).toBe(-1);
  });
  it("blur levels are static steps by distance; far lines get no filter", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12].map((i) => lyricLevel(i, 3))).toEqual([3, 2, 1, 0, 1, 2, 3, 3, 3, 4, 4]);
    expect(lyricLevel(0, -1)).toBe(1);
    expect(lineState(1, 2)).toBe("past");
    expect(lineState(2, 2)).toBe("active");
    expect(lineState(5, 2)).toBe("next");
  });
  it("only lines below the active one are staggered, capped", () => {
    expect([0, 3, 4, 5, 20].map((i) => staggerSteps(i, 3))).toEqual([0, 0, 1, 2, 6]);
  });
});
