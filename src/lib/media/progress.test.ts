import { describe, expect, it } from "vitest";
import type { MediaState } from "../../shared/types";
import { EMPTY_MEDIA, PAUSE_GRACE_MS, extrapolatePosition, isMediaActive, progressFraction, sameTrack, sourceAppLabel } from "./progress";

const base: MediaState = {
  ...EMPTY_MEDIA,
  hasSession: true,
  sourceApp: "Spotify.exe",
  title: "T",
  artist: "A",
  status: "playing",
  positionMs: 10_000,
  durationMs: 100_000,
  positionSampledAt: 1_000_000,
  canPlayPause: true,
  canSeek: true,
};

describe("extrapolatePosition", () => {
  it("adds elapsed time while playing", () => {
    expect(extrapolatePosition(base, 1_005_000)).toBe(15_000);
  });
  it("does not move while paused or stopped", () => {
    expect(extrapolatePosition({ ...base, status: "paused" }, 1_050_000)).toBe(10_000);
    expect(extrapolatePosition({ ...base, status: "stopped" }, 1_050_000)).toBe(10_000);
  });
  it("clamps to the duration", () => {
    expect(extrapolatePosition(base, 9_000_000)).toBe(100_000);
  });
  it("ignores a sample from the future (clock skew)", () => {
    expect(extrapolatePosition(base, 999_000)).toBe(10_000);
  });
  it("unknown duration (live stream) does not clamp", () => {
    expect(extrapolatePosition({ ...base, durationMs: 0 }, 1_005_000)).toBe(15_000);
  });
  it("never negative", () => {
    expect(extrapolatePosition({ ...base, positionMs: -5 }, 1_000_000)).toBe(0);
  });
});

describe("progressFraction", () => {
  it("is 0..1", () => {
    expect(progressFraction(25, 100)).toBe(0.25);
    expect(progressFraction(200, 100)).toBe(1);
    expect(progressFraction(-1, 100)).toBe(0);
  });
  it("0 for unknown duration", () => {
    expect(progressFraction(10, 0)).toBe(0);
    expect(progressFraction(10, NaN)).toBe(0);
  });
});

describe("isMediaActive", () => {
  it("active while playing", () => expect(isMediaActive(base, null, 5)).toBe(true));
  it("inactive without a session", () => expect(isMediaActive(EMPTY_MEDIA, null, 5)).toBe(false));
  it("paused: active for 30 s, then not", () => {
    const paused = { ...base, status: "paused" as const };
    expect(isMediaActive(paused, 1000, 1000 + PAUSE_GRACE_MS - 1)).toBe(true);
    expect(isMediaActive(paused, 1000, 1000 + PAUSE_GRACE_MS)).toBe(false);
  });
  it("paused with unknown pause time (state loaded at start) → inactive", () => {
    expect(isMediaActive({ ...base, status: "paused" }, null, 5)).toBe(false);
  });
  it("stopped / unknown → inactive", () => {
    expect(isMediaActive({ ...base, status: "stopped" }, 0, 1)).toBe(false);
    expect(isMediaActive({ ...base, status: "unknown" }, 0, 1)).toBe(false);
  });
});

describe("misc", () => {
  it("sourceAppLabel strips .exe", () => {
    expect(sourceAppLabel("Spotify.exe")).toBe("Spotify");
    expect(sourceAppLabel("chrome.EXE")).toBe("Chrome");
    expect(sourceAppLabel("")).toBe("");
  });
  it("sameTrack", () => {
    expect(sameTrack(base, { ...base, positionMs: 5, artwork: "x" })).toBe(true);
    expect(sameTrack(base, { ...base, title: "Other" })).toBe(false);
    expect(sameTrack(EMPTY_MEDIA, EMPTY_MEDIA)).toBe(false);
  });
});
