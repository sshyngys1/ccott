import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, mockStats, resetMock } from "../../ipc/mock";
import { t } from "../../i18n";
import { resetIslandStore, useIslandStore } from "../../store";
import { readSettingsSection, saveSettingsSection, SETTINGS_SECTIONS, SETTINGS_SECTION_KEY } from "./sections";
import { SettingsWindow } from "./SettingsWindow";

beforeEach(() => { localStorage.removeItem(SETTINGS_SECTION_KEY); resetMock(); resetIslandStore(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetIslandStore(); });

function openSection(id: typeof SETTINGS_SECTIONS[number]["id"]) {
  const key = SETTINGS_SECTIONS.find(section => section.id === id)!.key;
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: t(key) }));
}

async function mount(language: "ru" | "en" = "ru") {
  await ipc.invoke("settings_set", { patch: { language } });
  const view = render(<SettingsWindow />);
  await waitFor(() => expect(document.documentElement.lang).toBe(language));
  await waitFor(() => expect(mockListenerCount("settings://changed")).toBe(1));
  return view;
}

it.each(["ru", "en"] as const)("%s navigates sections with arrows/Enter, highlights selection and restores it on reopen", async language => {
  const view = await mount(language);
  const nav = screen.getByRole("navigation");
  const buttons = within(nav).getAllByRole("button");
  expect(buttons).toHaveLength(13);
  buttons.forEach(button => expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true"));
  expect(buttons[0]).toHaveAttribute("aria-current", "page");
  fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
  expect(buttons[1]).toHaveFocus();
  expect(buttons[1]).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("radiogroup", { name: t("theme") })).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: t("language.label") })).toBeNull();
  fireEvent.keyDown(buttons[1], { key: "Enter" });
  expect(localStorage.getItem(SETTINGS_SECTION_KEY)).toBe("appearance");
  expect(buttons.filter(button => button.tabIndex === 0)).toEqual([buttons[1]]);
  fireEvent.keyDown(buttons[1], { key: "Home" });
  fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
  expect(buttons[12]).toHaveFocus();
  fireEvent.keyDown(buttons[12], { key: "ArrowDown" });
  expect(buttons[0]).toHaveFocus();
  openSection("capture");
  view.unmount();
  await mount(language);
  expect(within(screen.getByRole("navigation")).getByRole("button", { name: t("settings.section.capture") })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("combobox", { name: t("ocrLanguage.label") })).toBeInTheDocument();
});

it("falls back on unknown storage values and tolerates unavailable localStorage", () => {
  localStorage.setItem(SETTINGS_SECTION_KEY, "removed-section");
  expect(readSettingsSection()).toBe("general");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(readSettingsSection()).toBe("general");
  expect(() => saveSettingsSection("about")).not.toThrow();
});

it("selects Agents when another window requests the saved section", async () => {
  await mount("en");
  saveSettingsSection("agents");
  fireEvent(window, new StorageEvent("storage", { key: SETTINGS_SECTION_KEY, newValue: "agents" }));
  expect(within(screen.getByRole("navigation")).getByRole("button", { name: t("agents.title") })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByRole("heading", { name: t("agents.title") })).toBeInTheDocument();
});

