import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import type { MediaState } from "../../shared/types";
import { coverFlip } from "../motion";
import { coverOf, flipDuration, flipTarget, frontHidden, noteSkip, resetSkipIntent, shouldFlip, SKIP_INTENT_MS, takeSkipDirection } from "./flip";

const track = (title: string, extra: Partial<MediaState> = {}): MediaState => ({
  ...EMPTY_MEDIA,
  hasSession: true,
  sourceApp: "Spotify.exe",
  title,
  artist: "Artist",
  status: "playing",
  durationMs: 200_000,
  ...extra,
});

afterEach(() => resetSkipIntent());

describe("shouldFlip", () => {
  it("flips when the track identity changes", () => {
    expect(shouldFlip(track("A"), track("B"))).toBe(true);
    expect(shouldFlip(track("A"), track("A", { artist: "Other" }))).toBe(true);
  });

  it("does not flip on pause, seek, position updates or a late artwork", () => {
    const a = track("A");
    expect(shouldFlip(a, { ...a, status: "paused" })).toBe(false);
    expect(shouldFlip(a, { ...a, positionMs: 90_000, positionSampledAt: 5 })).toBe(false);
    expect(shouldFlip(a, { ...a, artwork: "data:image/png;base64,AA" })).toBe(false);
  });

  it("does not flip when the session appears or disappears", () => {
    expect(shouldFlip(EMPTY_MEDIA, track("A"))).toBe(false);
    expect(shouldFlip(track("A"), EMPTY_MEDIA)).toBe(false);
  });

  it("cover identity ignores everything but the track", () => {
    expect(coverOf(track("A")).id).toBe(coverOf(track("A", { status: "paused", positionMs: 1 })).id);
    expect(coverOf(EMPTY_MEDIA)).toEqual({ id: "", artwork: null });
  });
});

describe("direction", () => {
  it("«Следующий» turns forward, «Предыдущий» backward, no button counts as next", () => {
    noteSkip(-1, 1000);
    expect(takeSkipDirection(1200)).toBe(-1);
    expect(takeSkipDirection(1300)).toBe(1); // consumed
    noteSkip(1, 0);
    expect(takeSkipDirection(10)).toBe(1);
  });

  it("an old button press does not steer a later change from another device", () => {
    noteSkip(-1, 0);
    expect(takeSkipDirection(SKIP_INTENT_MS + 1)).toBe(1);
  });
});

describe("flipTarget (rapid changes retarget the one running flip)", () => {
  it("a fresh flip makes exactly one turn in the chosen direction", () => {
    expect(flipTarget(0, 1)).toBe(360);
    expect(flipTarget(0, -1)).toBe(-360);
  });

  it("keeps the current turn while the front face has not come back yet", () => {
    expect(flipTarget(10, 1)).toBe(360);
    expect(flipTarget(200, 1)).toBe(360);
    expect(flipTarget(-200, -1)).toBe(-360);
  });

  it("adds a turn when the front already faces the viewer again (it must swap to the newest track first)", () => {
    expect(flipTarget(300, 1)).toBe(720);
    expect(flipTarget(-300, -1)).toBe(-720);
  });

  it("a reversed direction mid-air turns back without a half-turn hang", () => {
    expect(flipTarget(100, -1)).toBe(0);
    expect(frontHidden(100)).toBe(true); // so the front swaps before it shows at 0°
    expect(flipTarget(30, -1)).toBe(-360);
  });

  it("every target passes through the front-hidden range from the start angle", () => {
    for (let from = -720; from <= 720; from += 15)
      for (const dir of [1, -1] as const) {
        const to = flipTarget(from, dir);
        expect(Math.abs(to % 360)).toBe(0);
        expect(Math.sign(to - from) === dir || to === from).toBe(true);
        let passes = frontHidden(from);
        for (let a = from; dir > 0 ? a <= to : a >= to; a += dir * 5) passes ||= frontHidden(a);
        expect(passes).toBe(true);
      }
  });

  it("frontHidden matches the faces", () => {
    expect(frontHidden(0)).toBe(false);
    expect(frontHidden(180)).toBe(true);
    expect(frontHidden(-180)).toBe(true);
    expect(frontHidden(360)).toBe(false);
  });
});

describe("timing", () => {
  it("total duration is within the 600–750 ms budget and the hop peaks at 35–45 %", () => {
    expect(coverFlip.duration).toBeGreaterThanOrEqual(0.6);
    expect(coverFlip.duration).toBeLessThanOrEqual(0.75);
    expect(coverFlip.lift.peak).toBeGreaterThanOrEqual(0.35);
    expect(coverFlip.lift.peak).toBeLessThanOrEqual(0.45);
    expect(coverFlip.fade.duration).toBeGreaterThanOrEqual(0.1);
    expect(coverFlip.fade.duration).toBeLessThanOrEqual(0.15);
  });

  it("a retarget keeps a sane duration", () => {
    expect(flipDuration(0, 360, 0.68)).toBeCloseTo(0.68);
    expect(flipDuration(300, 720, 0.68)).toBeLessThanOrEqual(0.68 * 1.4);
    expect(flipDuration(350, 360, 0.68)).toBeCloseTo(0.68 * 0.6);
  });
});
