import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mockCopy, mockEmit, mockListenerCount, mockSetMedia, mockStats, resetMock } from "../ipc/mock";
import { EMPTY_MEDIA } from "../lib/media/progress";
import { useMediaStore } from "../lib/media/store";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { backgroundScreens } from "./preloadScreens";

// These interaction tests exercise the normal, preloaded UI. Cold loading is tested separately.
beforeAll(async () => {
  await Promise.all(backgroundScreens.map(screen => screen.preload()));
});

async function mountIsland() {
  const utils = render(<Island />);
  // The hover listener registers asynchronously.
  await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
  return utils;
}

beforeEach(() => {
  resetMock();
  // The mock plays a track by default, and F2's real «Главная» then shows it in the pill instead of the clock.
  // These tests are about the idle pill: no media session, in the backend mock and in the module's store.
  mockSetMedia({ hasSession: false, status: "stopped" });
  useMediaStore.getState().applyState(EMPTY_MEDIA);
  resetIslandStore();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-vibrancy");
});

afterEach(() => {
  cleanup();
  resetIslandStore();
});

describe("Island", () => {
  it("collapsed: shows the clock (HH:MM) and no tabs", async () => {
    await mountIsland();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("region", { name: "Dynamic Island" })).toHaveAttribute("data-mode", "collapsed");
  });

  it("expands after island://hover { inside: true } and shows tabs from the registry", async () => {
    await mountIsland();
    act(() => mockEmit("island://hover", { inside: true }));
    const tablist = await screen.findByRole("tablist", { name: "Вкладки острова" });
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Главная", "Буфер", "Текст", "Заметки"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(useIslandStore.getState().mode).toBe("expanded");
  });

  it("switches tabs by click and by arrow keys", async () => {
    await mountIsland();
    act(() => mockEmit("island://hover", { inside: true }));
    await screen.findByRole("tablist");

    fireEvent.click(screen.getByRole("tab", { name: "Заметки" }));
    expect(screen.getByRole("tab", { name: "Заметки" })).toHaveAttribute("aria-selected", "true");
    expect(useIslandStore.getState().activeTab).toBe("notes");
    expect(await screen.findByRole("heading", { name: "Заметки" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Заметки" }), { key: "ArrowRight" });
    expect(useIslandStore.getState().activeTab).toBe("home"); // wraps around
  });

  it("collapses again after the cursor leaves", async () => {
    await mountIsland();
    act(() => mockEmit("island://hover", { inside: true }));
    await screen.findByRole("tablist");
    act(() => mockEmit("island://hover", { inside: false }));
    await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull(), { timeout: 2000 });
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("sets data-vibrancy from window_set_vibrancy and data-theme on <html>", async () => {
    await mountIsland();
    await waitFor(() => expect(document.documentElement.dataset.vibrancy).toBe("none"));
    expect(["light", "dark"]).toContain(document.documentElement.dataset.theme);
  });

  it("reports the mode and the shape to Rust a few times per transition (not once per frame)", async () => {
    await mountIsland();
    await waitFor(() => expect(mockStats.lastMode).toBe("collapsed"));
    await waitFor(() => expect(mockStats.shapeCalls).toBeGreaterThan(0));
    const atRest = mockStats.shapeCalls;
    act(() => mockEmit("island://hover", { inside: true }));
    await waitFor(() => expect(mockStats.lastMode).toBe("expanded"));
    // hover growth + expand start (covering shapes) + the exact shape once Motion finishes; no per-frame spam.
    await new Promise((r) => setTimeout(r, 900));
    const calls = mockStats.shapeCalls;
    await new Promise((r) => setTimeout(r, 300));
    expect(mockStats.shapeCalls).toBe(calls);
    expect(calls - atRest).toBeLessThanOrEqual(6);
    // The last shape sent is the exact panel shape (the covering one was replaced).
    expect(mockStats.lastShape?.width).toBeGreaterThanOrEqual(720);
    expect(mockStats.lastShape?.width).toBeLessThanOrEqual(722);
  });

  it("collapses when focus leaves the island while the cursor is outside, but not while it is inside", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => island.focus());
    await screen.findByRole("tablist");
    expect(useIslandStore.getState().mode).toBe("expanded");
    // Focus moves between elements of the island: stays expanded.
    fireEvent.blur(island, { relatedTarget: screen.getByRole("tab", { name: "Буфер" }) });
    expect(useIslandStore.getState().mode).toBe("expanded");
    // Cursor over the island: the hover machine decides, blur must not collapse.
    act(() => useIslandStore.getState().setHoverInside(true));
    fireEvent.blur(island, { relatedTarget: null });
    expect(useIslandStore.getState().mode).toBe("expanded");
    // Cursor outside + focus leaves → collapse.
    act(() => useIslandStore.getState().setHoverInside(false));
    fireEvent.blur(island, { relatedTarget: document.body });
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("collapsed"));
  });

  it("aria-controls points only at the existing tabpanel (active tab); the panel is focusable and labelled", async () => {
    await mountIsland();
    act(() => mockEmit("island://hover", { inside: true }));
    await screen.findByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      if (tab.getAttribute("aria-selected") === "true") {
        expect(controls).toBe(panel.id);
        expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      } else {
        expect(controls).toBeNull();
      }
    }
    expect(panel).toHaveAttribute("tabindex", "0");
  });

  it("Escape collapses immediately", async () => {
    await mountIsland();
    act(() => mockEmit("island://hover", { inside: true }));
    await screen.findByRole("tablist");
    const tab = screen.getByRole("tab", { name: "Буфер" });
    fireEvent.click(tab);
    fireEvent.keyDown(tab, { key: "Escape" });
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("collapsed"));
  });

  it("uses ig-glass--pill only while collapsed and marks hover before expanding", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    expect(island).toHaveClass("ig-glass", "ig-glass--pill");
    expect(island).toHaveAttribute("data-hover", "false");
    act(() => mockEmit("island://hover", { inside: true }));
    expect(island).toHaveAttribute("data-hover", "true"); // grows immediately, expands after the delay
    await screen.findByRole("tablist");
    expect(island).not.toHaveClass("ig-glass--pill");
    expect(island).toHaveAttribute("data-hover", "false");
  });

  it("shows the «Скопировано» toast in the pill on clipboard://added and hides it later", async () => {
    await mountIsland();
    await waitFor(() => expect(mockListenerCount("clipboard://added")).toBeGreaterThan(0));
    act(() => {
      mockCopy({ kind: "text", text: "hello@example.com" });
    });
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
    expect(screen.getByText("hello@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Скопировано")).toBeNull(), { timeout: 4000 });
  }, 8000);
});
