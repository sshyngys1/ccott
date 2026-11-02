import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_TILES, type TileSlot } from "../../shared/types";
import {
  addTile,
  canExpandTo2x1,
  countCells,
  getHiddenTiles,
  normalizeLayout,
  needsTallPanel,
  removeTile,
  reorderTiles,
  toggleTileSize,
} from "./layout";
import { getTileDefinition, isKnownTileId, TILE_IDS } from "./registry";

describe("tiles registry", () => {
  it("defines the five default tools and five optional shortcuts", () => {
    expect(TILE_IDS).toEqual(["region", "screen", "ocr", "qr", "color", "screenshots", "clipboard", "note", "timer", "command"]);
    for (const id of TILE_IDS) {
      expect(isKnownTileId(id)).toBe(true);
      const def = getTileDefinition(id);
      expect(def).toBeDefined();
      expect(def?.id).toBe(id);
      expect(def?.allowedSizes).toContain("1x1");
      expect(def?.allowedSizes).toContain("2x1");
    }
  });

  it("identifies unknown tile ids", () => {
    expect(isKnownTileId("unknown")).toBe(false);
    expect(isKnownTileId("")).toBe(false);
    expect(getTileDefinition("unknown")).toBeUndefined();
  });

  it("executes actions properly", () => {
    const ocrDef = getTileDefinition("ocr");
    expect(ocrDef).toBeDefined();
    expect(typeof ocrDef?.action).toBe("function");

    const colorDef = getTileDefinition("color");
    expect(colorDef).toBeDefined();
    expect(typeof colorDef?.action).toBe("function");
  });
});

