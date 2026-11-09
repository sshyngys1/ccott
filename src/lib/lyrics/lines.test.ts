// All lyric text in tests is invented.
import { describe, expect, it } from "vitest";
import { EMPTY_MEDIA } from "../media/progress";
import { announceDelay, interludeDots, interludeEnd, lyricsArtSize, plainRows, trackKey, wheelSteps, withInterludes } from "./lines";

describe("trackKey", () => {
  const media = { ...EMPTY_MEDIA, hasSession: true, title: "  Some   Title ", artist: "ARTIST", album: "Al", durationMs: 200_900 };
  it("normalises text and buckets the duration by 2 s (same recipe as Rust)", () => {
    expect(trackKey(media)).toBe("some title|artist|al|100");
    expect(trackKey({ ...media, durationMs: 200_000 })).toBe(trackKey(media));
    expect(trackKey({ ...media, durationMs: 204_000 })).not.toBe(trackKey(media));
  });
  it("is empty without a session or a title", () => {
    expect(trackKey({ ...media, hasSession: false })).toBe("");
    expect(trackKey({ ...media, title: "  " })).toBe("");
  });
});

describe("withInterludes", () => {
  it("adds an empty line after a sung line followed by a pause longer than 6 s", () => {
    const lines = withInterludes([
      { timeMs: 1000, text: "first" },
      { timeMs: 3000, text: "second" },
      { timeMs: 12_000, text: "third" },
    ]);
    expect(lines.map((l) => [l.timeMs, l.text])).toEqual([[1000, "first"], [3000, "second"], [7000, ""], [12_000, "third"]]);
  });
  it("leaves an explicit empty line and short gaps alone", () => {
    const input = [{ timeMs: 0, text: "a" }, { timeMs: 5000, text: "" }, { timeMs: 30_000, text: "b" }, { timeMs: 36_000, text: "c" }];
    expect(withInterludes(input)).toEqual(input);
  });
});

describe("plainRows", () => {
  it("collapses blank runs into one stanza gap and trims the ends", () => {
    expect(plainRows("\n\none\r\ntwo\n\n\n\nthree\n\n")).toEqual(["one", "two", "", "three"]);
    expect(plainRows("")).toEqual([]);
  });
});

describe("interlude dots", () => {
  it("lights one, two, three dots over thirds of the pause", () => {
    expect(interludeDots(0, 9000, 0)).toBe(1);
    expect(interludeDots(0, 9000, 3100)).toBe(2);
    expect(interludeDots(0, 9000, 6100)).toBe(3);
    expect(interludeDots(0, 9000, 99_000)).toBe(3);
    expect(interludeDots(0, 9000, -50)).toBe(1);
  });
  it("ends at the next line, or after the default pause for the last line", () => {
    const lines = [{ timeMs: 1000, text: "" }, { timeMs: 9000, text: "x" }];
    expect(interludeEnd(lines, 0)).toBe(9000);
    expect(interludeEnd(lines, 1)).toBe(15_000);
  });
});

describe("announce throttle", () => {
  it("waits at least 1.2 s and keeps announcements 4 s apart", () => {
    expect(announceDelay(10_000, 0)).toBe(1200);
    expect(announceDelay(10_000, 9000)).toBe(3000);
    expect(announceDelay(10_000, 10_000)).toBe(4000);
  });
});

describe("wheel + art size", () => {
  it("turns wheel distance into whole line steps and keeps the remainder", () => {
    expect(wheelSteps(0, 30)).toEqual({ steps: 0, rest: 30 });
    expect(wheelSteps(30, 30)).toEqual({ steps: 1, rest: 12 });
    expect(wheelSteps(0, -100)).toEqual({ steps: -2, rest: -4 });
  });
  it("clamps the cover to 112…176 px (body 312 → 176, low panel 244 → 112)", () => {
    expect(lyricsArtSize(312)).toBe(176);
    expect(lyricsArtSize(388)).toBe(176);
    expect(lyricsArtSize(244)).toBe(112);
    expect(lyricsArtSize(0)).toBe(112);
  });
});
