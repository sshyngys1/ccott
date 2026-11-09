import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "./index";
import { lyricsMockConfig, mockLyricsResult } from "./lyricsMock";
import { mockConfig, resetMock } from "./mock";

afterEach(() => {
  vi.useRealTimers();
  resetMock();
});

describe("mock lyrics_get", () => {
  it("covers every state across the three mock tracks, with invented text only", () => {
    expect(mockLyricsResult(0).status).toBe("synced");
    expect(mockLyricsResult(1).status).toBe("plain");
    expect(mockLyricsResult(2).status).toBe("instrumental");
    expect(mockLyricsResult(-1).status).toBe("notFound");
    const r = mockLyricsResult(0);
    if (r.status !== "synced") throw new Error("synced expected");
    expect(r.lines.some((l) => l.text === "")).toBe(true); // an explicit interlude
    expect(r.lines.every((l, i) => i === 0 || l.timeMs > r.lines[i - 1].timeMs)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("returns notFound at once, without latency, when the setting or the feature is off", async () => {
    resetMock();
    await invoke("settings_set", { patch: { lyrics: { enabled: false } as never } });
    const started = Date.now();
    expect(await invoke("lyrics_get", { title: "x", artist: "y", album: "", durationMs: 1000 })).toEqual({ status: "notFound" });
    expect(Date.now() - started).toBeLessThan(lyricsMockConfig.delayMs);
    resetMock();
    await invoke("settings_set", { patch: { disabledFeatures: ["lyrics"] } });
    expect(await invoke("lyrics_get", { title: "x", artist: "y", album: "", durationMs: 1000 })).toEqual({ status: "notFound" });
  });

  it("failure is a value, never a rejection", async () => {
    resetMock();
    mockConfig.lyrics.fail = true;
    expect(await invoke("lyrics_get", { title: "x", artist: "y", album: "", durationMs: 1000 })).toMatchObject({ status: "error" });
  });
});
