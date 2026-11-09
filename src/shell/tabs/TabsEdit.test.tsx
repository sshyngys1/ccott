import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEOMETRY, panelHeight } from "../../design/geometry";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, mockSetBattery, mockSetMedia, mockStats, resetMock } from "../../ipc/mock";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import { useMediaStore } from "../../lib/media/store";
import { DEFAULT_TAB_ORDER } from "../../shared/types";
import { resetIslandStore, useIslandStore } from "../../store";
import { Island } from "../Island";
import { backgroundScreens } from "../preloadScreens";
import { useTabsEditStore } from "./store";

const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const headerCss = ["src/design/tokens.css", "src/design/glass.css", "src/shell/shell.css"]
  .map((p) => readFileSync(resolve(p), "utf8"))
  .join("\n");

class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init?: PointerEventInit) {
    super(type, init);
    this.pointerId = init?.pointerId ?? 1;
  }
}

/**
 * Simulates W3C Pointer Events §4.2.12.3 pointer capture and click target resolution in jsdom:
 * pending capture becomes active before the next pointer event, pointermove/pointerup are redirected
 * to the active capture target, and click is dispatched to LCA(pointerdown target, pointerup target).
 */
function installPointerCapture() {
  vi.stubGlobal("PointerEvent", FakePointerEvent);
  let pending = new Map<number, Element | null>();
  let active = new Map<number, Element | null>();

  const origSet = HTMLElement.prototype.setPointerCapture;
  const origRelease = HTMLElement.prototype.releasePointerCapture;
  const origHas = HTMLElement.prototype.hasPointerCapture;

  HTMLElement.prototype.setPointerCapture = function (pointerId: number) {
    pending.set(pointerId, this);
  };
  HTMLElement.prototype.releasePointerCapture = function (pointerId: number) {
    const current = pending.has(pointerId) ? pending.get(pointerId) : active.get(pointerId);
    if (current === this) pending.set(pointerId, null);
  };
  HTMLElement.prototype.hasPointerCapture = function (pointerId: number) {
    const current = pending.has(pointerId) ? pending.get(pointerId) : active.get(pointerId);
    return current === this;
  };

  const processPending = (pointerId: number) => {
    if (!pending.has(pointerId)) return;
    const prev = active.get(pointerId) ?? null;
    const next = pending.get(pointerId) ?? null;
    pending.delete(pointerId);
    if (prev === next) return;
    if (prev) fireEvent(prev, new Event("lostpointercapture", { bubbles: true }));
    if (next) {
      active.set(pointerId, next);
      fireEvent(next, new Event("gotpointercapture", { bubbles: true }));
    } else {
      active.delete(pointerId);
    }
  };

  const lowestCommonAncestor = (a: Element, b: Element): Element => {
    for (let cur: Element | null = a; cur; cur = cur.parentElement) {
      if (cur.contains(b)) return cur;
    }
    return document.documentElement;
  };

  const pointerSequence = (
    downTarget: Element,
    options: {
      pointerId?: number;
      start?: { x: number; y: number };
      moves?: Array<{ x: number; y: number; hitTarget?: Element }>;
      upHitTarget?: Element;
    } = {},
  ) => {
    const pointerId = options.pointerId ?? 1;
    const start = options.start ?? { x: 24, y: 16 };
    const moves = options.moves ?? [];
    const last = moves.length > 0 ? moves[moves.length - 1] : start;

    processPending(pointerId);
    fireEvent.pointerDown(downTarget, {
      button: 0,
      buttons: 1,
      pointerId,
      clientX: start.x,
      clientY: start.y,
    });

    for (const m of moves) {
      processPending(pointerId);
      const moveTarget = active.get(pointerId) ?? m.hitTarget ?? downTarget;
      fireEvent.pointerMove(moveTarget, {
        button: -1,
        buttons: 1,
        pointerId,
        clientX: m.x,
        clientY: m.y,
      });
    }

    processPending(pointerId);
    const upTarget = active.get(pointerId) ?? options.upHitTarget ?? downTarget;
    fireEvent.pointerUp(upTarget, {
      button: 0,
      buttons: 0,
      pointerId,
      clientX: last.x,
      clientY: last.y,
    });

    pending.set(pointerId, null);
    processPending(pointerId);

    const clickTarget = lowestCommonAncestor(downTarget, upTarget);
    fireEvent.click(clickTarget, {
      button: 0,
      clientX: last.x,
      clientY: last.y,
    });
  };

  const restore = () => {
    pending = new Map();
    active = new Map();
    HTMLElement.prototype.setPointerCapture = origSet;
    HTMLElement.prototype.releasePointerCapture = origRelease;
    HTMLElement.prototype.hasPointerCapture = origHas;
  };

  return { pointerSequence, restore };
}

