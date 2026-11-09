// Synced lyrics in the shell (§30): pill line + tint, view, Esc, priorities, feature switch. All lyric text is invented.
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc";
import { mockListenerCount, mockStats, resetMock } from "../ipc/mock";
import { t } from "../i18n";
import { usePillFitStore } from "../lib/lyrics/pillFit";
import { resetLyricsStore } from "../lib/lyrics/store";
import { resetMediaStore, useMediaStore } from "../lib/media/store";
import { resetTimerStore, useTimerStore } from "../lib/timer/store";
import type { LyricsResult } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";

const SYNCED: LyricsResult = {
  status: "synced",
  source: "lrclib",
  lines: [
    // The browser mock starts the track at 73 s; the first line stays active until ~76 s.
    { timeMs: 70_000, text: "invented opening line" },
    { timeMs: 76_000, text: "invented second line" },
    { timeMs: 82_000, text: "invented third line" },
    { timeMs: 88_000, text: "invented last line" },
  ],
};
let answer: LyricsResult;
let lyricsCalls: number;
let lastArgs: { durationMs: number; force?: boolean } | undefined;

beforeEach(() => {
  resetMock();
  resetIslandStore();
  resetTimerStore();
  resetMediaStore();
  resetLyricsStore();
  answer = SYNCED;
  lyricsCalls = 0;
  const real = ipc.invoke;
  vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: unknown) => {
    if (cmd === "lyrics_get") {
      lyricsCalls++;
      lastArgs = args as { durationMs: number; force?: boolean };
      return Promise.resolve(answer);
    }
    return (real as (c: string, a: unknown) => Promise<unknown>)(cmd, args);
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetLyricsStore();
  resetMediaStore();
  resetTimerStore();
  resetIslandStore();
});

async function mount() {
  const view = render(<Island />);
  await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
  return view;
}
/** Lines in the pill; an outgoing line may still be fading out beside the new one. */
const lyricLines = () => [...document.querySelectorAll(".ig-pill-lyric__text:not(.ig-pill-lyric__twin)")].map((el) => el.textContent);
const noLyricLine = () => waitFor(() => expect(lyricLines()).toEqual([]));
type LyricsPatch = Partial<ReturnType<typeof useIslandStore.getState>["settings"]["lyrics"]>;
/** Settings come from the (mock) backend: change them there, then the shell picks them up. */
const patchLyrics = (patch: LyricsPatch) => act(async () => { await ipc.invoke("settings_set", { patch: { lyrics: patch as never } }); });
const disableLyricsFeature = () => act(async () => { await ipc.invoke("settings_set", { patch: { disabledFeatures: ["lyrics"] } }); });

