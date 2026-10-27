// Owner: F1. Island shape → Rust (`island_set_shape`): a handful of calls per transition, never one per frame.
//
// Why not per frame: every call is an IPC round trip that Tauri runs on the main thread (the same thread that hosts the
// WebView), and a spring animation produced ~40 calls per expand. The shape is only used by Rust for click-through /
// hover hit-testing, so what matters is that it always COVERS the visible island:
//   1. at the start of a transition → the union of the current box and the target box (inflated by the spring's
//      overshoot), so the island never "falls through" while it grows and never shrinks under the cursor while it
//      collapses;
//   2. when Motion reports the animation complete → the exact final shape.
// Details and measurements: docs/design-spec.md §14.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { islandShape, type BoxSize } from "../design/geometry";
import { invoke } from "../ipc";
import { ISLAND_WINDOW, type IslandShape } from "../shared/types";

const EPSILON = 0.05;

/** Actual (animated, incl. spring overshoot) box of the element → IslandShape via the design helper (rounded outward). */
export function readShape(el: HTMLElement): IslandShape {
  const rect = el.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return islandShape(
    { width: rect.width, height: rect.height, radius: Number.isFinite(radius) ? radius : 0 },
    rect.top,
    ISLAND_WINDOW.width,
  );
}

export function sameShape(a: IslandShape, b: IslandShape, eps = EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps &&
    Math.abs(a.radius - b.radius) < eps
  );
}

/** Smallest shape that contains both (radius = the larger one, so corners are never cut). */
export function unionShape(a: IslandShape, b: IslandShape): IslandShape {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y, radius: Math.max(a.radius, b.radius) };
}

/**
 * Shape that covers a spring transition from `from` to `to` (both centered top-anchored shapes):
 * the union of the two, grown by the spring's overshoot (fraction of the travelled distance) plus 1 px,
 * clamped to the island window.
 */
export function coverShape(
  from: IslandShape,
  to: IslandShape,
  overshootFraction: number,
  windowSize: { width: number; height: number } = ISLAND_WINDOW,
): IslandShape {
  const u = unionShape(from, to);
  const growX = Math.ceil(Math.abs(to.width - from.width) * overshootFraction * 1.05) + 1;
  const growY = Math.ceil(Math.abs(to.height - from.height) * overshootFraction * 1.05) + 1;
  const x = Math.max(0, u.x - Math.ceil(growX / 2));
  const right = Math.min(windowSize.width, u.x + u.width + Math.ceil(growX / 2));
  const bottom = Math.min(windowSize.height, u.y + u.height + growY);
  return { x, y: u.y, width: right - x, height: bottom - u.y, radius: u.radius };
}

/**
 * Reports the island shape to Rust: once on mount, once when `box` changes (a covering shape) and once more via the
 * returned `settle` callback — pass it to Motion's `onAnimationComplete`. Identical consecutive shapes are not re-sent.
 *
 * @param box              target size of the island (CSS px)
 * @param top              island top offset inside the window
 * @param overshootFraction spring overshoot of the transition that starts now (0 for critically damped springs)
 */
export function useShapeSync(
  ref: RefObject<HTMLElement | null>,
  box: BoxSize,
  top: number,
  overshootFraction: number,
): () => void {
  const exact = useMemo(
    () => islandShape({ width: box.width, height: box.height, radius: box.radius }, top, ISLAND_WINDOW.width),
    [box.width, box.height, box.radius, top],
  );
  const exactRef = useRef(exact);
  exactRef.current = exact;
  // Both survive effect re-runs (React StrictMode) so an unchanged shape is never re-sent.
  const lastRef = useRef<IslandShape | null>(null);
  const mountedRef = useRef(false);
  /** Target of the last transition that was started (a re-run of the effect with the same target is a no-op). */
  const startedRef = useRef<IslandShape | null>(null);

  const send = useCallback((shape: IslandShape) => {
    if (lastRef.current && sameShape(lastRef.current, shape)) return;
    lastRef.current = shape;
    invoke("island_set_shape", { shape }).catch(() => {});
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (startedRef.current && sameShape(startedRef.current, exact)) return; // StrictMode re-run, nothing changed
    startedRef.current = exact;
    if (!mountedRef.current || !el) {
      mountedRef.current = true;
      send(exact);
      return;
    }
    const current = readShape(el);
    // Nothing to animate (already there): send the exact shape right away, no "settle" will follow.
    send(sameShape(current, exact, 1.5) ? exact : coverShape(current, exact, overshootFraction));
    // `overshootFraction` is derived from the same transition as `exact`; it must not retrigger on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact, ref, send]);

  useEffect(() => {
    const onResize = () => {
      lastRef.current = null;
      send(exactRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [send]);

  return useCallback(() => send(exactRef.current), [send]);
}