describe("tiles layout pure functions", () => {
  it("counts cells correctly", () => {
    expect(countCells([])).toBe(0);
    expect(
      countCells([
        { id: "region", size: "1x1" },
        { id: "screen", size: "1x1" },
        { id: "color", size: "2x1" },
      ]),
    ).toBe(4);
    expect(countCells(DEFAULT_QUICK_TILES)).toBe(6);
  });

  it("normalizes layout by skipping unknown IDs, deduplicating, and clamping cells", () => {
    // Empty / nullish
    expect(normalizeLayout(null)).toEqual([]);
    expect(normalizeLayout(undefined)).toEqual([]);
    expect(normalizeLayout([])).toEqual([]);

    // Default layout is already valid
    expect(normalizeLayout(DEFAULT_QUICK_TILES)).toEqual(DEFAULT_QUICK_TILES);

    // Skips unknown IDs
    const withUnknown: any[] = [
      { id: "region", size: "1x1" },
      { id: "future_ai", size: "1x1" },
      { id: "ocr", size: "1x1" },
    ];
    expect(normalizeLayout(withUnknown)).toEqual([
      { id: "region", size: "1x1" },
      { id: "ocr", size: "1x1" },
    ]);

    // Skips duplicates
    const withDuplicates: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "region", size: "2x1" },
    ];
    expect(normalizeLayout(withDuplicates)).toEqual([
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
    ]);

    // Truncates / downscales when exceeding 8 cells
    const exceeding: TileSlot[] = [
      { id: "region", size: "2x1" },
      { id: "screen", size: "2x1" },
      { id: "ocr", size: "2x1" },
      { id: "qr", size: "2x1" },
      { id: "note", size: "1x1" }, // eight cells are already used
    ];
    expect(normalizeLayout(exceeding)).toEqual([
      { id: "region", size: "2x1" },
      { id: "screen", size: "2x1" },
      { id: "ocr", size: "2x1" },
      { id: "qr", size: "2x1" },
    ]);

    // Downscales 2x1 to 1x1 if 1 cell is left
    const downscale: TileSlot[] = [
      { id: "region", size: "2x1" }, // 2
      { id: "screen", size: "2x1" }, // 4
      { id: "ocr", size: "2x1" }, // 6
      { id: "qr", size: "1x1" }, // 7
      { id: "color", size: "2x1" }, // downscales to fill cell eight
    ];
    expect(normalizeLayout(downscale)).toEqual([
      { id: "region", size: "2x1" },
      { id: "screen", size: "2x1" },
      { id: "ocr", size: "2x1" },
      { id: "qr", size: "1x1" },
      { id: "color", size: "1x1" },
    ]);
  });

  it("canExpandTo2x1 checks cell availability and current size", () => {
    const slots: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "ocr", size: "1x1" },
      { id: "qr", size: "1x1" },
      { id: "color", size: "2x1" },
      { id: "screenshots", size: "2x1" }, // total = 8
    ];
    // Color is already 2x1
    expect(canExpandTo2x1(slots, "color")).toBe(true);
    // Region cannot expand because eight cells are already used
    expect(canExpandTo2x1(slots, "region")).toBe(false);

    // If we remove one tile, 5 cells used -> region CAN expand to 2x1
    const fiveCells: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "ocr", size: "1x1" },
      { id: "color", size: "2x1" },
    ];
    expect(canExpandTo2x1(fiveCells, "region")).toBe(true);

    // Unknown tile cannot expand
    expect(canExpandTo2x1(fiveCells, "qr")).toBe(false);
  });

  it("getHiddenTiles returns tiles not currently in layout", () => {
    expect(getHiddenTiles(DEFAULT_QUICK_TILES)).toEqual(["screenshots", "clipboard", "note", "timer", "command"]);
    expect(getHiddenTiles([])).toEqual(TILE_IDS);
    expect(
      getHiddenTiles([
        { id: "region", size: "1x1" },
        { id: "screen", size: "1x1" },
      ]),
    ).toEqual(["ocr", "qr", "color", "screenshots", "clipboard", "note", "timer", "command"]);
  });

  it("reorders tiles properly", () => {
    const slots: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "ocr", size: "1x1" },
    ];
    expect(reorderTiles(slots, "region", "ocr")).toEqual([
      { id: "screen", size: "1x1" },
      { id: "ocr", size: "1x1" },
      { id: "region", size: "1x1" },
    ]);
    expect(reorderTiles(slots, "ocr", "region")).toEqual([
      { id: "ocr", size: "1x1" },
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
    ]);
    // Unknown or same id returns identical list
    expect(reorderTiles(slots, "region", "region")).toEqual(slots);
    expect(reorderTiles(slots, "unknown", "region")).toEqual(slots);
  });

  it("removes tiles properly", () => {
    const slots: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
    ];
    expect(removeTile(slots, "region")).toEqual([{ id: "screen", size: "1x1" }]);
    expect(removeTile(slots, "ocr")).toEqual(slots);
  });

  it("toggles tile size between 1x1 and 2x1", () => {
    const slots: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
    ]; // 2 cells used
    // 1x1 -> 2x1
    const toggled = toggleTileSize(slots, "region");
    expect(toggled).toEqual([
      { id: "region", size: "2x1" },
      { id: "screen", size: "1x1" },
    ]);
    // 2x1 -> 1x1
    expect(toggleTileSize(toggled, "region")).toEqual([
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
    ]);

    // Cannot expand if at capacity (8 cells)
    const full: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "ocr", size: "1x1" },
      { id: "qr", size: "1x1" },
      { id: "color", size: "2x1" },
      { id: "note", size: "2x1" },
    ];
    expect(toggleTileSize(full, "region")).toEqual(full);
  });

  it("adds tiles respecting limits and preferred sizes", () => {
    const empty: TileSlot[] = [];
    const withOne = addTile(empty, "region");
    expect(withOne).toEqual([{ id: "region", size: "1x1" }]);

    const withTwoPref2x1 = addTile(withOne, "screen", "2x1");
    expect(withTwoPref2x1).toEqual([
      { id: "region", size: "1x1" },
      { id: "screen", size: "2x1" },
    ]);

    // Cannot re-add duplicate
    expect(addTile(withTwoPref2x1, "region")).toEqual(withTwoPref2x1);

    // If seven cells used, preferred 2x1 falls back to 1x1
    const fiveCells: TileSlot[] = [
      { id: "region", size: "2x1" },
      { id: "screen", size: "2x1" },
      { id: "timer", size: "2x1" },
      { id: "ocr", size: "1x1" },
    ];
    const withQr = addTile(fiveCells, "qr", "2x1");
    expect(withQr).toEqual([
      { id: "region", size: "2x1" },
      { id: "screen", size: "2x1" },
      { id: "timer", size: "2x1" },
      { id: "ocr", size: "1x1" },
      { id: "qr", size: "1x1" },
    ]);

    // If eight cells used, cannot add any more
    expect(addTile(withQr, "color")).toEqual(withQr);
  });

  it("uses four rows for seven/eight known cells and returns to three at six", () => {
    const seven = addTile(DEFAULT_QUICK_TILES, "note");
    expect(countCells(seven)).toBe(7);
    expect(needsTallPanel(seven)).toBe(true);
    expect(canExpandTo2x1(seven, "note")).toBe(true);
    const eight = toggleTileSize(seven, "note");
    expect(countCells(eight)).toBe(8);
    expect(needsTallPanel(eight)).toBe(true);
    expect(canExpandTo2x1(eight, "region")).toBe(false);
    expect(addTile(eight, "timer")).toEqual(eight);
    expect(needsTallPanel(removeTile(eight, "note"))).toBe(false);
    expect(needsTallPanel([...DEFAULT_QUICK_TILES, { id: "future" as never, size: "2x1" }])).toBe(false);
  });
});
