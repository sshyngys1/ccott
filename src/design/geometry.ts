// Owner: Designer. Reads geometry tokens from CSS so JS (Motion targets, IslandShape) never hard-codes sizes.
import type { IslandShape } from "../shared/types";

/** "224px" → 224, "  36px " → 36, "" / "auto" / "2rem" → fallback. */
export function parsePx(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const m = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value);
  return m ? Number(m[1]) : fallback;
}

/** Reads a px token (e.g. "--ig-pill-width") from an element (default <html>). */
export function readPxToken(name: `--ig-${string}`, el: Element = document.documentElement, fallback = 0): number {
  return parsePx(getComputedStyle(el).getPropertyValue(name), fallback);
}

export interface BoxSize {
  width: number;
  height: number;
  radius: number;
}

export interface IslandGeometry {
  top: number;
  pill: BoxSize;
  pillActivity: BoxSize;
  pillToast: BoxSize;
  pillHoverGrow: number;
  panel: BoxSize;
}

/** Fallbacks equal the shipped token values (used in tests / before CSS loads). */
export const DEFAULT_GEOMETRY: IslandGeometry = {
  top: 8,
  pill: { width: 224, height: 36, radius: 18 },
  pillActivity: { width: 304, height: 36, radius: 18 },
  pillToast: { width: 312, height: 36, radius: 18 },
  pillHoverGrow: 12,
  panel: { width: 720, height: 396, radius: 32 },
};

export function readIslandGeometry(el: Element = document.documentElement): IslandGeometry {
  const d = DEFAULT_GEOMETRY;
  const px = (name: `--ig-${string}`, fb: number) => readPxToken(name, el, fb);
  const pillH = px("--ig-pill-height", d.pill.height);
  const pillR = px("--ig-radius-pill", d.pill.radius);
  return {
    top: px("--ig-pill-top", d.top),
    pill: { width: px("--ig-pill-width", d.pill.width), height: pillH, radius: pillR },
    pillActivity: { width: px("--ig-pill-width-activity", d.pillActivity.width), height: pillH, radius: pillR },
    pillToast: { width: px("--ig-pill-width-toast", d.pillToast.width), height: pillH, radius: pillR },
    pillHoverGrow: px("--ig-pill-hover-grow", d.pillHoverGrow),
    panel: {
      width: px("--ig-panel-width", d.panel.width),
      height: px("--ig-panel-height", d.panel.height),
      radius: px("--ig-radius-panel", d.panel.radius),
    },
  };
}

/** Hover size of a pill: wider by `grow`, taller by grow/6 (keeps the capsule ratio), radius = height/2. */
export function hoveredPill(size: BoxSize, grow: number): BoxSize {
  const height = size.height + grow / 6;
  return { width: size.width + grow, height, radius: height / 2 };
}

/**
 * IslandShape for a box anchored top-center inside the window (what F1 sends with `island_set_shape`).
 * Values are rounded outward to whole CSS px so the hit-test/region never cuts the anti-aliased edge.
 */
export function islandShape(size: BoxSize, top: number, windowWidth: number): IslandShape {
  const x = Math.floor((windowWidth - size.width) / 2);
  const right = Math.ceil((windowWidth + size.width) / 2);
  return {
    x,
    y: Math.floor(top),
    width: right - x,
    height: Math.ceil(top + size.height) - Math.floor(top),
    radius: Math.round(size.radius),
  };
}
