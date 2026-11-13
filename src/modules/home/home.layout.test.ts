// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = read("../../design/tokens.css");
const home = read("./home.css");
const shell = read("../../shell/shell.css");
const glass = read("../../design/glass.css");
const wide = ".hm-home:not(.hm-home--with-tools)";

function declaration(css: string, selector: string, property: string) {
  const block = (`\n${css}`).split(`\n${selector} {`)[1]?.split("}")[0];
  const value = block?.split(";").map(part => part.trim()).find(part => part.startsWith(`${property}:`));
  if (!value) throw new Error(`Missing ${selector} { ${property} }`);
  return value.slice(property.length + 1).trim();
}

function token(name: string): string {
  const value = tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing token ${name}`);
  return value;
}

// Only lengths and sums used by this layout; reject unsupported expressions instead of guessing.
function px(value: string): number {
  const resolved = value.replace(/var\((--ig-[\w-]+)\)/g, (_, name: string) => token(name))
    .replace(/calc\(([^()]+)\)/g, "$1").replace(/px/g, "").replace(/\s/g, "");
  if (!/^[\d.]+(?:[+-][\d.]+)*$/.test(resolved)) throw new Error(`Unsupported length ${value}`);
  return [...resolved.matchAll(/[+-]?[\d.]+/g)].reduce((sum, match) => sum + Number(match[0]), 0);
}

const size = (name: string) => px(token(name));
const length = (css: string, selector: string, property: string) => px(declaration(css, selector, property));

it("fits wide artwork, metadata, centered transport and a full-width timeline in the ordinary panel", () => {
  const panelPadding = length(shell, ".ig-panel", "padding");
  const bodyHeight = size("--ig-panel-height") - panelPadding * 2
    - length(shell, ".ig-panel-head", "height") - length(shell, ".ig-panel", "gap");
  const dockHeight = px(declaration(home, ".hm-home", "grid-template-rows").replace("minmax(0, 1fr) ", ""));
  const playerHeight = bodyHeight - dockHeight - length(home, ".hm-home", "gap")
    - length(home, ".hm-volume", "height") - length(home, ".hm-left", "gap");
  const padding = length(home, `${wide} .hm-player`, "padding");
  const [rowGap, columnGap] = declaration(home, `${wide} .hm-player`, "gap").split(" ").map(px);
  const rows = declaration(home, `${wide} .hm-player`, "grid-template-rows")
    .replace("minmax(0, 1fr) ", "").match(/^(\S+) (.+)$/)!;
  const controlsHeight = px(rows[1]);
  const seekHeight = px(rows[2]);
  const metadataHeight = playerHeight - padding * 2 - controlsHeight - seekHeight - rowGap * 2;
  const art = length(home, `${wide} .hm-player`, "--ig-art-size");
  const compactArt = length(home, ".hm-home:has(.hm-tools) .hm-player", "--ig-art-size");

  expect(size("--ig-panel-height")).toBe(396);
  expect(playerHeight).toBe(172);
  expect(art).toBe(120);
  expect(art / compactArt).toBeGreaterThanOrEqual(1.5);
  expect(art).toBeLessThanOrEqual(metadataHeight + rowGap + controlsHeight);
  expect(length(glass, ".ig-glass-control--lg", "height")).toBeLessThanOrEqual(controlsHeight);
  expect(length(glass, ".ig-glass-slider", "height")).toBeLessThanOrEqual(seekHeight);

  // Each text line is truncated, so its length cannot increase the card's height.
  const textHeight = (size("--ig-text-xs") + size("--ig-text-md"))
    * length(home, `${wide} .hm-meta`, "line-height")
    + size("--ig-text-xl") * size("--ig-leading-tight")
    + length(home, ".hm-track", "margin-top") + length(home, `${wide} .hm-meta`, "gap") * 2;
  expect(textHeight).toBeLessThanOrEqual(metadataHeight);

  const cardWidth = size("--ig-panel-width") - panelPadding * 2;
  const transportWidth = size("--ig-control-height") * 2 + size("--ig-control-height-lg")
    + length(home, ".hm-controls", "gap") * 2;
  const transportLeft = (cardWidth - transportWidth) / 2;
  expect(transportLeft).toBeGreaterThan(padding + art + columnGap);
  expect(cardWidth - padding * 2).toBe(664);
});
