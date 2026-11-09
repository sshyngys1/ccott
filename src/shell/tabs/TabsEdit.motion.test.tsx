import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { modules as registry } from "../../modules/registry";
import { DEFAULT_TAB_ORDER } from "../../shared/types";
import { resetIslandStore, useIslandStore } from "../../store";
import { Tabs } from "../Tabs";
import { orderVisibleTabs } from "./order";
import { useTabsEditStore } from "./store";

const preference = vi.hoisted(() => ({ reduce: false }));
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

vi.mock("motion/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("motion/react")>();
  const { createElement, forwardRef } = await import("react");
  const cache = new Map();
  const motion = new Proxy(original.motion, {
    get(target, key) {
      if (!cache.has(key)) {
        const Component = Reflect.get(target, key);
        cache.set(
          key,
          forwardRef((props: Record<string, unknown>, ref) =>
            createElement(Component, {
              ...props,
              ref,
              "data-test-layout": props.layout ? String(props.layout) : undefined,
              "data-test-while-tap": props.whileTap ? JSON.stringify(props.whileTap) : undefined,
            }),
          ),
        );
      }
      return cache.get(key);
    },
  });
  return { ...original, motion, useReducedMotion: () => preference.reduce };
});

function Host() {
  const activeTab = useIslandStore((s) => s.activeTab);
  const setActiveTab = useIslandStore((s) => s.setActiveTab);
  const tabOrder = useIslandStore((s) => s.settings.tabOrder);
  const disabledFeatures = useIslandStore((s) => s.settings.disabledFeatures);
  const visible = orderVisibleTabs(registry, tabOrder, disabledFeatures);
  return (
    <div className="ig-panel">
      <Tabs modules={visible} allModules={registry} active={activeTab} onSelect={setActiveTab} />
    </div>
  );
}

beforeEach(() => {
  resetMock();
  resetIslandStore();
  useIslandStore.getState().setMode("expanded");
  useTabsEditStore.setState({ editing: true });
  preference.reduce = false;
});

afterEach(() => {
  cleanup();
  resetIslandStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

it.each([false, true])(
  "pointer drag keeps hit-test order stable until pointerup and never uses HTML5 drag (lite=%s)",
  async (liteMode) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      liteMode,
    });
    const { container } = render(<Host />);
    const entries = () => Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
    const order = () => entries().map((el) => el.dataset.tabId);
    expect(entries().every((el) => !el.hasAttribute("draggable"))).toBe(true);

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => entries()[2],
    });
    const source = entries()[0];
    const sourceTab = source.querySelector<HTMLButtonElement>('[role="tab"]')!;
    const spy = vi.spyOn(ipc, "invoke");

    fireEvent.pointerDown(sourceTab, { button: 0, clientX: 10, clientY: 10 });
    for (let move = 0; move < 4; move++) {
      fireEvent.pointerMove(sourceTab, { clientX: 90 + move, clientY: 10 });
      expect(order()).toEqual(["home", "clipboard", "text", "notes", "shelf", "weather", "control", "agents"]);
      expect(entries()[2]).toHaveAttribute("data-drop-target", "true");
      expect(source).toHaveAttribute("data-reordering", "true");
      expect(spy).not.toHaveBeenCalledWith("settings_set", expect.anything());
    }
    fireEvent.pointerUp(sourceTab);

    await waitFor(() =>
      expect(order()).toEqual(["clipboard", "text", "home", "notes", "shelf", "weather", "control", "agents"]),
    );
    expect(spy).toHaveBeenCalledWith("settings_set", {
      patch: { tabOrder: ["clipboard", "text", "home", "notes", "shelf", "weather", "control", "agents"] },
    });
    expect(container.querySelector('[data-drop-target="true"], [data-reordering="true"]')).toBeNull();
  },
);

it.each(["lite", "reduced", "collapsed"])(
  "disables tab layout animation opt-in for %s",
  (setting) => {
    const { container, rerender } = render(<Host />);
    expect(container.querySelectorAll("[data-test-layout]")).toHaveLength(8);
    act(() => {
      if (setting === "lite") {
        useIslandStore.getState().applySettings({
          ...useIslandStore.getState().settings,
          liteMode: true,
        });
      }
      if (setting === "reduced") {
        preference.reduce = true;
        rerender(<Host />);
      }
      if (setting === "collapsed") {
        useIslandStore.getState().setMode("collapsed");
      }
    });
    expect(container.querySelectorAll("[data-test-layout]")).toHaveLength(0);
  },
);

