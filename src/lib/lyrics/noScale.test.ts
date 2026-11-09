// The user banned scale on the island (it caused jank): the lyrics code may only move with opacity / translate.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("no scale in the lyrics feature", () => {
  it("lyrics.css has no scale transform", () => {
    expect(stripComments(read("src/design/lyrics.css"))).not.toMatch(/scale/i);
  });

  it("the lyrics blocks added to shell.css and home.css have no scale", () => {
    const shell = read("src/shell/shell.css");
    const home = read("src/modules/home/home.css");
    const block = (css: string, marker: string) => css.slice(css.lastIndexOf("/*", css.indexOf(marker)));
    expect(stripComments(block(shell, "Lyrics view (design-spec"))).not.toMatch(/scale/i);
    expect(stripComments(block(home, "The lyrics button sits"))).not.toMatch(/scale/i);
  });

  it("lyrics components never use scale props", () => {
    for (const file of [
      "src/shell/LyricsView.tsx",
      "src/lib/lyrics/LyricsPill.tsx",
      "src/lib/lyrics/LyricsTint.tsx",
      "src/lib/lyrics/store.ts",
      "src/lib/lyrics/useActiveLine.ts",
    ]) {
      expect(stripComments(read(file)), file).not.toMatch(/scale|whileTap|pressScale/i);
    }
  });

  it("the lyrics button on the player card is a plain button (no tap scale)", () => {
    const card = read("src/modules/home/PlayerCard.tsx");
    const button = card.slice(card.indexOf("ig-lyrics-toggle") - 200, card.indexOf("IconLyrics size"));
    expect(button).not.toMatch(/whileTap|\{\.\.\.tap\}/);
  });
});
