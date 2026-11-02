import { QUICK_TILE_CELLS, QUICK_TILE_ROW_CELLS_3, type TileId, type TileSize, type TileSlot } from "../../shared/types";
import { getTileDefinition, isKnownTileId, TILE_IDS } from "./registry";

/**
 * Calculates the total number of cells occupied by slots.
 * "1x1" occupies 1 cell, "2x1" occupies 2 cells.
 */
export function countCells(slots: readonly TileSlot[]): number {
  return slots.reduce((sum, slot) => sum + (slot.size === "2x1" ? 2 : 1), 0);
}

/** Unknown IDs and invalid/oversized layouts use the same normalization as Home. */
export function needsTallPanel(slots: readonly TileSlot[]): boolean {
  return countCells(normalizeLayout(slots)) > QUICK_TILE_ROW_CELLS_3;
}

/**
 * Normalizes a list of tile slots:
 * - skips unknown tile IDs
 * - skips duplicate tile IDs
 * - validates size against tile definition (falls back to 1x1)
 * - truncates/clamps to QUICK_TILE_CELLS (8 cells max)
 */
export function normalizeLayout(rawSlots: readonly TileSlot[] | null | undefined): TileSlot[] {
  if (!rawSlots || !Array.isArray(rawSlots)) {
    return [];
  }
  const result: TileSlot[] = [];
  const seen = new Set<string>();
  let totalCells = 0;

  for (const slot of rawSlots) {
    if (!slot || typeof slot.id !== "string" || !isKnownTileId(slot.id)) {
      continue;
    }
    if (seen.has(slot.id)) {
      continue;
    }
    const def = getTileDefinition(slot.id);
    if (!def) {
      continue;
    }

    let size: TileSize = slot.size === "2x1" ? "2x1" : "1x1";
    if (!def.allowedSizes.includes(size)) {
      size = def.allowedSizes[0] ?? "1x1";
    }

    const cellCost = size === "2x1" ? 2 : 1;
    if (totalCells + cellCost <= QUICK_TILE_CELLS) {
      seen.add(slot.id);
      totalCells += cellCost;
      result.push({ id: slot.id, size });
    } else if (size === "2x1" && def.allowedSizes.includes("1x1") && totalCells + 1 <= QUICK_TILE_CELLS) {
      seen.add(slot.id);
      totalCells += 1;
      result.push({ id: slot.id, size: "1x1" });
    }
  }

  return result;
}

/**
 * Checks whether a tile in the layout can be expanded to 2x1.
 * Returns true if it is already 2x1, or if changing it to 2x1 fits within the cell budget.
 */
export function canExpandTo2x1(slots: readonly TileSlot[], id: TileId): boolean {
  const current = slots.find((s) => s.id === id);
  if (!current) {
    return false;
  }
  const def = getTileDefinition(id);
  if (!def || !def.allowedSizes.includes("2x1")) {
    return false;
  }
  if (current.size === "2x1") {
    return true;
  }
  return countCells(slots) + 1 <= QUICK_TILE_CELLS;
}

/**
 * Returns a list of available tile IDs that are currently not in the layout.
 */
export function getHiddenTiles(slots: readonly TileSlot[]): TileId[] {
  const present = new Set(slots.map((s) => s.id));
  return TILE_IDS.filter((id) => !present.has(id));
}

/**
 * Reorders tile slots by moving activeId to targetId's position.
 */
export function reorderTiles(
  slots: readonly TileSlot[],
  activeId: TileId | string,
  targetId: TileId | string,
): TileSlot[] {
  if (activeId === targetId) {
    return [...slots];
  }
  const fromIndex = slots.findIndex((s) => s.id === activeId);
  const toIndex = slots.findIndex((s) => s.id === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return [...slots];
  }
  const next = [...slots];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

/**
 * Removes a tile by ID.
 */
export function removeTile(slots: readonly TileSlot[], id: TileId | string): TileSlot[] {
  return slots.filter((s) => s.id !== id);
}

/**
 * Toggles a tile between 1x1 and 2x1, respecting the cell budget.
 */
export function toggleTileSize(slots: readonly TileSlot[], id: TileId): TileSlot[] {
  return slots.map((s) => {
    if (s.id !== id) {
      return s;
    }
    if (s.size === "2x1") {
      return { id: s.id, size: "1x1" };
    }
    if (canExpandTo2x1(slots, id)) {
      return { id: s.id, size: "2x1" };
    }
    return s;
  });
}

/**
 * Adds a tile to the layout if there is room for at least 1 cell.
 */
export function addTile(
  slots: readonly TileSlot[],
  id: TileId,
  preferredSize: TileSize = "1x1",
): TileSlot[] {
  if (slots.some((s) => s.id === id)) {
    return [...slots];
  }
  const def = getTileDefinition(id);
  if (!def) {
    return [...slots];
  }
  const remaining = QUICK_TILE_CELLS - countCells(slots);
  if (remaining <= 0) {
    return [...slots];
  }
  if (preferredSize === "2x1" && remaining >= 2 && def.allowedSizes.includes("2x1")) {
    return [...slots, { id, size: "2x1" }];
  }
  if (def.allowedSizes.includes("1x1") && remaining >= 1) {
    return [...slots, { id, size: "1x1" }];
  }
  return [...slots];
}