it("projects layout='position' only on one level of .ig-tab-entry and forbids scale or shadow transitions including portal menu", async () => {
  const style = document.createElement("style");
  style.textContent = [
    "src/design/tokens.css",
    "src/design/glass.css",
    "src/modules/home/home.css",
    "src/shell/shell.css",
  ]
    .map((p) => readFileSync(resolve(p), "utf8"))
    .join("\n");
  document.head.appendChild(style);

  try {
    const { container } = render(<Host />);
    const layoutNodes = container.querySelectorAll("[data-test-layout]");
    expect(layoutNodes).toHaveLength(8);
    for (const node of layoutNodes) {
      expect(node).toHaveAttribute("data-test-layout", "position");
      expect(node.matches(".ig-tab-entry")).toBe(true);
      expect(node.querySelector("[data-test-layout]")).toBeNull();
    }
    expect(container.querySelectorAll("[data-test-while-tap]")).toHaveLength(0);

    // Sanity check: an ordinary .ig-glass-control outside .ig-tabs-root / .ig-tabs-menu keeps Designer's press scale
    const outsideBtn = document.createElement("button");
    outsideBtn.className = "ig-glass-control";
    outsideBtn.setAttribute("data-pressed", "true");
    container.querySelector(".ig-panel")!.appendChild(outsideBtn);
    expect(getComputedStyle(outsideBtn).transform).toContain("scale");
    outsideBtn.remove();

    // Controls inside .ig-tabs-root must have transform: none and no box-shadow transition even when pressed
    for (const btn of container.querySelectorAll<HTMLElement>(".ig-tabs-root .ig-glass-control")) {
      btn.setAttribute("data-pressed", "true");
      const cs = getComputedStyle(btn);
      expect(cs.transform).toBe("none");
      expect(cs.transition).not.toMatch(/box-shadow|scale|transform|filter|backdrop-filter/);
      btn.removeAttribute("data-pressed");
    }

    // Open the "+" add-tab portal menu (rendered in .ig-panel outside .ig-tabs-root)
    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: ["notes"],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: t("tabs.add") }));
    const addMenu = await screen.findByRole("menu");
    const tabsRoot = container.querySelector(".ig-tabs-root")!;
    const panel = container.querySelector(".ig-panel")!;
    expect(panel.contains(addMenu)).toBe(true);
    expect(tabsRoot.contains(addMenu)).toBe(false);
    expect(addMenu).toHaveClass("ig-tabs-menu");

    const addItem = screen.getByRole("menuitem", { name: "Заметки" });
    expect(getComputedStyle(addItem).transform).toBe("none");
    expect(getComputedStyle(addItem).transition).not.toMatch(
      /box-shadow|scale|transform|filter|backdrop-filter/,
    );
    addItem.setAttribute("data-pressed", "true");
    expect(getComputedStyle(addItem).transform).toBe("none");
    expect(getComputedStyle(addItem).transition).not.toMatch(
      /box-shadow|scale|transform|filter|backdrop-filter/,
    );

    // Exit edit mode and open right-click context menu portal -> same class & style guarantees
    act(() => useTabsEditStore.getState().setEditing(false));
    fireEvent.contextMenu(screen.getByRole("tablist"), { clientX: 40, clientY: 16 });
    const ctxMenu = await screen.findByRole("menu");
    expect(panel.contains(ctxMenu)).toBe(true);
    expect(tabsRoot.contains(ctxMenu)).toBe(false);
    expect(ctxMenu).toHaveClass("ig-tabs-menu");
    const ctxItem = screen.getByRole("menuitem", { name: t("tabs.customizeAction") });
    ctxItem.setAttribute("data-pressed", "true");
    expect(getComputedStyle(ctxItem).transform).toBe("none");
    expect(getComputedStyle(ctxItem).transition).not.toMatch(
      /box-shadow|scale|transform|filter|backdrop-filter/,
    );

    const tabsSource = readFileSync(resolve("src/shell/Tabs.tsx"), "utf8");
    expect(tabsSource).not.toMatch(/\bscale\b/);
    const shellCss = readFileSync(resolve("src/shell/shell.css"), "utf8");
    const tabSection = shellCss.split("/* ── Tab customize mode")[1] ?? "";
    expect(tabSection).toContain(".ig-tabs-menu .ig-glass-control");
    expect(tabSection).not.toMatch(/scale\s*\(/);
    expect(tabSection).not.toMatch(/transition:[^;]*(?:box-shadow|filter|backdrop-filter)/);
  } finally {
    style.remove();
  }
});

