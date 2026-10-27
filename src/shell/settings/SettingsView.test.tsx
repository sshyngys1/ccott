import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, listen } from "../../ipc";
import { mockConfig, mockEmit, mockListenerCount, mockSetFullscreenApps, mockSetUpdate, mockStats, resetMock } from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import { useSettingsSync } from "../useShellSync";
import { SettingsView } from "./SettingsView";
import { MonitorPicker } from "./MonitorPicker";

/** The view plus the shell's store↔backend sync, as inside the Island. */
function Harness() {
  useSettingsSync();
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
    expect(screen.getByText("Версия 0.1.0")).toBeInTheDocument();
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
});
