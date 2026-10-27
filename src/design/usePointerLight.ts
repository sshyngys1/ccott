// Owner: Designer. Cursor-following light for `.ig-glass` / `.ig-glass--pill`.
//
// Writes CSS custom properties straight onto the element — no React state, no re-renders:
//   --ig-pointer-x, --ig-pointer-y  cursor position in px relative to the element's top-left corner
//   --ig-pointer-active             1 while the pointer is over the element, 0 after it leaves (CSS fades it)
// Pointer moves are coalesced to at most one style write per animation frame.
import { useEffect, type RefObject } from "react";

export interface PointerLightOptions {
  /** Skip all listeners (e.g. reduced-transparency setting). Default false. */
  disabled?: boolean;
}

export interface LocalPoint {
  x: number;
  y: number;
}

/** Converts viewport coordinates to element-local coordinates (rounded to 0.1px to avoid style churn). */
export function toLocalPoint(clientX: number, clientY: number, rect: { left: number; top: number }): LocalPoint {
  return {
    x: Math.round((clientX - rect.left) * 10) / 10,
    y: Math.round((clientY - rect.top) * 10) / 10,
  };
}

export const POINTER_VARS = {
  x: "--ig-pointer-x",
  y: "--ig-pointer-y",
  active: "--ig-pointer-active",
} as const;

export function usePointerLight<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: PointerLightOptions = {},
): void {
  const { disabled = false } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    let frame = 0;
    let clientX = 0;
    let clientY = 0;

    const flush = () => {
      frame = 0;
      // Read the rect once per frame: the island resizes while it animates, so it can't be cached.
      const p = toLocalPoint(clientX, clientY, el.getBoundingClientRect());
      el.style.setProperty(POINTER_VARS.x, `${p.x}px`);
      el.style.setProperty(POINTER_VARS.y, `${p.y}px`);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      clientX = e.clientX;
      clientY = e.clientY;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      onMove(e);
      el.style.setProperty(POINTER_VARS.active, "1");
    };
    const onLeave = () => {
      el.style.setProperty(POINTER_VARS.active, "0");
    };

    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerenter", onEnter, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.style.removeProperty(POINTER_VARS.x);
      el.style.removeProperty(POINTER_VARS.y);
      el.style.removeProperty(POINTER_VARS.active);
    };
  }, [ref, disabled]);
}
