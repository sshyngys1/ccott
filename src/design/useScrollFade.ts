// Owner: Designer. Drives .ig-scroll-fade (glass.css): fades only the edges that have more content behind them.
// Writes data-at-start / data-at-end straight to the element (no React re-render), rAF-coalesced. Spec §6.4.
import { useEffect, type RefObject } from "react";

/** Tolerance in px — sub-pixel scroll positions at 125/150 % DPI never quite reach the end. */
export const SCROLL_EDGE_EPSILON = 2;

export interface ScrollEdges {
  atStart: boolean;
  atEnd: boolean;
}

/** Pure: which edges of a scroll box are reached. A box without overflow is at both edges (no fade). */
export function scrollEdges(scrollTop: number, scrollHeight: number, clientHeight: number, epsilon = SCROLL_EDGE_EPSILON): ScrollEdges {
  const max = Math.max(0, scrollHeight - clientHeight);
  return {
    atStart: scrollTop <= epsilon,
    atEnd: scrollTop >= max - epsilon,
  };
}

export function useScrollFade(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const { atStart, atEnd } = scrollEdges(el.scrollTop, el.scrollHeight, el.clientHeight);
      el.dataset.atStart = String(atStart);
      el.dataset.atEnd = String(atEnd);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener("scroll", schedule, { passive: true });
    // Content changes (new clip, search filter) change scrollHeight without a scroll event.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
