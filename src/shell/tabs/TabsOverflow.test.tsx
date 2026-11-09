import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../modules/registry";
import type { IslandModule } from "../../shared/types";
import { resetIslandStore, useIslandStore } from "../../store";
import { Tabs } from "../Tabs";
import { useTabsEditStore } from "./store";
import { setLanguage, t } from "../../i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const eight: IslandModule[] = modules;
let available = 400;
beforeEach(() => {
  available = 400;
  const style = document.createElement("style");
  style.dataset.controlTest = "true";
  style.textContent = readFileSync(resolve("src/shell/shell.css"), "utf8");
  document.head.append(style);
  resetIslandStore(); setLanguage("en");
  useIslandStore.getState().setMode("expanded");
  useTabsEditStore.getState().setEditing(false);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => available);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, left: 0, top: 0, right: 650, bottom: 36, width: this.dataset.measuring ? 650 : available, height: 36, toJSON() {} };
  });
});
afterEach(() => { cleanup(); document.querySelector("style[data-control-test]")?.remove(); vi.restoreAllMocks(); resetIslandStore(); useTabsEditStore.getState().setEditing(false); });

it.each(["ru", "en"] as const)("%s: eight tabs show only icons at constrained width, keep titles and restore labels when space permits", language => {
  setLanguage(language);
  const { container } = render(<Tabs modules={eight} active="home" onSelect={() => {}} />);
  expect(screen.getAllByRole("tab")).toHaveLength(8);
  expect(container.querySelector(".ig-tabs-root")).toHaveAttribute("data-icons-only", "true");
  for (const tab of screen.getAllByRole("tab")) {
    expect(tab.getAttribute("title")).toBe(tab.getAttribute("aria-label"));
    expect(getComputedStyle(tab.querySelector(".ig-tab-label")!).display).toBe("none");
  }
  available = 900;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(container.querySelector(".ig-tabs-root")).not.toHaveAttribute("data-icons-only");
  available = 400;
});

it("keeps icon tab selection, Delete, add/reset/done and keyboard reorder available in edit mode", () => {
  const select = vi.fn();
  const { container } = render(<Tabs modules={eight} active="home" onSelect={select} />);
  act(() => useTabsEditStore.getState().setEditing(true));
  expect(container.querySelector(".ig-tabs-root")).toHaveAttribute("data-icons-only", "true");
  expect(screen.getByRole("button", { name: t("reset") })).toBeVisible();
  expect(screen.getByRole("button", { name: t("done") })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: t("control.title") }));
  expect(select).toHaveBeenCalledWith("control");
  expect(screen.getByRole("button", { name: t("tabs.hideNamed", { name: t("control.title") }) })).toBeInTheDocument();
});
