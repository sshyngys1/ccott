import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, invoke, listen } from "../../ipc";
import {
  mockConfig,
  mockHotkeysStartup,
  mockEmit,
  mockListenerCount,
  mockSetFullscreenApps,
  mockSetMaximizedApps,
  mockSetUpdate,
  mockStats,
  resetMock,
} from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import { useLiteSync, useSettingsSync } from "../useShellSync";
import { DEFAULT_AUTO_HIDE_APPS } from "./hotkey";
import { DEFAULT_QUICK_TILES } from "../../shared/types";
import { useTilesEditStore } from "../../lib/tiles/store";
import { SettingsView } from "./SettingsView";
import { MonitorPicker } from "./MonitorPicker";

/** The view plus the shell's store↔backend sync, as inside the Island. */
function Harness() {
  useSettingsSync();
  useLiteSync();
  return <SettingsView />;
}

beforeEach(async () => {
  resetMock();
  resetIslandStore();
  useIslandStore.getState().applySettings(await invoke("settings_get"));
});

afterEach(() => {
  cleanup();
  resetIslandStore();
});

const backend = () => invoke("settings_get");

describe("SettingsView", () => {
  it("stacks the two columns independently and preserves section labels and DOM/Tab order", () => {
    const { container } = render(<SettingsView />);
    const columns = container.querySelector(".ig-settings-columns")!;
    const labels = (elements: Iterable<Element>) => [...elements].map(el => el.getAttribute("aria-labelledby"));
    expect(labels(columns.querySelectorAll(":scope > .ig-settings-column--left")))
      .toEqual(["ig-set-look", "ig-set-tiles"]);
    const right = columns.querySelectorAll(":scope > .ig-settings-column--right");
    expect(right).toHaveLength(1);
    expect(labels(right[0].children)).toEqual(["ig-set-behaviour", "ig-set-shelf"]);
    const sections = container.querySelectorAll("section");
    const order = ["ig-set-look", "ig-set-behaviour", "ig-set-shelf", "ig-set-tiles", "ig-set-fullscreen", "ig-set-autohide"];
    expect(labels(sections)).toEqual(order);
    for (const section of sections) {
      expect(section).toHaveAccessibleName(section.querySelector("h4")!.textContent!);
    }
    // Tab still follows the original sections; no positive tabindex or new stops on wrappers.
    const stops = [...container.querySelectorAll<HTMLElement>('button, input, select, [tabindex]')]
      .filter(el => el.tabIndex >= 0 && !el.matches(":disabled"));
    expect([...new Set(stops.map(el => el.closest("section")?.getAttribute("aria-labelledby")))])
      .toEqual(order);
    expect(stops.every(el => el.tabIndex === 0)).toBe(true);
    expect(labels(container.querySelectorAll(".ig-settings > .ig-settings-card--wide")))
      .toEqual(["ig-set-fullscreen", "ig-set-autohide"]);
  });

  it.each(["ru", "en"] as const)("%s keeps shelf retention native, labelled, styled and persistent", async (language) => {
    await invoke("settings_set", { patch: { language } });
    useIslandStore.getState().applySettings(await backend());
    const view = render(<SettingsView />);
    const label = language === "ru" ? "Хранить на полке" : "Keep on shelf for";
    const select = screen.getByLabelText(label);
    expect(select.tagName).toBe("SELECT");
    expect(select.parentElement).toHaveClass("ig-select");
    expect(within(select).getAllByRole("option")).toHaveLength(5);
    fireEvent.change(select, { target: { value: "72" } });
    await waitFor(async () => expect((await backend()).shelfRetentionHours).toBe(72));
    view.unmount();
    render(<SettingsView />);
    expect(screen.getByLabelText(label)).toHaveValue("72");
  });

  it.each(["ru", "en"] as const)("%s shows busy for both fields, saves a replacement, and restores rejected command input", async (language) => {
    await invoke("settings_set", { patch: { language } });
    mockHotkeysStartup(["Ctrl+Alt+I", "Ctrl+Shift+X", "Ctrl+Alt+Z"], { commandHotkey: "Ctrl+Shift+X" });
    useIslandStore.getState().applySettings(await backend());
    const hint = language === "ru" ? "Занято другим приложением — выберите другое" : "Used by another app — choose another shortcut";
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getAllByText(hint)).toHaveLength(2));
    const input = screen.getByLabelText(language === "ru" ? "Командная строка" : "Command bar");
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "z", code: "KeyZ", ctrlKey: true, altKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(language === "ru" ? /занято/ : /register/);
    expect(input).toHaveValue("Ctrl+Shift+X");
    expect((await backend()).commandHotkey).toBe("Ctrl+Shift+X");
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    await waitFor(async () => expect((await backend()).commandHotkey).toBe("Ctrl+Alt+K"));
    await waitFor(() => expect(screen.getAllByText(hint)).toHaveLength(1));
    expect(input).toHaveValue("Ctrl+Alt+K");
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount(); render(<Harness />);
    expect(screen.getByLabelText(language === "ru" ? "Командная строка" : "Command bar")).toHaveValue("Ctrl+Alt+K");
  });
  it.each([["ru", "Следить за загрузками"], ["en", "Monitor downloads"]] as const)("%s saves downloads monitoring and restores the switch on reopen", async (language, label) => {
    await invoke("settings_set", { patch: { language } });
    useIslandStore.getState().applySettings(await backend());
    const view = render(<Harness />);
    expect(screen.getByRole("switch", { name: label })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: label }));
    await waitFor(async () => expect((await backend()).downloadsMonitor).toBe(false));
    expect(screen.getByRole("switch", { name: label })).not.toBeChecked();
    view.unmount();
    render(<Harness />);
    expect(screen.getByRole("switch", { name: label })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: label }));
    await waitFor(async () => expect((await backend()).downloadsMonitor).toBe(true));
  });
  it.each([
    ["ru", "Лёгкий режим", "Отключает эффекты стекла"],
    ["en", "Lite mode", "Disables glass effects"],
  ] as const)("%s saves lite mode, applies events immediately and restores it on reopen", async (language, label, hint) => {
    await invoke("settings_set", { patch: { language } });
    useIslandStore.getState().applySettings(await backend());
    const view = render(<Harness />);
    const toggle = screen.getByRole("switch", { name: new RegExp(label) });
    expect(toggle.closest("section")).toHaveAccessibleName(language === "ru" ? "Внешний вид" : "Appearance");
    expect(screen.getByText(new RegExp(hint))).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-lite", "false"));
    fireEvent.click(toggle);
    await waitFor(async () => expect((await backend()).liteMode).toBe(true));
    expect(document.documentElement).toHaveAttribute("data-lite", "true");
    view.unmount();
    render(<Harness />);
    expect(screen.getByRole("switch", { name: new RegExp(label) })).toBeChecked();
    await waitFor(() => expect(mockListenerCount("settings://changed")).toBe(1));
    // An external settings event updates the attribute and the switch without reopening.
    act(() => mockEmit("settings://changed", { ...useIslandStore.getState().settings, liteMode: false }));
    expect(document.documentElement).toHaveAttribute("data-lite", "false");
    expect(screen.getByRole("switch", { name: new RegExp(label) })).not.toBeChecked();
  });

  it.each([
    ["ru", "Язык распознавания текста", "Как в Windows", "Оптическое распознавание символов"],
    ["en", "Text recognition language", "System", "Optical character recognition"],
  ] as const)("%s lists OCR languages, saves a choice and restores it on reopen", async (language, label, system, hint) => {
    await invoke("settings_set", { patch: { language } });
    useIslandStore.getState().applySettings(await backend());
    const view = render(<Harness />);
    const picker = screen.getByRole("combobox", { name: label });
    fireEvent.click(picker);
    const list = screen.getByRole("listbox", { name: label });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(3));
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
      system, "English (United States)", "Русский",
    ]);
    expect(picker).toHaveTextContent(system);
    expect(picker).toHaveAccessibleDescription(expect.stringContaining(hint));
    fireEvent.click(within(list).getByRole("option", { name: "English (United States)" }));
    await waitFor(async () => expect((await backend()).ocrLanguage).toBe("en-US"));
    expect(useIslandStore.getState().settings.ocrLanguage).toBe("en-US");
    view.unmount();
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: label })).toHaveTextContent("English (United States)"));
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.click(within(screen.getByRole("listbox", { name: label })).getByRole("option", { name: system }));
    await waitFor(async () => expect((await backend()).ocrLanguage).toBe("auto"));
  });

  it("renders the current values", async () => {
    await invoke("settings_set", { patch: { theme: "dark", autostart: true, hoverExpandDelayMs: 150, hoverCollapseDelayMs: 400 } });
    useIslandStore.getState().applySettings(await backend());
    render(<SettingsView />);

    expect(screen.getByRole("radio", { name: "Тёмная" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Авто" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Запускать вместе с Windows" })).toBeChecked();
    expect(screen.getByRole("switch", { name: /Не беспокоить/ })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Скрывать в полноэкранных приложениях" })).toBeChecked();
    expect(screen.getByLabelText("Задержка раскрытия, мс")).toHaveValue("150");
    expect(screen.getByLabelText("Задержка сворачивания, мс")).toHaveValue("400");
    expect(screen.getByText("150 мс")).toBeInTheDocument();
    expect(screen.getByText("400 мс")).toBeInTheDocument();
  });

  it("has no «Фон острова» (vibrancy) control", () => {
    render(<SettingsView />);
    expect(screen.queryByText("Фон острова")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Акрил" })).toBeNull();
  });

  it("lists the monitors: «Основной · W×H» first, then each monitor", async () => {
    render(<SettingsView />);
    const picker = await screen.findByRole("listbox", { name: "Монитор" });
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(3));
    const options = within(picker).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Основной · 2560×1440",
      "Основной монитор · 2560×1440",
      "Второй монитор · 1920×1080",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    expect(picker.querySelector("select, button, input, a[href]")).toBeNull();
  });

  it("writes the theme with settings_set({ patch }) and applies it to the store", async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("radio", { name: "Светлая" }));
    expect(useIslandStore.getState().themeMode).toBe("light"); // optimistic
    await waitFor(async () => expect((await backend()).theme).toBe("light"));
    expect(screen.getByRole("radio", { name: "Светлая" })).toHaveAttribute("aria-checked", "true");
  });

  it("writes the switches (autostart, DND, hideInFullscreen)", async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("switch", { name: "Запускать вместе с Windows" }));
    fireEvent.click(screen.getByRole("switch", { name: /Не беспокоить/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Скрывать в полноэкранных приложениях" }));
    await waitFor(async () => {
      const s = await backend();
      expect(s.autostart).toBe(true);
      expect(s.doNotDisturb).toBe(true);
      expect(s.hideInFullscreen).toBe(false);
    });
    expect(useIslandStore.getState().doNotDisturb).toBe(true);
  });

  it("writes the monitor", async () => {
    render(<SettingsView />);
    const option = await screen.findByRole("option", { name: "Второй монитор · 1920×1080" });
    fireEvent.click(option);
    await waitFor(async () => expect((await backend()).monitor).toBe("mon-2"));
    expect(option).toHaveAttribute("aria-selected", "true");
  });

  it("theme radios have one Tab stop and support arrow-key selection", async () => {
    render(<SettingsView />);
    const radios = within(screen.getByRole("radiogroup", { name: "Тема" })).getAllByRole("radio");
    expect(radios.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(radios[1]).toHaveFocus();
    expect(radios.map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
    await waitFor(async () => expect((await backend()).theme).toBe("light"));
  });

  it("monitor arrows move focus and Enter/Space commit, including a long list", () => {
    const onChange = vi.fn();
    const options = Array.from({ length: 6 }, (_, i) => ({ value: `monitor-${i}`, label: `Экран ${i}` }));
    render(<MonitorPicker value="monitor-0" options={options} onChange={onChange} />);
    const rows = screen.getAllByRole("option");
    act(() => rows[0].focus());
    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(rows[5]).toHaveFocus();
    expect(rows.map((o) => o.tabIndex)).toEqual([-1, -1, -1, -1, -1, 0]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(rows[5], { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("monitor-5");
    fireEvent.keyDown(rows[5], { key: "Home" });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: " " });
    expect(onChange).toHaveBeenLastCalledWith("monitor-0");
    fireEvent.keyDown(rows[0], { key: "End" });
    expect(rows[5]).toHaveFocus();
    for (const row of rows) expect(row.querySelector('button, input, select, a[href], [tabindex]')).toBeNull();
  });

  it("sliders follow the finger locally and write once on release, not on every input tick", async () => {
    const changed = vi.fn();
    const off = await listen("settings://changed", changed);
    render(<SettingsView />);
    const slider = screen.getByLabelText("Задержка раскрытия, мс");

    fireEvent.input(slider, { target: { value: "300" } });
    fireEvent.input(slider, { target: { value: "450" } });
    expect(screen.getByText("450 мс")).toBeInTheDocument(); // live value
    expect(changed).not.toHaveBeenCalled();
    expect((await backend()).hoverExpandDelayMs).toBe(120);

    fireEvent.change(slider, { target: { value: "450" } }); // release
    await waitFor(async () => expect((await backend()).hoverExpandDelayMs).toBe(450));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(useIslandStore.getState().hoverExpandDelayMs).toBe(450);
    off();
  });

  it("follows settings://changed from outside (e.g. the tray or another window)", async () => {
    render(<Harness />);
    await waitFor(() => expect(mockListenerCount("settings://changed")).toBeGreaterThan(0));
    await act(async () => {
      await invoke("settings_set", { patch: { theme: "light", doNotDisturb: true } });
    });
    expect(screen.getByRole("radio", { name: "Светлая" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: /Не беспокоить/ })).toBeChecked();
  });

  it("shows the current version and checks for updates manually when no release is available", async () => {
    render(<SettingsView />);
    expect(screen.getByText(`Версия ${APP_VERSION}`)).toBeInTheDocument();
    const checkBtn = screen.getByRole("button", { name: "Проверить обновления" });
    fireEvent.click(checkBtn);
    await waitFor(() => expect(mockStats.updaterChecks).toBe(1));
    expect(await screen.findByText("Установлена последняя версия")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Установить и перезапустить" })).toBeNull();
  });

  it("shows «Доступна версия X» and «Установить и перезапустить» when an update is found, and triggers a one-time toast", async () => {
    mockSetUpdate({ version: "0.1.1", notes: "Автообновление и исправления", date: "2026-10-27T12:00:00Z" });
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления" }));

    expect(await screen.findByText("Доступна версия 0.1.1")).toBeInTheDocument();
    expect(screen.getByText("Автообновление и исправления")).toBeInTheDocument();
    expect(useIslandStore.getState().toast?.label).toBe("Доступно обновление");
    const firstToastId = useIslandStore.getState().toast?.id;

    // Repeated updater://available for the same version does not re-trigger the toast.
    act(() => {
      mockEmit("updater://available", { version: "0.1.1", notes: "Автообновление и исправления", date: "2026-10-27T12:00:00Z" });
    });
    expect(useIslandStore.getState().toast?.id).toBe(firstToastId);

    const installBtn = screen.getByRole("button", { name: "Установить и перезапустить" });
    fireEvent.click(installBtn);
    await waitFor(() => expect(mockStats.updaterInstalls).toBe(1));
  });

  it("records a new summon hotkey with modifiers, cancels on Escape, resets to default and disables", async () => {
    render(<SettingsView />);
    const input = screen.getByLabelText("Вызов острова");
    expect(input).toHaveValue("Ctrl+Alt+I");

    // Click enters recording mode; Escape cancels without changing the saved hotkey.
    fireEvent.click(input);
    expect(input).toHaveValue("Нажмите сочетание…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("Ctrl+Alt+I");
    expect((await backend()).summonHotkey).toBe("Ctrl+Alt+I");

    // Record Ctrl+Shift+K.
    fireEvent.click(input);
    expect(input).toHaveValue("Нажмите сочетание…");
    // Modifier-only press keeps waiting.
    fireEvent.keyDown(input, { key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(input).toHaveValue("Нажмите сочетание…");
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true });
    await waitFor(async () => expect((await backend()).summonHotkey).toBe("Ctrl+Shift+K"));
    expect(input).toHaveValue("Ctrl+Shift+K");

    // Disable ("Выключить").
    fireEvent.click(screen.getByRole("button", { name: "Выключить" }));
    await waitFor(async () => expect((await backend()).summonHotkey).toBe(""));
    expect(input).toHaveValue("");

    // Reset ("Сбросить").
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(async () => expect((await backend()).summonHotkey).toBe("Ctrl+Alt+I"));
    expect(input).toHaveValue("Ctrl+Alt+I");
  });

  it("shows the settings_set error under the summon-hotkey field and keeps the previous shortcut when registration fails", async () => {
    mockConfig.failHotkeyRegistration = true;
    render(<SettingsView />);
    const input = screen.getByLabelText("Вызов острова");

    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "x", code: "KeyX", ctrlKey: true, altKey: true });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Не удалось зарегистрировать сочетание клавиш/);
    expect(input).toHaveValue("Ctrl+Alt+I");
    expect((await backend()).summonHotkey).toBe("Ctrl+Alt+I");
  });

  it("records a new command bar hotkey, resets and disables it", async () => {
    render(<SettingsView />);
    const input = screen.getByLabelText("Командная строка");
    expect(input).toHaveValue("Ctrl+Alt+Space");

    // Record Alt+Space
    fireEvent.click(input);
    expect(input).toHaveValue("Нажмите сочетание…");
    fireEvent.keyDown(input, { key: " ", code: "Space", altKey: true });
    await waitFor(async () => expect((await backend()).commandHotkey).toBe("Alt+Space"));
    expect(input).toHaveValue("Alt+Space");

    // Disable
    const disableBtn = screen.getByRole("button", { name: /Выключить — Командная строка/i });
    fireEvent.click(disableBtn);
    await waitFor(async () => expect((await backend()).commandHotkey).toBe(""));
    expect(input).toHaveValue("");

    // Reset
    const resetBtn = screen.getByRole("button", { name: /Сбросить — Командная строка/i });
    fireEvent.click(resetBtn);
    await waitFor(async () => expect((await backend()).commandHotkey).toBe("Ctrl+Alt+Space"));
    expect(input).toHaveValue("Ctrl+Alt+Space");
  });

  it("lists recent fullscreen apps, toggles fullscreenAllowlist, and shows the empty state and exclusive-fullscreen hint", async () => {
    const { unmount } = render(<SettingsView />);
    expect(screen.getByRole("heading", { name: "Полноэкранные приложения" })).toBeInTheDocument();
    expect(screen.getByText(/Эксклюзивный полноэкранный режим игр не поддерживается/i)).toBeInTheDocument();

    const cs2Switch = await screen.findByRole("switch", { name: /Counter-Strike 2/ });
    const chromeSwitch = screen.getByRole("switch", { name: /YouTube — Google Chrome/ });
    expect(cs2Switch).not.toBeChecked();
    expect(chromeSwitch).not.toBeChecked();

    fireEvent.click(cs2Switch);
    await waitFor(async () => expect((await backend()).fullscreenAllowlist).toEqual(["cs2.exe"]));
    expect(cs2Switch).toBeChecked();

    fireEvent.click(cs2Switch);
    await waitFor(async () => expect((await backend()).fullscreenAllowlist).toEqual([]));
    expect(cs2Switch).not.toBeChecked();

    unmount();
    mockSetFullscreenApps([]);
    render(<SettingsView />);
    expect(await screen.findByText("Пока не было полноэкранных приложений")).toBeInTheDocument();
  });

  it("manages autoHideApps (toggle, add exe, delete, reset to browsers) in RU and EN", async () => {
    mockSetMaximizedApps([{ exe: "code.exe", title: "Visual Studio Code", lastSeen: 1000 }]);
    render(<SettingsView />);

    const section = screen.getByRole("region", { name: "Прятать остров над приложениями" });
    expect(section).toBeInTheDocument();

    // Default browsers are checked; recent maximized app (code.exe) is listed unchecked.
    const chromeSwitch = await within(section).findByRole("switch", { name: /chrome\.exe/i });
    const codeSwitch = await within(section).findByRole("switch", { name: /Visual Studio Code/i });
    expect(chromeSwitch).toBeChecked();
    expect(codeSwitch).not.toBeChecked();

    // Toggle chrome.exe off, then back on.
    fireEvent.click(chromeSwitch);
    await waitFor(async () => expect((await backend()).autoHideApps).not.toContain("chrome.exe"));
    expect(chromeSwitch).not.toBeChecked();

    fireEvent.click(chromeSwitch);
    await waitFor(async () => expect((await backend()).autoHideApps).toContain("chrome.exe"));
    expect(chromeSwitch).toBeChecked();

    // Toggle recent maximized app (code.exe) on.
    fireEvent.click(codeSwitch);
    await waitFor(async () => expect((await backend()).autoHideApps).toContain("code.exe"));
    expect(codeSwitch).toBeChecked();

    // Add a custom exe ("obsidian") via input + button.
    const addInput = within(section).getByLabelText("Добавить exe (например, code.exe)");
    fireEvent.change(addInput, { target: { value: "  Obsidian " } });
    fireEvent.click(within(section).getByRole("button", { name: "Добавить" }));
    await waitFor(async () => expect((await backend()).autoHideApps).toContain("obsidian.exe"));
    expect(within(section).getByRole("switch", { name: /obsidian\.exe/i })).toBeChecked();

    // Remove obsidian.exe and chrome.exe via delete buttons.
    fireEvent.click(within(section).getByRole("button", { name: "Удалить obsidian.exe из списка" }));
    await waitFor(async () => expect((await backend()).autoHideApps).not.toContain("obsidian.exe"));
    expect(within(section).queryByRole("switch", { name: /obsidian\.exe/i })).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: "Удалить chrome.exe из списка" }));
    await waitFor(async () => expect((await backend()).autoHideApps).not.toContain("chrome.exe"));

    // Reset to browsers restores the default browser list.
    fireEvent.click(within(section).getByRole("button", { name: "Сбросить к браузерам" }));
    await waitFor(async () => expect((await backend()).autoHideApps).toEqual([...DEFAULT_AUTO_HIDE_APPS]));
    expect(within(section).getByRole("switch", { name: /chrome\.exe/i })).toBeChecked();

    // Switch language to English and verify English labels.
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    await waitFor(async () => expect((await backend()).language).toBe("en"));
    const enSection = screen.getByRole("region", { name: "Hide the island over apps" });
    expect(within(enSection).getByLabelText("Add exe (e.g. code.exe)")).toBeInTheDocument();
    expect(within(enSection).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(within(enSection).getByRole("button", { name: "Reset to browsers" })).toBeInTheDocument();
    expect(within(enSection).getByRole("button", { name: "Remove chrome.exe from list" })).toBeInTheDocument();
  });

  it("renders tiles section and handles customize and reset buttons", async () => {
    useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, quickTiles: [] });
    render(<SettingsView />);
    const section = screen.getByRole("region", { name: "Плитки" });
    expect(section).toBeInTheDocument();

    const customizeBtn = within(section).getByRole("button", { name: "Настроить" });
    const resetBtn = within(section).getByRole("button", { name: "Сбросить плитки" });

    expect(customizeBtn).toBeInTheDocument();
    expect(resetBtn).toBeInTheDocument();

    // Click customize: sets editing = true, view = "tabs", activeTab = "home"
    useTilesEditStore.setState({ editing: false });
    fireEvent.click(customizeBtn);
    expect(useTilesEditStore.getState().editing).toBe(true);
    expect(useIslandStore.getState().view).toBe("tabs");
    expect(useIslandStore.getState().activeTab).toBe("home");

    // Click reset: sets quickTiles to DEFAULT_QUICK_TILES
    await invoke("settings_set", { patch: { quickTiles: [] } });
    fireEvent.click(resetBtn);
    await waitFor(async () => {
      const current = await invoke("settings_get");
      expect(current.quickTiles).toEqual(DEFAULT_QUICK_TILES);
    });
  });
});
