// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const glass = readFileSync(new URL("./glass.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const cssRules = [...glass.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
  selectorText: selector.trim(), selectors: selector.trim().split(/\s*,\s*/), declarations,
}));

it("lite mode removes material effects from glass, cards, controls and menus without changing layout", () => {
  const liteRules = cssRules.filter(rule => rule.selectorText.includes('[data-lite="true"]'));
  expect(liteRules.length).toBeGreaterThan(0);
  const surface = liteRules.find(rule => rule.selectors.includes(':root[data-lite="true"] .ig-island.ig-glass[data-resizing="true"]'))!;
  for (const primitive of [".ig-glass", ".ig-glass-card", ".ig-glass-control", ".ig-tab-thumb", ".ig-chip", ".ig-glass-input", ".ig-field"]) {
    expect(surface.selectorText).toContain(primitive);
  }
  for (const property of ["background-image: none;", "backdrop-filter: none;", "-webkit-backdrop-filter: none;"]) {
    expect(surface.declarations).toContain(property);
  }
  expect(surface.declarations).toContain("box-shadow: inset 0 0 0 var(--ig-rim-width) var(--ig-stroke);");
  for (const primitive of [".ig-glass", ".ig-glass-control"]) {
    for (const pseudo of ["before", "after"]) {
      const rule = liteRules.find(rule => rule.selectors.includes(`:root[data-lite="true"] ${primitive}::${pseudo}`))!;
      for (const property of ["content: none;", "display: none;", "background: none;", "mask: none;", "mix-blend-mode: normal;"]) {
        expect(rule.declarations).toContain(property);
      }
    }
  }
  for (const rule of liteRules) {
    expect(rule.declarations).not.toMatch(/(?:^|;)\s*(?:position|isolation|inset|width|height|padding|margin|transform|animation|transition)\s*:/m);
    // Hiding decorative pseudo-elements is the sole display override.
    if (rule.selectorText.includes("::before")) continue;
    expect(rule.declarations).not.toMatch(/(?:^|;)\s*display\s*:/m);
    expect(rule.declarations).not.toMatch(/radial-gradient|url\(|var\(--ig-(?:shadow|shadow-pill|inner-glow|edge-shade)\)/);
  }
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass"))?.declarations).toContain("radial-gradient(");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass--refract"))?.declarations).toContain("url(#ig-refraction)");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass::before"))?.declarations).toContain("exclude");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass::after"))?.declarations).toContain("soft-light");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass"))?.declarations).toContain("var(--ig-shadow)");
});

it("smooths equalizer samples with a short finite transition, none under reduced motion", () => {
  const rules = [...glass.matchAll(/\.ig-eq > i\s*\{([^}]+)\}/g)].map(match => match[1]);
  expect(rules).toHaveLength(2); // normal + prefers-reduced-motion
  expect(rules[0]).toMatch(/transition:\s*transform var\(--ig-eq-smooth\) linear\s*;/);
  expect(rules[1]).toMatch(/transition:\s*none\s*;/);
  for (const rule of rules) expect(rule).not.toMatch(/animation:|will-change:/);
  // The dedicated playing-only promotion keeps the bars stable at fractional DPI (cce6635).
  expect(glass).toMatch(/\.ig-eq\[data-playing="true"\] > i\s*\{\s*will-change:\s*transform;/);
  const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  const painter = readFileSync(new URL("../lib/audio/spectrumPainter.ts", import.meta.url), "utf8");
  const interval = Number(/const FRAME_MS = (\d+)/.exec(painter)?.[1]);
  const smoothing = Number(/--ig-eq-smooth:\s*(\d+)ms/.exec(tokens)?.[1]);
  expect(interval).toBe(50);
  expect(smoothing).toBe(20);
  expect(smoothing).toBeLessThan(interval); // 30 ms without transition between paced samples.
});

it("disables expensive island material only during resizing, keeping the normal glass definitions", () => {
  const surface = cssRules.find(rule => rule.selectors.includes('.ig-island.ig-glass[data-resizing="true"]'))!;
  expect(surface.declarations).toMatch(/background-image:\s*none;/);
  expect(surface.declarations).toMatch(/box-shadow:\s*inset 0 0 0 var\(--ig-rim-width\) var\(--ig-stroke\), var\(--ig-shadow-control\);/);
  expect(surface.declarations).not.toMatch(/var\(--ig-(?:shadow|shadow-pill|inner-glow)\)/);
  for (const pseudo of ["before", "after"]) {
    const rules = cssRules.filter(rule => rule.selectors.includes(`.ig-island[data-resizing="true"]::${pseudo}`));
    expect(rules).toHaveLength(1);
    expect(rules[0].selectors).toEqual(['.ig-island[data-resizing="true"]::before', '.ig-island[data-resizing="true"]::after']);
    for (const property of ["opacity: 0;", "background: none;", "mask: none;", "mix-blend-mode: normal;", "transition: none;"]) {
      expect(rules[0].declarations).toContain(property);
    }
  }
  // Existing full material remains the source of the resting appearance in both themes.
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass"))?.declarations).toContain("var(--ig-shadow)");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass--pill"))?.declarations).toContain("var(--ig-shadow-pill)");
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass::before"))?.declarations).toMatch(/mask:[\s\S]*exclude/);
  expect(cssRules.find(rule => rule.selectors.includes(".ig-glass::after"))?.declarations).toContain("mix-blend-mode: soft-light;");
});

it("restores island pseudo-elements with opacity alone and preserves shadowless native vibrancy", () => {
  const island = cssRules.find(rule => rule.selectors.includes(".ig-island.ig-glass"))!;
  expect(island.declarations).not.toMatch(/box-shadow|will-change|transform/);
  for (const pseudo of ["before", "after"]) {
    const rules = cssRules.filter(rule => rule.selectors.includes(`.ig-island::${pseudo}`));
    expect(rules).toHaveLength(2); // opacity restoration + reduced motion
    expect(rules[0].declarations).toContain("transition: opacity var(--ig-dur-fast) var(--ig-ease-out);");
    expect(rules[1].declarations).toContain("transition: none;");
  }
  for (const vibrancy of ["acrylic", "mica"]) {
    const native = cssRules.find(rule => rule.selectors.includes(`:root[data-vibrancy="${vibrancy}"] .ig-island.ig-glass[data-resizing="true"]`))!;
    expect(native.declarations.trim()).toBe("box-shadow: inset 0 0 0 var(--ig-rim-width) var(--ig-stroke);");
  }
});
