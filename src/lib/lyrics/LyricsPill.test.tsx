// All lyric text in tests is invented.
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIslandStore, useIslandStore } from "../../store";
import { EMPTY_MEDIA } from "../media/progress";
import { resetMediaStore, useMediaStore } from "../media/store";
import { LyricsPill } from "./LyricsPill";
import { resetLyricsStore, useLyricsStore } from "./store";
import { useActiveLineIndex } from "./useActiveLine";

const LINES = [
  { timeMs: 0, text: "line zero" },
  { timeMs: 2000, text: "line one" },
  { timeMs: 3000, text: "line two" },
  { timeMs: 9000, text: "" },
  { timeMs: 12_000, text: "line four" },
];

function start(status: "playing" | "paused" = "playing", positionMs = 0) {
  act(() => {
    useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, title: "Invented Title", artist: "Invented Artist", status, positionMs, positionSampledAt: Date.now(), durationMs: 100_000, canSeek: true }, true);
    useLyricsStore.setState({ key: "k", status: "synced", lines: LINES, text: "", source: "lrclib" });
  });
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const shown = () => [...document.querySelectorAll(".ig-pill-lyric__text:not(.ig-pill-lyric__twin)")].map((el) => el.textContent);
const live = () => screen.getByTestId("lyrics-announce").textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  resetIslandStore();
  resetMediaStore();
  resetLyricsStore();
});
afterEach(() => {
  cleanup();
  resetLyricsStore();
  resetMediaStore();
  resetIslandStore();
  vi.useRealTimers();
});

describe("useActiveLineIndex", () => {
  it("follows the extrapolated position with one timer aimed at the next line (150 ms early)", async () => {
    start("playing", 0);
    const { result } = renderHook(() => useActiveLineIndex(LINES));
    expect(result.current).toBe(0);
    await advance(1849);
    expect(result.current).toBe(0);
    await advance(2); // 2000 − 150 ms lead
    expect(result.current).toBe(1);
    await advance(1000);
    expect(result.current).toBe(2);
  });

  it("applies the user's offset and re-aims after a seek", async () => {
    start("playing", 0);
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, lyrics: { ...s.settings.lyrics, offsetMs: 2000 } } })));
    const { result } = renderHook(() => useActiveLineIndex(LINES));
    expect(result.current).toBe(1); // +2 s: line one is already due
    act(() => useMediaStore.getState().applyState({ ...useMediaStore.getState().media, positionMs: 20_000, positionSampledAt: Date.now() }, true));
    expect(result.current).toBe(4);
  });

  it("holds still while paused (no timer) and when disabled", async () => {
    start("paused", 2500);
    const { result, rerender } = renderHook(({ enabled }) => useActiveLineIndex(LINES, enabled), { initialProps: { enabled: true } });
    expect(result.current).toBe(1);
    const timers = vi.getTimerCount();
    await advance(10_000);
    expect(result.current).toBe(1);
    expect(vi.getTimerCount()).toBe(timers);
    rerender({ enabled: false });
    expect(result.current).toBe(-1);
  });
});

describe("LyricsPill", () => {
  it("shows the current line; track · artist before the first line, in an interlude and while paused", async () => {
    start("playing", 9500); // inside the empty interlude line
    render(<LyricsPill />);
    expect(shown()).toEqual(["Invented Title · Invented Artist"]);
    await advance(2800); // 12.3 s → "line four"
    expect(shown()).toContain("line four");
    act(() => useMediaStore.getState().applyState({ ...useMediaStore.getState().media, status: "paused" }, true));
    expect(shown()).toContain("Invented Title · Invented Artist");
  });

  it("the line is hidden from assistive tech; the button keeps the media pill's name", () => {
    start();
    render(<LyricsPill />);
    expect(document.querySelector(".ig-pill-lyric")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: /Invented Title/ })).toBeInTheDocument();
  });

  it("announces nothing by default", async () => {
    start();
    render(<LyricsPill />);
    await advance(10_000);
    expect(live()).toBe("");
  });

  it("announces politely: a line must hold 1.2 s and announcements are 4 s apart", async () => {
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, lyrics: { ...s.settings.lyrics, announce: true } } })));
    start("playing", 0);
    render(<LyricsPill />);
    expect(screen.getByTestId("lyrics-announce")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("lyrics-announce")).toHaveAttribute("aria-atomic", "true");
    await advance(1100);
    expect(live()).toBe("");
    await advance(200); // t = 1.3 s: "line zero" held 1.2 s
    expect(live()).toBe("line zero");
    await advance(2700); // t = 4.0 s: "line one" (1.85 s) was replaced by "line two" (2.85 s) before it could be announced
    expect(live()).toBe("line zero");
    await advance(1500); // t = 5.5 s: ≥ 4 s after the last announcement and "line two" has held
    expect(live()).toBe("line two");
  });

  it("does not announce while the panel is open", async () => {
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, lyrics: { ...s.settings.lyrics, announce: true } }, mode: "expanded" })));
    start("playing", 0);
    render(<LyricsPill />);
    await advance(8000);
    expect(live()).toBe("");
  });
});
