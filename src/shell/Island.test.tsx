import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mockCopy, mockEmit, mockListenerCount, mockSetMedia, mockStats, resetMock } from "../ipc/mock";
import { DEFAULT_GEOMETRY, hoveredPill } from "../design/geometry";
import { EMPTY_MEDIA } from "../lib/media/progress";
import { useMediaStore } from "../lib/media/store";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { backgroundScreens } from "./preloadScreens";
import { DEFAULT_QUICK_TILES, type TileSlot } from "../shared/types";

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
  it("resizes normal → seven cells → eight cells → normal with cheap glass and exact Rust shapes", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => useIslandStore.getState().setMode("expanded"));
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
    const seven: TileSlot[] = [...DEFAULT_QUICK_TILES, { id: "note", size: "1x1" }];
    const eight: TileSlot[] = [...seven, { id: "timer", size: "1x1" }];
    for (const [tiles, box, resizing] of [
      [seven, DEFAULT_GEOMETRY.panelTall, true],
      [eight, DEFAULT_GEOMETRY.panelTall, false],
      [DEFAULT_QUICK_TILES, DEFAULT_GEOMETRY.panel, true],
      [[], DEFAULT_GEOMETRY.panel, false],
      [DEFAULT_QUICK_TILES, DEFAULT_GEOMETRY.panel, false],
    ] as const) {
      act(() => useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings, quickTiles: [...tiles],
      }));
      if (resizing) expect(island).toHaveAttribute("data-resizing", "true");
      else expect(island).not.toHaveAttribute("data-resizing");
      await waitFor(() => expect(island.style.height).toBe(`${box.height}px`));
      await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
      expect(mockStats.lastShape?.height).toBe(box.height);
      expect(island.querySelector(".hm-tools") === null).toBe(tiles.length === 0);
    }
  });

  it("prewarms a saved tall layout without changing the pill, then expands to its actual height", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [...DEFAULT_QUICK_TILES, { id: "note", size: "2x1" }],
    }));
    act(() => mockEmit("island://prewarm", null));
    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(island.style.height).toBe(`${DEFAULT_GEOMETRY.pill.height}px`);
    act(() => useIslandStore.getState().setMode("expanded"));
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
    expect(island.style.height).toBe(`${DEFAULT_GEOMETRY.panelTall.height}px`);
    expect(mockStats.lastShape?.height).toBe(DEFAULT_GEOMETRY.panelTall.height);
  });
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
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Главная", "Буфер", "Текст", "Заметки", "Полка"]);
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
    expect(useIslandStore.getState().activeTab).toBe("shelf");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Полка" }), { key: "ArrowRight" });
    expect(useIslandStore.getState().activeTab).toBe("home"); // wraps around
  });

  it("releases inactive clipboard images and subscriptions after exit and removes the panel on collapse", async () => {
    mockCopy({ kind: "image", text: "", preview: "data:image/png;base64,AA==", sourceApp: "test.exe" });
    const view = await mountIsland();
    act(() => { useIslandStore.getState().setToast(null); useIslandStore.getState().setMode("expanded"); });
    await screen.findByRole("tablist");
    for (let cycle = 0; cycle < 3; cycle++) {
      act(() => useIslandStore.getState().setActiveTab("clipboard"));
      await waitFor(() => expect(view.container.querySelectorAll("img.ig-thumb")).toHaveLength(2));
      expect(mockListenerCount("clipboard://changed")).toBe(1);
      act(() => useIslandStore.getState().setActiveTab("home"));
      await waitFor(() => expect(view.container.querySelectorAll("img.ig-thumb")).toHaveLength(0));
      await waitFor(() => expect(mockListenerCount("clipboard://changed")).toBe(0));
    }
    act(() => useIslandStore.getState().setMode("collapsed"));
    await waitFor(() => expect(view.container.querySelectorAll(".ig-island-layer--panel")).toHaveLength(0));
    expect(view.container.querySelectorAll(".hm-player, .cb-root")).toHaveLength(0);
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

  it("uses cheap glass from resize start until expand/collapse settles, without rearming for content renders", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    expect(island).not.toHaveAttribute("data-resizing");
    for (const mode of ["expanded", "collapsed"] as const) {
      act(() => useIslandStore.getState().setMode(mode));
      expect(island).toHaveAttribute("data-resizing", "true");
      await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
      const size = mode === "expanded" ? DEFAULT_GEOMETRY.panel : DEFAULT_GEOMETRY.pill;
      expect(island.style.width).toBe(`${size.width}px`);
      expect(island.style.height).toBe(`${size.height}px`);
      act(() => useIslandStore.getState().setView(mode === "expanded" ? "settings" : "tabs"));
      expect(island).not.toHaveAttribute("data-resizing");
    }
  });

  it("uses cheap glass for pill hover growth and shrink, then restores the resting material", async () => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    for (const inside of [true, false]) {
      // Change hover alone, without the hover machine's delayed expansion.
      act(() => useIslandStore.getState().setHoverInside(inside));
      expect(island).toHaveAttribute("data-resizing", "true");
      await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
      const size = inside ? hoveredPill(DEFAULT_GEOMETRY.pill, DEFAULT_GEOMETRY.pillHoverGrow) : DEFAULT_GEOMETRY.pill;
      expect(island.style.width).toBe(`${size.width}px`);
      expect(island.style.borderRadius).toBe(`${size.radius}px`);
    }
  });

  it.each(["collapsed", "expanded"] as const)("clears cheap glass after interrupted transitions ending %s", async (end) => {
    await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(island).toHaveAttribute("data-resizing", "true");
    // Reverse a moving spring, including a return to the original target (A→B→A).
    await new Promise(resolve => setTimeout(resolve, 80));
    act(() => useIslandStore.getState().setMode("collapsed"));
    expect(island).toHaveAttribute("data-resizing", "true");
    if (end === "expanded") {
      await new Promise(resolve => setTimeout(resolve, 40));
      act(() => useIslandStore.getState().setMode("expanded"));
      expect(island).toHaveAttribute("data-resizing", "true");
    }
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"));
    const size = end === "expanded" ? DEFAULT_GEOMETRY.panel : DEFAULT_GEOMETRY.pill;
    expect(island.style.width).toBe(`${size.width}px`);
    expect(island.style.height).toBe(`${size.height}px`);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(island).not.toHaveAttribute("data-resizing");
  });

  it("removes the resize marker when an in-flight island is unmounted", async () => {
    const view = await mountIsland();
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(island).toHaveAttribute("data-resizing", "true");
    view.unmount();
    expect(island).not.toHaveAttribute("data-resizing");
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