describe("lyrics pill", () => {
  it("shows the current line instead of the media pill and tints the island", async () => {
    await mount();
    await waitFor(() => expect(lyricLines()).toContain("invented opening line"), { timeout: 3000 });
    expect(document.querySelector(".ig-island")).toHaveClass("ig-glass--lyrics");
    expect(document.querySelectorAll('.ig-lyrics-tint[data-on="true"]')).toHaveLength(1);
    // The button keeps the media pill's accessible name; the line itself is hidden from assistive tech.
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Открыть плеер/ }).length).toBeGreaterThan(0));
    expect(document.querySelector(".ig-pill-lyric")).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to the plain media pill when «В пилюле» is off, and no tint remains", async () => {
    await patchLyrics({ inPill: false });
    await mount();
    await waitFor(() => expect(lyricsCalls).toBeGreaterThan(0), { timeout: 3000 });
    await screen.findByRole("button", { name: /Открыть плеер/ });
    await noLyricLine();
    expect(document.querySelector(".ig-island")).not.toHaveClass("ig-glass--lyrics");
    expect(document.querySelector('.ig-lyrics-tint[data-on="true"]')).toBeNull();
  });

  it("uses the plain media pill for unsynced lyrics", async () => {
    answer = { status: "plain", text: "one\ntwo", source: "lrclib" };
    await mount();
    await waitFor(() => expect(lyricsCalls).toBeGreaterThan(0), { timeout: 3000 });
    await screen.findByRole("button", { name: /Открыть плеер/ });
    await noLyricLine();
  });

  it("a running timer keeps its higher priority over the lyric line", async () => {
    await mount();
    await waitFor(() => expect(lyricLines().length).toBeGreaterThan(0), { timeout: 3000 });
    act(() => {
      useTimerStore.getState().selectPreset(5);
      useTimerStore.getState().toggle();
    });
    expect(await screen.findByRole("button", { name: /Открыть таймер/ })).toBeInTheDocument();
    await noLyricLine();
    await waitFor(() => expect(document.querySelector(".ig-island")).not.toHaveClass("ig-glass--lyrics"));
  });

  it("a toast keeps its priority and drops the tint", async () => {
    await mount();
    await waitFor(() => expect(lyricLines().length).toBeGreaterThan(0), { timeout: 3000 });
    act(() => useIslandStore.getState().setToast({ id: 1, label: "Toast", preview: "" }));
    expect(await screen.findByText("Toast")).toBeInTheDocument();
    await noLyricLine();
    await waitFor(() => expect(document.querySelector(".ig-island")).not.toHaveClass("ig-glass--lyrics"));
  });

  it("with the lyrics feature off: no request, no line, no tint, no button", async () => {
    await disableLyricsFeature();
    await mount();
    await screen.findByRole("button", { name: /Открыть плеер/ });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(lyricsCalls).toBe(0);
    await noLyricLine();
    expect(document.querySelector(".ig-island")).not.toHaveClass("ig-glass--lyrics");
    act(() => {
      useIslandStore.getState().setMode("expanded");
    });
    await screen.findByRole("tab", { name: "Главная" });
    expect(screen.queryByRole("button", { name: t("lyrics.title") })).toBeNull();
  });
});

describe("lyrics pill width", () => {
  it("the island and its shape follow the width the pill asks for (never wider than the panel)", async () => {
    await mount();
    await waitFor(() => expect(lyricLines().length).toBeGreaterThan(0), { timeout: 3000 });
    const island = document.querySelector<HTMLElement>(".ig-island")!;
    act(() => usePillFitStore.getState().set(600));
    await waitFor(() => expect(parseFloat(island.style.width)).toBeCloseTo(600, 0), { timeout: 4000 });
    await waitFor(() => expect(mockStats.lastShape?.width).toBeGreaterThanOrEqual(600), { timeout: 4000 });
    act(() => usePillFitStore.getState().set(5000));
    await waitFor(() => expect(parseFloat(island.style.width)).toBeCloseTo(720, 0), { timeout: 4000 });
    expect(mockStats.lastShape?.width).toBeLessThanOrEqual(800);
  });
});