it.each(["ru", "en"] as const)("%s exposes every previous setting in its assigned section", async language => {
  await mount(language);
  // This explicit inventory catches controls lost while moving rows between sections.
  const inventory = {
    general: [["radiogroup", "language.label"], ["switch", "startWithWindows"], ["button", "checkForUpdates"]],
    appearance: [["radiogroup", "theme"], ["switch", "liteMode.label"]],
    island: [["listbox", "monitor"], ["slider", "expandDelay"], ["slider", "collapseDelay"], ["switch", "doNotDisturb"], ["switch", "hideInFullscreenApps"], ["textbox", "addAppExePlaceholder"], ["button", "resetToBrowsers"]],
    hotkeys: [["textbox", "summonTheIsland"], ["textbox", "commandHotkey"]],
    features: [["switch", "settings.feature.clipboard"], ["switch", "settings.feature.text"], ["switch", "settings.feature.notes"], ["switch", "settings.feature.shelf"], ["switch", "settings.feature.dock"], ["switch", "settings.feature.battery"], ["switch", "settings.feature.audioMeter"], ["switch", "control.feature"], ["switch", "downloads.monitor"], ["switch", "settings.feature.weather"], ["switch", "settings.feature.lyrics"]],
    home: [["button", "tiles.reset"]],
    agents: [["heading", "agents.title"]],
    weather: [["combobox", "weather.search"], ["button", "weather.locate"], ["radiogroup", "weather.units"]],
    lyrics: [["switch", "lyrics.settings.search"], ["switch", "lyrics.settings.inPill"], ["switch", "lyrics.settings.announce"], ["slider", "lyrics.settings.offset"]],
    shelf: [["switch", "shelf.keepAfterDrag"], ["combobox", "shelf.retention"]],
    capture: [["combobox", "ocrLanguage.label"]],
    command: [["combobox", "settings.defaultCurrency"]],
    about: [["button", "whatsNew.openFromSettings"]],
  } as const;
  for (const { id } of SETTINGS_SECTIONS) {
    openSection(id);
    const main = within(screen.getByRole("main"));
    for (const [role, key] of inventory[id]) {
      expect(main.getByRole(role, { name: new RegExp(t(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeInTheDocument();
    }
    if (id === "about") expect(main.getByText(t("version", { p0: ipc.APP_VERSION }))).toBeInTheDocument();
  }
});

it.each(["ru", "en"] as const)("renders a complete %s window with browser mock IPC and ordinary focus", async language => {
  await mount(language);
  expect(screen.getByRole("heading", { name: t("settings"), level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: t("settings.sections") })).toBeInTheDocument();
  openSection("features");
  expect(within(screen.getByRole("region", { name: t("settings.features") })).getAllByRole("switch")).toHaveLength(12);
  openSection("hotkeys");
  const hotkey = screen.getByLabelText(t("summonTheIsland"));
  act(() => hotkey.focus());
  fireEvent.click(hotkey);
  fireEvent.keyDown(hotkey, { key: "Escape" });
  expect(hotkey).toHaveValue("Ctrl+Alt+I");
  expect(hotkey).toHaveFocus();
  expect(mockStats.keyboardFocusCalls).toEqual([]);
});

it.each(["ru", "en"] as const)("%s features write disabledFeatures and preserve other disabled ids", async language => {
  await ipc.invoke("settings_set", { patch: { disabledFeatures: ["text"] } });
  await mount(language);
  const spy = vi.spyOn(ipc, "invoke");
  openSection("features");
  const feature = screen.getByRole("switch", { name: t("settings.feature.clipboard") });
  fireEvent.click(feature);
  await waitFor(() => expect(spy).toHaveBeenCalledWith("settings_set", { patch: { disabledFeatures: ["text", "clipboard"] } }));
  await waitFor(async () => expect((await ipc.invoke("settings_get")).disabledFeatures).toEqual(["text", "clipboard"]));
  fireEvent.click(feature);
  await waitFor(async () => expect((await ipc.invoke("settings_get")).disabledFeatures).toEqual(["text"]));
  expect(feature).toBeChecked();
});

it.each(["ru", "en"] as const)("%s searches currency by code/name, saves a selection and clears it with the first option", async language => {
  await ipc.invoke("settings_set", { patch: { defaultCurrency: "USD" } });
  await mount(language);
  const spy = vi.spyOn(ipc, "invoke");
  openSection("command");
  const picker = screen.getByRole("combobox", { name: t("settings.defaultCurrency") });
  fireEvent.change(picker, { target: { value: "kzt" } });
  expect(screen.getAllByRole("option")[0]).toHaveTextContent(t("settings.currencyNone"));
  fireEvent.keyDown(picker, { key: "Enter" });
  await waitFor(() => expect(spy).toHaveBeenCalledWith("settings_set", { patch: { defaultCurrency: "KZT" } }));
  await waitFor(async () => expect((await ipc.invoke("settings_get")).defaultCurrency).toBe("KZT"));
  fireEvent.change(picker, { target: { value: "no currency matches this" } });
  expect(picker).not.toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(picker).toHaveAttribute("aria-expanded", "true");
  expect((await ipc.invoke("settings_get")).defaultCurrency).toBe("KZT");
  fireEvent.change(picker, { target: { value: t("settings.currency.RUB") } });
  expect(within(screen.getByRole("listbox", { name: t("settings.defaultCurrency") })).getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(picker, { key: "Enter" });
  await waitFor(async () => expect((await ipc.invoke("settings_get")).defaultCurrency).toBe("RUB"));
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole("option", { name: t("settings.currencyNone") }));
  await waitFor(async () => expect((await ipc.invoke("settings_get")).defaultCurrency).toBe(""));
});

it.each(["ru", "en"] as const)("%s focuses and scrolls What's New, then restores its trigger on Escape or close", async language => {
  await mount(language);
  const scroll = vi.fn();
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    openSection("about");
    const trigger = screen.getByRole("button", { name: t("whatsNew.openFromSettings") });
    for (const close of ["escape", "button"]) {
      fireEvent.click(trigger);
      const panel = screen.getByRole("region", { name: t("whatsNew.title") }).parentElement!;
      expect(panel).toHaveFocus();
      expect(scroll).toHaveBeenLastCalledWith({ block: "start" });
      if (close === "escape") fireEvent.keyDown(panel, { key: "Escape" });
      else fireEvent.click(screen.getByRole("button", { name: t("whatsNew.gotIt") }));
      expect(screen.queryByRole("region", { name: t("whatsNew.title") })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    }
  } finally {
    HTMLElement.prototype.scrollIntoView = previousScroll;
  }
});

it("follows external theme, language and lite settings and releases event subscriptions on close", async () => {
  const view = await mount();
  act(() => mockEmit("settings://changed", { ...useIslandStore.getState().settings, theme: "light", language: "en", liteMode: true }));
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
  expect(document.documentElement).toHaveAttribute("data-lite", "true");
  expect(document.title).toBe("CCOTT — Settings");
  openSection("features");
  expect(screen.getByRole("region", { name: "Features" })).toBeInTheDocument();
  view.unmount();
  expect(mockListenerCount("settings://changed")).toBe(0);
  expect(mockListenerCount("hotkeys://status")).toBe(0);
  expect(mockListenerCount("updater://available")).toBe(0);
  expect(mockStats.keyboardFocusCalls).toEqual([]);
});
