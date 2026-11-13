// Owner: F2. The lyrics pill adapts its width to the current line (between `pillLyrics` and the panel width).
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/** Widths snap up to this step, so small differences between lines do not move the pill. */
export const PILL_STEP_PX = 24;
/** A narrower target must hold this long before the pill shrinks (it grows at once). */
export const PILL_SHRINK_HOLD_MS = 1500;
/** Used when the chrome (cover, equalizer, paddings) cannot be measured. */
export const PILL_CHROME_FALLBACK_PX = 80;
/** Scroll speed of a line that does not fit even in the widest pill. */
export const MARQUEE_PX_PER_S = 38;

/** Pill width for a line: text + chrome, rounded up to the step, clamped to `[min, max]`. */
export function fitPillWidth(textWidth: number, chrome: number, min: number, max: number, step = PILL_STEP_PX): number {
  const needed = Math.ceil(textWidth + chrome);
  return Math.min(max, Math.max(min, Math.ceil(needed / step) * step));
}

/** How far (px) a line sticks out of the widest pill; 0 = it fits. */
export function marqueeOverflow(textWidth: number, chrome: number, max: number): number {
  return Math.max(0, Math.ceil(textWidth - (max - chrome)));
}

/** Seconds of one marquee run: 20 % hold, a slow move, 15 % hold (matches the keyframes in shell.css). */
export function marqueeDuration(overflow: number): number {
  return Math.max(4, overflow / MARQUEE_PX_PER_S / 0.65);
}

/** Follows `target`: up at once, down only after the lower target has held for `holdMs`. */
export function useHeldWidth(target: number, holdMs = PILL_SHRINK_HOLD_MS): number {
  const [shown, setShown] = useState(target);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (target > shown) setShown(target);
    else if (target < shown) timer.current = setTimeout(() => setShown(target), holdMs);
    return () => clearTimeout(timer.current);
  }, [target, shown, holdMs]);
  return shown;
}

/** The width the lyrics pill asks for (null = not shown; the shell uses `pillLyrics.width`). */
export const usePillFitStore = create<{ width: number | null; set: (width: number | null) => void }>()((set) => ({
  width: null,
  set: (width) => set({ width }),
}));
