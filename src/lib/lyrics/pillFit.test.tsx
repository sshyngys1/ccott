// All lyric text in tests is invented. jsdom has no layout: widths are injected through the DOM getters.
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIslandStore, useIslandStore } from "../../store";
import { EMPTY_MEDIA } from "../media/progress";
import { resetMediaStore, useMediaStore } from "../media/store";
import { LyricsPill } from "./LyricsPill";
import { PILL_SHRINK_HOLD_MS, fitPillWidth, marqueeDuration, marqueeOverflow, useHeldWidth, usePillFitStore } from "./pillFit";
import { resetLyricsStore, useLyricsStore } from "./store";

describe("pure width math", () => {
  it("rounds text + chrome up to 24 px steps and clamps to [384, 720]", () => {
    expect(fitPillWidth(100, 80, 384, 720)).toBe(384);
    expect(fitPillWidth(300, 80, 384, 720)).toBe(384); // 380 -> min
    expect(fitPillWidth(301, 80, 384, 720)).toBe(384); // 381 -> 384
    expect(fitPillWidth(305, 80, 384, 720)).toBe(408); // 385 -> 408
    expect(fitPillWidth(500, 80, 384, 720)).toBe(600); // 580 -> 600
    expect(fitPillWidth(800, 80, 384, 720)).toBe(720);
    // Small differences between lines land on the same step.
    expect(fitPillWidth(410, 80, 384, 720)).toBe(fitPillWidth(415, 80, 384, 720));
  });

  it("knows how far a line sticks out of the widest pill", () => {
    expect(marqueeOverflow(600, 80, 720)).toBe(0);
    expect(marqueeOverflow(640, 80, 720)).toBe(0);
    expect(marqueeOverflow(900, 80, 720)).toBe(260);
    expect(marqueeDuration(10)).toBe(4);
    expect(marqueeDuration(380)).toBeGreaterThan(4);
  });
});

describe("useHeldWidth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("grows at once and shrinks only after the lower target held for 1.5 s", () => {
    const { result, rerender } = renderHook(({ target }) => useHeldWidth(target), { initialProps: { target: 384 } });
    rerender({ target: 600 });
    expect(result.current).toBe(600);
    rerender({ target: 408 });
    act(() => void vi.advanceTimersByTime(PILL_SHRINK_HOLD_MS - 1));
    expect(result.current).toBe(600);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(408);
  });

  it("a wider line during the wait cancels the shrink; alternating lines never make it jitter", () => {
    const { result, rerender } = renderHook(({ target }) => useHeldWidth(target), { initialProps: { target: 600 } });
    for (let i = 0; i < 6; i++) {
      rerender({ target: 408 });
      act(() => void vi.advanceTimersByTime(1000));
      rerender({ target: 600 });
      act(() => void vi.advanceTimersByTime(1000));
    }
    expect(result.current).toBe(600);
  });
});

describe("LyricsPill adapts the pill width", () => {
  let textWidth = 0;
  const CHROME = 90;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetIslandStore();
    resetMediaStore();
    resetLyricsStore();
    usePillFitStore.getState().set(null);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains("ig-pill-lyric__twin") ? textWidth : 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ig-pill-row") ? 400 : this.classList.contains("ig-pill-lyric") ? 400 - CHROME : 0;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePillFitStore.getState().set(null);
    resetLyricsStore();
    resetMediaStore();
    resetIslandStore();
    vi.useRealTimers();
  });

  function play(lines: { timeMs: number; text: string }[], positionMs = 0) {
    act(() => {
      useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, title: "Invented Title", artist: "Invented Artist", status: "playing", positionMs, positionSampledAt: Date.now(), durationMs: 100_000 }, true);
      useLyricsStore.setState({ key: "k", status: "synced", lines, text: "", source: "lrclib" });
    });
  }
  const textEl = () => [...document.querySelectorAll<HTMLElement>(".ig-pill-lyric__text")].find((e) => e.dataset.kind === "line" && !e.classList.contains("ig-pill-lyric__twin"))!;

  it("asks for text + measured chrome rounded to the step, and publishes it for the shell", () => {
    textWidth = 500;
    play([{ timeMs: 0, text: "invented line" }]);
    render(<LyricsPill />);
    expect(usePillFitStore.getState().width).toBe(600); // 500 + 90 = 590 -> 600
    expect(textEl().dataset.marquee).toBeUndefined();
  });

  it("a short line keeps the base width 384", () => {
    textWidth = 120;
    play([{ timeMs: 0, text: "short" }]);
    render(<LyricsPill />);
    expect(usePillFitStore.getState().width).toBe(384);
  });

  it("a line wider than the widest pill scrolls with translateX (no ellipsis) and the pill stops at 720", () => {
    textWidth = 900;
    play([{ timeMs: 0, text: "invented very long line" }]);
    render(<LyricsPill />);
    expect(usePillFitStore.getState().width).toBe(720);
    const el = textEl();
    expect(el.dataset.marquee).toBe("true");
    expect(el.style.getPropertyValue("--ly-shift")).toBe(`-${900 - (720 - CHROME)}px`);
    expect(el.dataset.truncate).toBeUndefined();
  });

  it("in «Лёгкий» the long line is truncated without animation", () => {
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, liteMode: true } })));
    textWidth = 900;
    play([{ timeMs: 0, text: "invented very long line" }]);
    render(<LyricsPill />);
    const el = textEl();
    expect(el.dataset.marquee).toBeUndefined();
    expect(el.dataset.truncate).toBe("true");
    expect(usePillFitStore.getState().width).toBe(720);
  });

  it("shrinks 1.5 s after a shorter line, and resets when the pill goes away", () => {
    textWidth = 600;
    play([{ timeMs: 0, text: "invented long line" }, { timeMs: 5000, text: "invented short line" }]);
    const view = render(<LyricsPill />);
    expect(usePillFitStore.getState().width).toBe(696); // 600 + 90 -> 696
    textWidth = 100;
    act(() => void vi.advanceTimersByTime(4900));
    expect(usePillFitStore.getState().width).toBe(696);
    act(() => void vi.advanceTimersByTime(PILL_SHRINK_HOLD_MS + 50));
    expect(usePillFitStore.getState().width).toBe(384);
    view.unmount();
    expect(usePillFitStore.getState().width).toBeNull();
  });
});
