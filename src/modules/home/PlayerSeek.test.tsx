import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import * as ipc from "../../ipc";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import { resetMediaStore, useMediaStore } from "../../lib/media/store";
import { PlayerSeek } from "./PlayerSeek";

afterEach(() => { cleanup(); resetMediaStore(); vi.restoreAllMocks(); vi.useRealTimers(); });

function playing() {
  vi.useFakeTimers();
  useMediaStore.getState().applyState({
    ...EMPTY_MEDIA, hasSession: true, status: "playing", canSeek: true,
    positionMs: 5000, durationMs: 60_000, positionSampledAt: Date.now(),
  });
}

it("updates the range gradient and timeline only once per second while playing", () => {
  playing();
  let commits = 0;
  const view = render(<Profiler id="seek" onRender={() => { commits++; }}><PlayerSeek /></Profiler>);
  const slider = screen.getByRole("slider", { name: t("trackPosition") });
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
  commits = 0;
  // Separate acts expose any unintended 4 Hz renders/paints, rather than batching them away.
  for (let tick = 0; tick < 40; tick++) act(() => vi.advanceTimersByTime(250));
  const fillWrites = writes.mock.calls.filter(call => call[0] === "--ig-value").length;
  console.info("PERF_SEEK_DOM", JSON.stringify({ simulatedMs: 10_000, commits, fillWrites }));
  expect(commits).toBe(10);
  expect(fillWrites).toBe(10);
  expect(slider).toHaveValue("15000");
  expect(slider).toHaveAttribute("aria-valuetext", t("of", { p0: "0:15", p1: "1:00" }));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops while paused/hidden and catches up immediately when visible", () => {
  playing();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  render(<PlayerSeek />);
  const slider = screen.getByRole("slider", { name: t("trackPosition") });
  act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(10_000));
  expect(slider).toHaveValue("5000");
  act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(slider).toHaveValue("15000");
  act(() => useMediaStore.getState().applyState({
    ...useMediaStore.getState().media, status: "paused", positionMs: 17_000, positionSampledAt: Date.now(),
  }));
  expect(slider).toHaveValue("17000");
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(10_000));
  expect(slider).toHaveValue("17000");
});

it("keeps millisecond precision and immediate drag/keyboard feedback despite rounded paint", () => {
  playing();
  render(<PlayerSeek />);
  const invoke = vi.spyOn(ipc, "invoke").mockResolvedValue(undefined);
  const slider = screen.getByRole("slider", { name: t("trackPosition") });
  fireEvent.change(slider, { target: { value: "12345" } });
  expect(slider).toHaveValue("12345");
  expect(slider.style.getPropertyValue("--ig-value")).toBe("20.6%");
  act(() => vi.advanceTimersByTime(2000));
  expect(slider).toHaveValue("12345");
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  expect(invoke).toHaveBeenCalledWith("media_seek", { positionMs: 12345 });
});
