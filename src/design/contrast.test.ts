// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, over, stackContrast, type RGB, type RGBA } from "./contrast";

// ── Minimal tokens.css reader: resolves --ig-* colours for a (theme, vibrancy) pair in cascade (= file) order. ──
const tokensCss = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url).href), "utf8");
const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  decls: Object.fromEntries(
    [...m[2].matchAll(/(--ig-[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()] as const),
  ),
}));

type Theme = "dark" | "light";
type Vibrancy = "none" | "acrylic" | "mica";

function resolve(theme: Theme, vibrancy: Vibrancy): Record<string, string> {
  const matches = (sel: string) => {
    if (sel === ":root") return true;
    if (sel === ':root[data-theme="light"]') return theme === "light";
    if (sel === `:root[data-vibrancy="${vibrancy}"]`) return vibrancy !== "none";
    if (sel === `:root[data-theme="light"][data-vibrancy="${vibrancy}"]`) return theme === "light" && vibrancy !== "none";
    return false;
  };
  return Object.assign({}, ...blocks.filter((b) => matches(b.selector)).map((b) => b.decls));
}

function color(value: string): RGBA {
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
  if (value.startsWith("#")) return [...hexToRgb(value), 1];
  throw new Error(`unsupported colour: ${value}`);
}

/** Worst-case backdrop under the island for each mode (see design-spec §10). */
const WORST: Record<Theme, Record<Vibrancy, RGB>> = {
  // Dark glass is hardest to read over a white desktop (white browser tab behind the island).
  // Mica samples the wallpaper and is tinted dark by DWM — its brightest realistic result is a mid-dark grey.
  dark: { none: [255, 255, 255], acrylic: [255, 255, 255], mica: [80, 80, 90] },
  light: { none: [0, 0, 0], acrylic: [0, 0, 0], mica: [190, 190, 200] },
};

const combos = (["dark", "light"] as const).flatMap((t) =>
  (["none", "acrylic", "mica"] as const).map((v) => [t, v] as const),
);

describe("WCAG helpers", () => {
  it("black on white is 21:1", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });
  it("composites translucent colours in sRGB", () => {
    expect(over([0, 0, 0, 0.5], [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
  });
});

describe.each(combos)("tokens %s × %s keep text readable on the worst backdrop", (theme, vibrancy) => {
  const t = resolve(theme, vibrancy);
  const backdrop = WORST[theme][vibrancy];
  const surface = color(t["--ig-surface"]);
  const raised = color(t["--ig-surface-raised"]);

  it.each([
    ["--ig-text", 4.5],
    ["--ig-text-secondary", 4.5],
    ["--ig-text-tertiary", 3],
  ] as const)("%s ≥ %s:1 on panel and on raised tiles", (name, min) => {
    const text = color(t[name]);
    expect(stackContrast(text, [surface], backdrop)).toBeGreaterThanOrEqual(min);
    expect(stackContrast(text, [surface, raised], backdrop)).toBeGreaterThanOrEqual(min);
  });

  it("text on accent ≥ 4.5:1", () => {
    const accent = color(t["--ig-accent"]);
    expect(stackContrast(color(t["--ig-text-on-accent"]), [accent], backdrop)).toBeGreaterThanOrEqual(4.5);
  });

  // ── Wave 2 pairs (design-spec §6.3–§6.9) ──
  it.each(["--ig-accent-text", "--ig-danger-text", "--ig-success-text", "--ig-warning-text"] as const)(
    "coloured text %s ≥ 4.5:1 on panel and on cards",
    (name) => {
      const text = color(t[name]);
      expect(stackContrast(text, [surface], backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(stackContrast(text, [surface, raised], backdrop)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("error message: --ig-danger-text on --ig-danger-soft ≥ 4.5:1", () => {
    const soft = color(t["--ig-danger-soft"]);
    expect(stackContrast(color(t["--ig-danger-text"]), [surface, soft], backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(stackContrast(color(t["--ig-text"]), [surface, soft], backdrop)).toBeGreaterThanOrEqual(4.5);
  });

  it("timer finished: text on --ig-success-soft ≥ 4.5:1 (green is carried by the ring/icon, not by the text)", () => {
    const soft = color(t["--ig-success-soft"]);
    expect(stackContrast(color(t["--ig-text"]), [surface, raised, soft], backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(stackContrast(color(t["--ig-text-secondary"]), [surface, raised, soft], backdrop)).toBeGreaterThanOrEqual(4.5);
  });

  it("keyboard-selected row (--ig-row-selected inside a card) keeps text AA and tertiary ≥ 3:1", () => {
    const sel = color(t["--ig-row-selected"]);
    for (const layers of [[surface, sel], [surface, raised, sel]]) {
      expect(stackContrast(color(t["--ig-text"]), layers, backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(stackContrast(color(t["--ig-text-secondary"]), layers, backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(stackContrast(color(t["--ig-text-tertiary"]), layers, backdrop)).toBeGreaterThanOrEqual(3);
    }
  });

  it("open item (aria-current: --ig-row-current inside a card): title AA, meta (tertiary) ≥ 3:1", () => {
    const cur = color(t["--ig-row-current"]);
    expect(stackContrast(color(t["--ig-text"]), [surface, raised, cur], backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(stackContrast(color(t["--ig-text-tertiary"]), [surface, raised, cur], backdrop)).toBeGreaterThanOrEqual(3);
  });

  it("text on sunken fields (inputs, textarea, editor) keeps AA; placeholder ≥ 3:1", () => {
    const sunken = color(t["--ig-surface-sunken"]);
    for (const layers of [[surface, sunken], [surface, raised, sunken]]) {
      expect(stackContrast(color(t["--ig-text"]), layers, backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(stackContrast(color(t["--ig-text-secondary"]), layers, backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(stackContrast(color(t["--ig-text-tertiary"]), layers, backdrop)).toBeGreaterThanOrEqual(3);
    }
  });

  it("focus line (--ig-accent-text in --ig-focus-ring) ≥ 3:1 against panel, card and field (non-text contrast)", () => {
    const line = color(t["--ig-accent-text"]);
    const sunken = color(t["--ig-surface-sunken"]);
    expect(stackContrast(line, [surface], backdrop)).toBeGreaterThanOrEqual(3);
    expect(stackContrast(line, [surface, raised], backdrop)).toBeGreaterThanOrEqual(3);
    expect(stackContrast(line, [surface, raised, sunken], backdrop)).toBeGreaterThanOrEqual(3);
  });
});

describe("collapsed pill (both themes)", () => {
  it("light text on the near-black pill ≥ 7:1 even over white", () => {
    const t = resolve("light", "none");
    const strong = color(t["--ig-surface-strong"]);
    const text = color(t["--ig-text-on-strong"]);
    expect(stackContrast(text, [strong], [255, 255, 255])).toBeGreaterThanOrEqual(7);
    // .ig-glass--pill maps secondary to 70 % of on-strong
    expect(stackContrast([text[0], text[1], text[2], 0.7], [strong], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });
});
