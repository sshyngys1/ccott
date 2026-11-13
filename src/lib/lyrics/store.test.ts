// All lyric text in tests is invented. No real network: `lyrics_get` is a spy.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LYRICS_FALLBACK } from "../../design/lyrics";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import type { LyricsResult, MediaState } from "../../shared/types";
import { resetIslandStore, useIslandStore } from "../../store";
import { EMPTY_MEDIA } from "../media/progress";
import { resetMediaStore, useMediaStore } from "../media/store";
import { LYRICS_DEBOUNCE_MS, resetLyricsStore, useCurrentLyrics, useLyricsController, useLyricsStore } from "./store";

const PALETTE = { a: "#112233", b: "#223344", c: "#334455" };
vi.mock("../../design/lyrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../design/lyrics")>()),
  paletteFromImage: vi.fn(() => PALETTE),
}));

const track = (title: string, extra: Partial<MediaState> = {}): MediaState => ({
  ...EMPTY_MEDIA,
  hasSession: true,
  title,
  artist: "Invented Artist",
  album: "Invented Album",
  durationMs: 200_000,
  status: "playing",
  canSeek: true,
  ...extra,
});
const play = (m: MediaState) => act(() => useMediaStore.getState().applyState(m, true));

const SYNCED: LyricsResult = { status: "synced", source: "lrclib", lines: [{ timeMs: 9000, text: "second" }, { timeMs: 1000, text: "first" }, { timeMs: 30_000, text: "third" }] };
let answers: Record<string, LyricsResult>;
let calls: { title: string }[];
let hold: ((r: LyricsResult) => void)[];

beforeEach(() => {
  vi.useFakeTimers();
  resetMock();
  resetIslandStore();
  resetMediaStore();
  resetLyricsStore();
  answers = {};
  calls = [];
  hold = [];
  vi.spyOn(ipc, "invoke").mockImplementation((async (cmd: string, args: { title: string }) => {
    if (cmd !== "lyrics_get") return undefined;
    calls.push({ title: args.title });
    if (answers[args.title]) return answers[args.title];
    return new Promise<LyricsResult>((resolve) => hold.push(resolve));
  }) as never);
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  resetLyricsStore();
  resetMediaStore();
  resetIslandStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mount = () => renderHook(() => useLyricsController());
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("lyrics controller", () => {
  it("debounces a track change by 300 ms and asks once, for the last track only", async () => {
    answers = { B: SYNCED };
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS - 1); });
    expect(calls).toEqual([]);
    expect(useLyricsStore.getState().status).toBe("loading");
    play(track("B"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS - 1); });
    expect(calls).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(calls).toEqual([{ title: "B" }]);
    expect(useLyricsStore.getState().status).toBe("synced");
  });

  it("sorts the lines, adds the interlude and caches the answer for the track", async () => {
    answers = { A: SYNCED, B: { status: "notFound" } };
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    const s = useLyricsStore.getState();
    expect(s.lines.map((l) => [l.timeMs, l.text])).toEqual([[1000, "first"], [5000, ""], [9000, "second"], [13_000, ""], [30_000, "third"]]);
    expect(s.source).toBe("lrclib");
    play(track("B"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(useLyricsStore.getState().status).toBe("notFound");
    play(track("A")); // back to the first track: instant, no new request
    expect(useLyricsStore.getState().status).toBe("synced");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(calls.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("never shows the previous track's lyrics for the new track", async () => {
    answers = { A: SYNCED };
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    const view = renderHook(() => useCurrentLyrics());
    expect(view.result.current.status).toBe("synced");
    play(track("B"));
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.lines).toEqual([]);
  });

  it("drops a late answer for a track that is no longer current", async () => {
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    play(track("B"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(hold).toHaveLength(2);
    act(() => hold[0](SYNCED)); // A answers after B started
    await settle();
    expect(useLyricsStore.getState().status).toBe("loading");
    act(() => hold[1]({ status: "plain", text: "line one\nline two", source: "cache" }));
    await settle();
    expect(useLyricsStore.getState()).toMatchObject({ status: "plain", text: "line one\nline two", source: "cache" });
  });

  it("an error is a state, never an exception; retry asks again", async () => {
    answers = { A: { status: "error", message: "offline" } };
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(useLyricsStore.getState().status).toBe("error");
    answers = { A: SYNCED };
    act(() => useLyricsStore.getState().retry());
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(calls).toHaveLength(2);
    expect(useLyricsStore.getState().status).toBe("synced");
  });

  it("a rejected invoke is also turned into the error state", async () => {
    vi.mocked(ipc.invoke).mockImplementation((() => Promise.reject(new Error("boom"))) as never);
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(useLyricsStore.getState().status).toBe("error");
  });

  it("with search switched off nothing is requested; switching it on fetches the current track", async () => {
    answers = { A: SYNCED };
    useIslandStore.setState((s) => ({ settings: { ...s.settings, lyrics: { ...s.settings.lyrics, enabled: false } } }));
    mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(calls).toEqual([]);
    expect(useLyricsStore.getState().status).toBe("off");
    useIslandStore.setState((s) => ({ settings: { ...s.settings, lyrics: { ...s.settings.lyrics, enabled: true } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(calls).toEqual([{ title: "A" }]);
    expect(useLyricsStore.getState().status).toBe("synced");
  });

  it("switching the feature off removes subscriptions and timers; switching it on restores them", async () => {
    answers = { A: SYNCED, B: SYNCED };
    const hook = mount();
    play(track("A"));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(useLyricsStore.getState().status).toBe("synced");
    play(track("B")); // debounce timer pending
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, disabledFeatures: ["lyrics"] } })));
    expect(useLyricsStore.getState()).toMatchObject({ status: "idle", key: "", lines: [] });
    play(track("C"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls.map((c) => c.title)).toEqual(["A"]);
    act(() => useIslandStore.setState((s) => ({ settings: { ...s.settings, disabledFeatures: [] } })));
    await act(async () => { await vi.advanceTimersByTimeAsync(LYRICS_DEBOUNCE_MS); });
    expect(calls.map((c) => c.title)).toEqual(["A", "C"]);
    hook.unmount();
    play(track("D"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls.map((c) => c.title)).toEqual(["A", "C"]); // unmounted: no subscription left
  });

  it("computes the palette once per cover and theme, with the fallback when there is no cover", async () => {
    mount();
    play(track("A", { artwork: "data:image/png;base64,AAAA" }));
    await settle();
    expect(useLyricsStore.getState().palette).toEqual(PALETTE);
    play(track("Z")); // another track without a cover
    await settle();
    expect(useLyricsStore.getState().palette).toEqual(LYRICS_FALLBACK);
  });
});
