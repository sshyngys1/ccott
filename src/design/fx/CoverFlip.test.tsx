import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import type { MediaState } from "../../shared/types";
import { CoverFlip } from "./CoverFlip";
import { resetSkipIntent } from "./flip";

const motionMode = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionMode.reduce,
}));

const track = (title: string, artwork: string | null = `data:image/png;base64,${title}`): MediaState => ({
  ...EMPTY_MEDIA,
  hasSession: true,
  sourceApp: "Spotify.exe",
  title,
  artist: "Artist",
  artwork,
  status: "playing",
  durationMs: 200_000,
});

afterEach(() => {
  motionMode.reduce = false;
  resetSkipIntent();
});

const flipping = (c: HTMLElement) => c.querySelector(".fx-flip")!.getAttribute("data-flipping") === "true";
const faces = (c: HTMLElement) => c.querySelectorAll(".fx-flip-face").length;

describe("CoverFlip", () => {
  it("at rest renders one face with the artwork and no back face", () => {
    const { container } = render(<CoverFlip media={track("A")} className="ig-art" />);
    expect(flipping(container)).toBe(false);
    expect(faces(container)).toBe(1);
    expect(container.querySelector(".ig-art img")).toHaveAttribute("src", "data:image/png;base64,A");
  });

  it("shows the note icon when there is no artwork", () => {
    const { container } = render(<CoverFlip media={track("A", null)} className="ig-art" />);
    expect(container.querySelector(".ig-art img")).toBeNull();
    expect(container.querySelector(".ig-art svg")).not.toBeNull();
  });

  it("does not flip on first appearance", () => {
    const { container } = render(<CoverFlip media={track("A")} className="ig-art" />);
    expect(flipping(container)).toBe(false);
  });

  it("flips on a track change: old cover in front, new cover on the back face", () => {
    const { container, rerender } = render(<CoverFlip media={track("A")} className="ig-art" />);
    rerender(<CoverFlip media={track("B")} className="ig-art" />);
    expect(flipping(container)).toBe(true);
    expect(faces(container)).toBe(2);
    expect(container.querySelector('[data-face="back"] img')).toHaveAttribute("src", "data:image/png;base64,B");
  });

  it("does not flip on pause, progress or a late artwork", () => {
    const a = track("A", null);
    const { container, rerender } = render(<CoverFlip media={a} className="ig-art" />);
    rerender(<CoverFlip media={{ ...a, status: "paused" }} className="ig-art" />);
    rerender(<CoverFlip media={{ ...a, positionMs: 60_000 }} className="ig-art" />);
    rerender(<CoverFlip media={{ ...a, artwork: "data:image/png;base64,late" }} className="ig-art" />);
    expect(flipping(container)).toBe(false);
    expect(faces(container)).toBe(1);
  });

  it("does not flip when the session appears", () => {
    const { container, rerender } = render(<CoverFlip media={EMPTY_MEDIA} className="ig-art" />);
    rerender(<CoverFlip media={track("A")} className="ig-art" />);
    expect(flipping(container)).toBe(false);
  });

  it("rapid changes keep one flip with two faces and end on the newest track", async () => {
    const { container, rerender } = render(<CoverFlip media={track("A")} className="ig-art" />);
    rerender(<CoverFlip media={track("B")} className="ig-art" />);
    rerender(<CoverFlip media={track("C")} className="ig-art" />);
    rerender(<CoverFlip media={track("D")} className="ig-art" />);
    expect(faces(container)).toBe(2);
    expect(container.querySelector('[data-face="back"] img')).toHaveAttribute("src", "data:image/png;base64,D");
    await waitFor(() => expect(flipping(container)).toBe(false), { timeout: 3000 });
    expect(faces(container)).toBe(1);
    await waitFor(() => expect(container.querySelectorAll(".ig-art img")).toHaveLength(1));
    expect(container.querySelector(".ig-art img")).toHaveAttribute("src", "data:image/png;base64,D");
  });

  it("reduced motion: no flip, the cover cross-fades to the new track", async () => {
    motionMode.reduce = true;
    const { container, rerender } = render(<CoverFlip media={track("A")} className="ig-art" />);
    act(() => rerender(<CoverFlip media={track("B")} className="ig-art" />));
    expect(flipping(container)).toBe(false);
    expect(faces(container)).toBe(1);
    await waitFor(() => expect(container.querySelectorAll(".ig-art img")).toHaveLength(1));
    expect(container.querySelector(".ig-art img")).toHaveAttribute("src", "data:image/png;base64,B");
  });
});