it("cancels active pointer drag on Escape so re-entering edit mode and firing pointerup without pointerdown writes nothing", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const { container } = render(<Host />);
  const entries = () => Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => entries()[2], // "text"
  });

  const source = entries()[0]; // "home"
  const sourceTab = source.querySelector<HTMLButtonElement>('[role="tab"]')!;
  const releaseCapture = vi.fn();
  sourceTab.setPointerCapture = vi.fn();
  sourceTab.hasPointerCapture = vi.fn(() => true);
  sourceTab.releasePointerCapture = releaseCapture;

  const spy = vi.spyOn(ipc, "invoke");

  // Start dragging Home onto Text
  fireEvent.pointerDown(sourceTab, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(sourceTab, { clientX: 95, clientY: 10 });
  expect(source).toHaveAttribute("data-reordering", "true");
  expect(entries()[2]).toHaveAttribute("data-drop-target", "true");

  // Press Escape mid-drag -> exits edit mode, releases capture, clears gesture & highlights
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useTabsEditStore.getState().editing).toBe(false);
  expect(releaseCapture).toHaveBeenCalledTimes(1);

  // Re-enter edit mode via context menu «Изменить вкладки»
  fireEvent.contextMenu(screen.getByRole("tablist"), { clientX: 40, clientY: 16 });
  fireEvent.click(await screen.findByRole("menuitem", { name: t("tabs.customizeAction") }));
  expect(useTabsEditStore.getState().editing).toBe(true);
  expect(container.querySelector('[data-reordering="true"], [data-drop-target="true"]')).toBeNull();

  // Orphan pointerup without a new pointerdown must NOT save stale reorder
  fireEvent.pointerUp(screen.getByRole("tab", { name: "Главная" }));
  fireEvent.pointerUp(screen.getByRole("tab", { name: "Текст" }));
  expect(spy).not.toHaveBeenCalledWith("settings_set", expect.anything());
  expect(useIslandStore.getState().settings.tabOrder).toEqual([...DEFAULT_TAB_ORDER]);

  // Click suppression was cleared as well -> clicking a tab selects it normally
  fireEvent.click(screen.getByRole("tab", { name: "Текст" }));
  expect(useIslandStore.getState().activeTab).toBe("text");
});

it.each(["done", "view", "collapse", "lostpointercapture"] as const)(
  "cancels active pointer drag on %s and clears state/capture",
  (trigger) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { container } = render(<Host />);
    const entries = () => Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => entries()[2],
    });

    const source = entries()[0];
    const sourceTab = source.querySelector<HTMLButtonElement>('[role="tab"]')!;
    const releaseCapture = vi.fn();
    sourceTab.setPointerCapture = vi.fn();
    sourceTab.hasPointerCapture = vi.fn(() => true);
    sourceTab.releasePointerCapture = releaseCapture;

    const spy = vi.spyOn(ipc, "invoke");

    fireEvent.pointerDown(sourceTab, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourceTab, { clientX: 95, clientY: 10 });
    expect(source).toHaveAttribute("data-reordering", "true");
    expect(entries()[2]).toHaveAttribute("data-drop-target", "true");

    act(() => {
      if (trigger === "done") {
        fireEvent.click(screen.getByRole("button", { name: t("done") }));
      } else if (trigger === "view") {
        useIslandStore.getState().setView("whatsNew");
      } else if (trigger === "collapse") {
        useIslandStore.getState().setMode("collapsed");
      } else {
        fireEvent(sourceTab, new Event("lostpointercapture", { bubbles: true }));
      }
    });

    expect(releaseCapture).toHaveBeenCalled();

    // Restore expanded tabs edit mode to verify no stale highlight or gesture survived
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("tabs");
      useTabsEditStore.getState().setEditing(true);
    });
    expect(container.querySelector('[data-reordering="true"], [data-drop-target="true"]')).toBeNull();
    fireEvent.pointerUp(screen.getByRole("tab", { name: "Главная" }));
    expect(spy).not.toHaveBeenCalledWith("settings_set", expect.anything());
    expect(useIslandStore.getState().settings.tabOrder).toEqual([...DEFAULT_TAB_ORDER]);
  },
);
