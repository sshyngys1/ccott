// Real registry (F2's media and timer pill activities): clicking a pill activity opens its tab, whatever tab was active before.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockListenerCount, resetMock } from "../ipc/mock";
import { resetTimerStore, useTimerStore } from "../lib/timer/store";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";

beforeEach(() => {
  resetMock(); // the mock plays a track
  resetIslandStore();
  resetTimerStore();
});

afterEach(() => {
  cleanup();
  resetTimerStore();
  resetIslandStore();
});

async function mountOnTab(tab: "clipboard" | "text" | "notes") {
  useIslandStore.getState().setActiveTab(tab);
  render(<Island />);
  await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
}

describe("pill activity click → openTab", () => {
  it("the media pill expands the island and switches to «Главная»", async () => {
    await mountOnTab("clipboard");
    const pill = await screen.findByRole("button", { name: /Открыть плеер/ });
    expect(useIslandStore.getState().mode).toBe("collapsed");
    fireEvent.click(pill);
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().activeTab).toBe("home");
    expect(await screen.findByRole("tab", { name: "Главная" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Главная" }).id);
  });

  it("pressing the pill (it takes focus on mousedown) does not expand the island before the click lands", async () => {
    // Regression: the focus handler used to expand at once, the pill unmounted before mouseup and the click never fired.
    await mountOnTab("clipboard");
    const pill = await screen.findByRole("button", { name: /Открыть плеер/ });
    act(() => pill.focus());
    expect(useIslandStore.getState().mode).toBe("collapsed");
    fireEvent.click(pill);
    expect(useIslandStore.getState().activeTab).toBe("home");
  });

  it("the timer pill (higher priority than media) switches to «Заметки»", async () => {
    await mountOnTab("text");
    act(() => {
      useTimerStore.getState().selectPreset(5);
      useTimerStore.getState().toggle();
    });
    const pill = await screen.findByRole("button", { name: /Открыть таймер/ });
    fireEvent.click(pill);
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().activeTab).toBe("notes");
    expect(await screen.findByRole("tab", { name: "Заметки" })).toHaveAttribute("aria-selected", "true");
  });

  it("works from the settings view and with the pointer already over the island", async () => {
    await mountOnTab("notes");
    act(() => useIslandStore.getState().setView("settings"));
    const pill = await screen.findByRole("button", { name: /Открыть плеер/ });
    act(() => useIslandStore.getState().setHoverInside(true)); // hover-grown pill under the cursor
    fireEvent.click(pill);
    expect(useIslandStore.getState().view).toBe("tabs");
    expect(useIslandStore.getState().activeTab).toBe("home");
    expect(await screen.findByRole("tab", { name: "Главная" })).toHaveAttribute("aria-selected", "true");
  });
});