beforeAll(async () => {
  await Promise.all(backgroundScreens.map((s) => s.preload()));
});

beforeEach(() => {
  resetMock();
  mockSetMedia({ hasSession: false, status: "stopped" });
  useMediaStore.getState().applyState(EMPTY_MEDIA);
  resetIslandStore();
});

afterEach(() => {
  cleanup();
  resetIslandStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

async function mountExpandedIsland() {
  const utils = render(<Island />);
  await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
  act(() => mockEmit("island://hover", { inside: true }));
  await screen.findByRole("region", { name: "Dynamic Island" });
  await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"));
  return utils;
}

describe("Tab edit mode (§23)", () => {
  it.each(["ru", "en"] as const)(
    "%s: opens via right-click menu on tab strip and exits on Done or Escape",
    async (lang) => {
      setLanguage(lang);
      await mountExpandedIsland();
      const tablist = await screen.findByRole("tablist", { name: t("islandTabs") });

      fireEvent.contextMenu(tablist, { clientX: 80, clientY: 24 });
      const menuItem = await screen.findByRole("menuitem", { name: t("tabs.customizeAction") });
      expect(useTabsEditStore.getState().menuOpen).toBe(true);

      // First Escape closes the context menu without collapsing the island
      fireEvent.keyDown(menuItem, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(useIslandStore.getState().mode).toBe("expanded");
      expect(useTabsEditStore.getState().editing).toBe(false);

      // Enter edit mode via menu item
      fireEvent.contextMenu(tablist, { clientX: 80, clientY: 24 });
      fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
      expect(useTabsEditStore.getState().editing).toBe(true);

      // Escape exits edit mode without collapsing the island
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTabsEditStore.getState().editing).toBe(false);
      expect(useIslandStore.getState().mode).toBe("expanded");

      // Re-enter and exit via Done button
      fireEvent.contextMenu(screen.getByRole("tablist", { name: t("islandTabs") }));
      fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
      expect(useTabsEditStore.getState().editing).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: t("done") }));
      expect(useTabsEditStore.getState().editing).toBe(false);
    },
  );

  it("hides tabs via × (except Home), switches active tab to Home, restores via +, and resets", async () => {
    const spy = vi.spyOn(ipc, "invoke");
    await mountExpandedIsland();

    // Activate Notes first
    fireEvent.click(screen.getByRole("tab", { name: "Заметки" }));
    expect(useIslandStore.getState().activeTab).toBe("notes");

    // Disable dock as a non-tab feature to ensure Reset preserves it
    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: ["dock"],
      });
    });

    // Enter edit mode
    fireEvent.contextMenu(screen.getByRole("tablist"));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));

    // Home has no × remove button
    expect(screen.queryByRole("button", { name: t("tabs.hideNamed", { name: "Главная" }) })).toBeNull();
    // + button is not rendered while all tab features are enabled
    expect(screen.queryByRole("button", { name: t("tabs.add") })).toBeNull();

    // Hide active Notes tab via ×
    fireEvent.click(screen.getByRole("button", { name: t("tabs.hideNamed", { name: "Заметки" }) }));
    await waitFor(() =>
      expect(useIslandStore.getState().settings.disabledFeatures).toEqual(["dock", "notes"]),
    );
    expect(spy).toHaveBeenCalledWith("settings_set", {
      patch: { disabledFeatures: ["dock", "notes"] },
    });
    // Active tab switched to Home
    expect(useIslandStore.getState().activeTab).toBe("home");
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Заметки" })).toBeNull());

    // + button now appears; Escape closes its menu before exiting edit mode
    const addBtn = screen.getByRole("button", { name: t("tabs.add") });
    fireEvent.click(addBtn);
    const addNotesItem = await screen.findByRole("menuitem", { name: "Заметки" });
    fireEvent.keyDown(addNotesItem, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useTabsEditStore.getState().editing).toBe(true);

    // Re-open + menu and restore Notes
    fireEvent.click(addBtn);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Заметки" }));
    await waitFor(() =>
      expect(useIslandStore.getState().settings.disabledFeatures).toEqual(["dock"]),
    );
    expect(await screen.findByRole("tab", { name: "Заметки" })).toBeInTheDocument();

    // Hide two tabs and reorder, then Reset
    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        tabOrder: ["shelf", "home", "clipboard", "text", "notes"],
        disabledFeatures: ["dock", "clipboard", "text"],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: t("reset") }));
    await waitFor(() => {
      expect(useIslandStore.getState().settings.tabOrder).toEqual([...DEFAULT_TAB_ORDER]);
      expect(useIslandStore.getState().settings.disabledFeatures).toEqual(["dock"]);
    });
  });

  it("supports keyboard navigation, Alt+Arrow reordering, and Delete to hide", async () => {
    await mountExpandedIsland();
    fireEvent.contextMenu(screen.getByRole("tablist"));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));

    const homeTab = screen.getByRole("tab", { name: "Главная" });
    act(() => homeTab.focus());

    // Alt+ArrowRight moves Home after Clipboard
    fireEvent.keyDown(homeTab, { key: "ArrowRight", altKey: true });
    await waitFor(() =>
      expect(useIslandStore.getState().settings.tabOrder).toEqual([
        "clipboard",
        "home",
        "text",
        "notes",
        "shelf",
        "weather", "control", "agents",
      ]),
    );

    // ArrowLeft moves focus/selection to Clipboard (now first)
    fireEvent.keyDown(screen.getByRole("tab", { name: "Главная" }), { key: "ArrowLeft" });
    expect(useIslandStore.getState().activeTab).toBe("clipboard");
    expect(screen.getByRole("tab", { name: "Буфер" })).toHaveFocus();

    // Delete on Clipboard hides it
    fireEvent.keyDown(screen.getByRole("tab", { name: "Буфер" }), { key: "Delete" });
    await waitFor(() =>
      expect(useIslandStore.getState().settings.disabledFeatures).toContain("clipboard"),
    );
    expect(useIslandStore.getState().activeTab).toBe("home");
  });

  it("holds the island open when the cursor leaves during tab edit mode", async () => {
    await mountExpandedIsland();
    const tablist = screen.getByRole("tablist");
    fireEvent.contextMenu(tablist);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
    expect(useTabsEditStore.getState().editing).toBe(true);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Главная" })).toHaveFocus());

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // Cursor leaves the island and collapse delay elapses
      act(() => mockEmit("island://hover", { inside: false }));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(useIslandStore.getState().mode).toBe("expanded");

      // Exiting edit mode while cursor is outside allows normal hover collapse
      fireEvent.click(screen.getByRole("button", { name: t("done") }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useIslandStore.getState().mode).toBe("collapsed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the tab strip when only 1 tab is visible, shrinks header height, and still allows right-click customize", async () => {
    const { container } = render(<Island />);
    await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    act(() => useIslandStore.getState().setMode("expanded"));
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"), { timeout: 2000 });
    const compactHeight = panelHeight(DEFAULT_GEOMETRY, { dock: true, tabBar: false, tall: false });

    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: ["clipboard", "text", "notes", "shelf", "weather", "control", "agents"],
      });
    });

    // Tab strip is not rendered when only Home is visible; header switches to compact mode and panel shrinks smoothly
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(container.querySelector(".ig-panel")).toHaveAttribute("data-compact-head", "true");
    expect(island).toHaveAttribute("data-resizing", "true");
    await waitFor(() => expect(island.style.height).toBe(`${compactHeight}px`));
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"), { timeout: 2000 });
    expect(mockStats.lastShape?.height).toBe(compactHeight);
    // Tabpanel uses aria-label instead of dangling aria-labelledby
    const panel = within(container).getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-label", "Главная");
    expect(panel).not.toHaveAttribute("aria-labelledby");

    // User can still right-click the header slot to customize and re-enable tabs (panel restores full header height)
    const slot = container.querySelector(".ig-tabbar-slot")!;
    expect(slot).not.toBeNull();
    fireEvent.contextMenu(slot, { clientX: 60, clientY: 20 });
    fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("tabs.add") })).toBeInTheDocument();
    await waitFor(() => expect(island.style.height).toBe(`${DEFAULT_GEOMETRY.panel.height}px`));
    await waitFor(() => expect(island).not.toHaveAttribute("data-resizing"), { timeout: 2000 });
    expect(mockStats.lastShape?.height).toBe(DEFAULT_GEOMETRY.panel.height);
  });

  it("selects a tab on short pointer click in edit mode with pointer capture, while drag writes tabOrder and × hides", async () => {
    const capture = installPointerCapture();
    const spy = vi.spyOn(ipc, "invoke");
    try {
      const { container } = render(<Island />);
      await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
      act(() => useIslandStore.getState().setMode("expanded"));
      expect(useIslandStore.getState().activeTab).toBe("home");

      // Enter edit mode from tab strip right-click menu
      const tablist = await screen.findByRole("tablist", { name: t("islandTabs") });
      fireEvent.contextMenu(tablist, { clientX: 80, clientY: 20 });
      fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
      expect(useTabsEditStore.getState().editing).toBe(true);
      expect(useIslandStore.getState().activeTab).toBe("home");

      // Short pointer click (pointerdown -> pointerup -> click with capture) on «Текст» selects «Текст»
      const textTab = screen.getByRole("tab", { name: "Текст" });
      capture.pointerSequence(within(textTab).getByText("Текст"), {
        start: { x: 140, y: 18 },
      });
      expect(useIslandStore.getState().activeTab).toBe("text");
      expect(textTab).toHaveAttribute("aria-selected", "true");
      expect(spy).not.toHaveBeenCalledWith("settings_set", expect.anything());

      // Pointer drag (pointerdown -> pointermove -> pointerup -> click with capture) writes tabOrder without switching active tab
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => container.querySelector<HTMLElement>('[data-tab-id="notes"]'),
      });
      const homeTab = screen.getByRole("tab", { name: "Главная" });
      capture.pointerSequence(within(homeTab).getByText("Главная"), {
        start: { x: 24, y: 18 },
        moves: [{ x: 215, y: 18 }],
      });
      await waitFor(() =>
        expect(useIslandStore.getState().settings.tabOrder).toEqual([
          "clipboard",
          "text",
          "notes",
          "home",
          "shelf",
          "weather", "control", "agents",
        ]),
      );
      expect(spy).toHaveBeenCalledWith("settings_set", {
        patch: { tabOrder: ["clipboard", "text", "notes", "home", "shelf", "weather", "control", "agents"] },
      });
      expect(useIslandStore.getState().activeTab).toBe("text");

      // Full pointer click on «×» still hides the tab (inactive «Полка» keeps «Текст» active; active «Текст» returns to «Главная»)
      const hideShelfBtn = screen.getByRole("button", {
        name: t("tabs.hideNamed", { name: "Полка" }),
      });
      capture.pointerSequence(hideShelfBtn, { start: { x: 310, y: 18 } });
      await waitFor(() =>
        expect(useIslandStore.getState().settings.disabledFeatures).toEqual(["shelf"]),
      );
      expect(useIslandStore.getState().activeTab).toBe("text");

      const hideTextBtn = screen.getByRole("button", {
        name: t("tabs.hideNamed", { name: "Текст" }),
      });
      capture.pointerSequence(hideTextBtn, { start: { x: 155, y: 18 } });
      await waitFor(() =>
        expect(useIslandStore.getState().settings.disabledFeatures).toEqual(["shelf", "text"]),
      );
      expect(useIslandStore.getState().activeTab).toBe("home");
    } finally {
      capture.restore();
    }
  });

  it(
    "keeps Settings gear and Collapse buttons visible and functional in header during edit mode while hiding only clock and battery",
    async () => {
      MotionGlobalConfig.skipAnimations = true;
      mockSetBattery({
        hasBattery: true,
        percent: 78,
        charging: false,
        acConnected: false,
        saver: false,
        remainingSeconds: 5400,
      });

      try {
        useIslandStore.getState().setMode("expanded");
        const { container } = render(<Island />);
        await waitFor(() => expect(container.querySelector(".ig-head-battery")).not.toBeNull());

        const header = container.querySelector<HTMLElement>(".ig-panel-head")!;

        // Enter tab edit mode
        fireEvent.contextMenu(within(header).getByRole("tablist"));
        fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
        expect(useTabsEditStore.getState().editing).toBe(true);
        expect(header).toHaveAttribute("data-editing-tabs", "true");

        // Only clock and battery are hidden via CSS; right container, gear, and collapse stay visible
        const right = header.querySelector<HTMLElement>(".ig-panel-head-right")!;
        const clock = header.querySelector<HTMLElement>(".ig-head-clock")!;
        const battery = header.querySelector<HTMLElement>(".ig-head-battery")!;
        const settingsBtn = within(header).getByRole("button", { name: t("settings") });
        const collapseBtn = within(header).getByRole("button", { name: t("collapse") });

        const style = document.createElement("style");
        style.textContent = headerCss;
        document.head.appendChild(style);
        try {
          expect(getComputedStyle(right).display).not.toBe("none");
          expect(getComputedStyle(settingsBtn).display).not.toBe("none");
          expect(getComputedStyle(collapseBtn).display).not.toBe("none");
          expect(getComputedStyle(clock).display).toBe("none");
          expect(getComputedStyle(battery).display).toBe("none");
        } finally {
          style.remove();
        }

        // Clicking Settings gear opens the separate settings window (§25), collapses the island and exits tab edit mode
        const invokeSpy = vi.spyOn(ipc, "invoke");
        fireEvent.click(settingsBtn);
        await waitFor(() => expect(invokeSpy).toHaveBeenCalledWith("settings_window_open"));
        expect(useIslandStore.getState().mode).toBe("collapsed");
        expect(useTabsEditStore.getState().editing).toBe(false);

        // Expand again, re-enter edit mode, and verify Collapse button collapses the island
        act(() => {
          mockEmit("island://summoned", null);
        });
        await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"));
        const tablist = await screen.findByRole("tablist", { name: t("islandTabs") });
        fireEvent.contextMenu(tablist);
        fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
        expect(useTabsEditStore.getState().editing).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: t("collapse") }));
        expect(useIslandStore.getState().mode).toBe("collapsed");
        expect(useTabsEditStore.getState().editing).toBe(false);
      } finally {
        MotionGlobalConfig.skipAnimations = false;
      }
    },
    15_000,
  );
});