describe("lyrics view", () => {
  async function openViewForSeek() {
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("lyrics");
    });
    await screen.findByRole("slider", { name: t("trackPosition") }, { timeout: 3000 });
    return document.body;
  }
  async function openView() {
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
    });
    const button = await screen.findByRole("button", { name: t("lyrics.title") });
    await waitFor(() => expect(button).toHaveAttribute("data-available", "synced"), { timeout: 3000 });
    fireEvent.click(button);
    return screen.findByRole("region", { name: t("lyrics.title") });
  }

  it("opens from the player button, tints the island, shows lines; Esc goes back to the tabs", async () => {
    const body = await openView();
    expect(useIslandStore.getState().view).toBe("lyrics");
    await waitFor(() => expect(document.querySelector(".ig-island")).toHaveClass("ig-glass--lyrics"));
    expect(await within(body).findByText("invented opening line")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-current="true"]')).toHaveTextContent("invented opening line"));
    expect(screen.getByRole("button", { name: t("lyrics.inPill") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByRole("group", { name: t("lyrics.title") }), { key: "Escape" });
    await waitFor(() => expect(useIslandStore.getState().view).toBe("tabs"));
    expect(await screen.findByRole("tab", { name: "Главная" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.querySelector(".ig-island")).not.toHaveClass("ig-glass--lyrics"));
  });

  it("the back button returns to the tabs; the chip toggles the pill line setting", async () => {
    await openView();
    fireEvent.click(await screen.findByRole("button", { name: t("lyrics.inPill") }));
    await waitFor(() => expect(useIslandStore.getState().settings.lyrics.inPill).toBe(false));
    expect(screen.getByRole("button", { name: t("lyrics.inPill") })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(await screen.findByRole("button", { name: t("lyrics.back") }));
    await waitFor(() => expect(useIslandStore.getState().view).toBe("tabs"));
  });

  it("clicking a line seeks to its time minus the offset", async () => {
    await patchLyrics({ offsetMs: 500 });
    const body = await openView();
    const seek = vi.spyOn(useMediaStore.getState(), "seek");
    // `seek` is read from the store at call time: replace it on the state object.
    act(() => useMediaStore.setState({ seek }));
    fireEvent.click(await within(body).findByText("invented last line"));
    expect(seek).toHaveBeenCalledWith(88_000 - 500);
  });

  it.each([
    [{ status: "notFound" } as LyricsResult, "lyrics.none"],
    [{ status: "instrumental" } as LyricsResult, "lyrics.instrumental"],
    [{ status: "error", message: "offline" } as LyricsResult, "lyrics.error"],
  ] as const)("shows the %j state", async (result, key) => {
    answer = result;
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("lyrics");
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(t(key as "lyrics.none")), { timeout: 3000 });
    if (result.status === "error") {
      answer = SYNCED;
      fireEvent.click(screen.getByRole("button", { name: t("lyrics.retry") }));
      await waitFor(() => expect(screen.getByText("invented opening line")).toBeInTheDocument(), { timeout: 3000 });
    }
    expect(screen.getByRole("button", { name: t("lyrics.inPill") }) as HTMLButtonElement).toBeInTheDocument();
  });

  it("plain lyrics are a scrollable list without the active line; the chip is disabled", async () => {
    answer = { status: "plain", text: "first row\n\n\nsecond row", source: "lrclib" };
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("lyrics");
    });
    await screen.findByText("second row", {}, { timeout: 3000 });
    expect(document.querySelector(".ig-lyrics--plain")).not.toBeNull();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
    expect(screen.getByRole("button", { name: t("lyrics.inPill") })).toBeDisabled();
  });

  it("search off shows the invitation instead of requesting anything", async () => {
    await patchLyrics({ enabled: false });
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("lyrics");
    });
    expect(await screen.findByText(t("lyrics.off"))).toBeInTheDocument();
    expect(lyricsCalls).toBe(0);
  });

  it("closes itself when the feature is switched off", async () => {
    await openView();
    await disableLyricsFeature();
    await waitFor(() => expect(useIslandStore.getState().view).toBe("tabs"));
  });

  it("«Текста пока нет» has a Retry button that asks again with the forced flag", async () => {
    answer = { status: "notFound" };
    await mount();
    await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("lyrics");
    });
    const retry = await screen.findByRole("button", { name: t("lyrics.retry") }, { timeout: 3000 });
    expect(lastArgs!.force).toBeFalsy();
    answer = SYNCED;
    fireEvent.click(retry);
    await waitFor(() => expect(lastArgs!.force).toBe(true));
    expect(lastArgs!.durationMs).toBe(useMediaStore.getState().media.durationMs);
    expect(await screen.findByText("invented opening line", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("the timeline in the lyrics view seeks like the player card (drag release → media_seek)", async () => {
    const body = await openViewForSeek();
    const slider = within(body).getByRole("slider", { name: t("trackPosition") });
    expect(slider).toBeEnabled();
    const seek = vi.spyOn(ipc, "invoke");
    fireEvent.change(slider, { target: { value: "90000" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(seek).toHaveBeenCalledWith("media_seek", { positionMs: 90000 }));
  });

  it("lyric lines and the timeline are not covered by the tint or any other layer (hit target = the control)", async () => {
    const body = await openViewForSeek();
    // jsdom loads no stylesheet: check the source of the layer that sits under the content.
    const css = readFileSync("src/design/lyrics.css", "utf8");
    expect(css.slice(css.indexOf(".ig-lyrics-tint {"), css.indexOf("}", css.indexOf(".ig-lyrics-tint {")))).toMatch(/pointer-events:\s*none/);
    expect(within(body).getByRole("slider", { name: t("trackPosition") }).closest(".ig-lyrics-side")).not.toBeNull();
    const line = await within(body).findByText("invented opening line");
    expect(line.closest(".ig-lyrics")).toHaveAttribute("data-seekable", "true");
  });
});
