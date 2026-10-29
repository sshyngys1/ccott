import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import { initMedia, resetMediaStore, useMediaStore } from "../../lib/media/store";
import { PlayerCard } from "./PlayerCard";

beforeEach(async () => {
  resetMock();
  resetMediaStore();
  await initMedia();
});

afterEach(() => {
  cleanup();
  resetMediaStore();
  setLanguage("ru");
  vi.restoreAllMocks();
});

it.each(["ru", "en"] as const)("places accessible transport controls above the timeline outside metadata (%s)", (language) => {
  setLanguage(language);
  const title = "A very long track title ".repeat(12);
  useMediaStore.getState().applyState({ ...useMediaStore.getState().media, title });
  const { container } = render(<PlayerCard />);
  const controls = container.querySelector(".hm-controls")!;
  expect(controls.parentElement).toHaveClass("hm-player");
  expect(controls.previousElementSibling).toHaveClass("hm-player-top");
  expect(controls.nextElementSibling).toHaveClass("hm-seek");
  expect([...controls.querySelectorAll("button")].map(button => button.getAttribute("aria-label")))
    .toEqual([t("previousTrack"), t("pause"), t("nextTrack")]);
  expect(screen.getByText(title.trim())).toHaveClass("ig-truncate");
  expect(screen.getByText(title.trim())).toHaveAttribute("title", title);
  act(() => useMediaStore.getState().applyState(EMPTY_MEDIA));
  for (const button of controls.querySelectorAll("button")) expect(button).toBeDisabled();
  expect(screen.getByRole("slider", { name: t("trackPosition") })).toBeDisabled();
});

it("does not seek a new track when the former track changes during a drag", async () => {
  render(<PlayerCard />);
  const spy = vi.spyOn(ipc, "invoke");
  const slider = screen.getByRole("slider", { name: t("trackPosition") });
  fireEvent.change(slider, { target: { value: "90000" } });
  act(() => useMediaStore.getState().applyState({ ...useMediaStore.getState().media, title: "New track", positionMs: 0 }));
  fireEvent.pointerUp(slider);
  expect(spy.mock.calls.filter(call => call[0] === "media_seek")).toHaveLength(0);
  fireEvent.change(slider, { target: { value: "40000" } });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  await waitFor(() => expect(spy).toHaveBeenCalledWith("media_seek", { positionMs: 40000 }));
});

it("cancelling a pointer drag leaves the playback position unchanged", () => {
  render(<PlayerCard />);
  const spy = vi.spyOn(ipc, "invoke");
  const slider = screen.getByRole("slider", { name: t("trackPosition") });
  fireEvent.change(slider, { target: { value: "90000" } });
  fireEvent.pointerCancel(slider);
  fireEvent.blur(slider);
  expect(spy.mock.calls.filter(call => call[0] === "media_seek")).toHaveLength(0);
});
