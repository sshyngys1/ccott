import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../ipc";
import { mockConfig, mockEmit, mockHotkeysStartup, mockListenerCount, resetMock } from "../ipc/mock";
import { COMMAND_HOTKEY_FALLBACKS, type IslandModule } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { useShellBus } from "./shellBus";
import { PillToast } from "./Island";
const shellStyles = readFileSync("src/shell/shell.css", "utf8");

const controls = {
  expandNow: () => useIslandStore.getState().setMode("expanded"),
  collapseNow: () => useIslandStore.getState().setMode("collapsed"),
  summon: () => useIslandStore.getState().setMode("expanded"),
};
const release = async () => {};
const tabs: IslandModule[] = [];
function Harness({ renderToast = true }: { renderToast?: boolean }) {
  useShellBus(controls, release, tabs, release);
  const toast = useIslandStore((s) => s.toast);
  const mode = useIslandStore((s) => s.mode);
  return <><style>{shellStyles}</style>{renderToast && mode === "collapsed" && toast && <PillToast {...toast} />}</>;
}
const fallbackKey = "ccott.hotkey-fallback:Ctrl+Alt+Space:Ctrl+Shift+Space";

beforeEach(() => {
  resetMock(); resetIslandStore();
  for (const key of Object.keys(localStorage)) if (key.startsWith("ccott.hotkey-fallback:")) localStorage.removeItem(key);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetMock(); resetIslandStore(); });

it("reads a startup fallback, shows its Settings action once across duplicate events and remounts", async () => {
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  const view = render(<StrictMode><Harness /></StrictMode>);
  await waitFor(() => expect(useIslandStore.getState().toast?.title).toBe("Ctrl+Alt+Space занято — командная строка: Ctrl+Shift+Space"));
  expect(localStorage.getItem(fallbackKey)).toBe("1");
  const toast = useIslandStore.getState().toast!;
  expect(toast.actions?.[0].label).toBe("Настройки");
  act(() => toast.actions![0].onClick());
  expect(useIslandStore.getState().view).toBe("tabs");
  expect(useIslandStore.getState().mode).toBe("collapsed");
  await act(async () => mockEmit("hotkeys://status", await invoke("hotkeys_status")));
  expect(useIslandStore.getState().toast?.id).toBe(toast.id);
  view.unmount();
  expect(mockListenerCount("hotkeys://status")).toBe(0);
  act(() => { useIslandStore.getState().setToast(null); controls.collapseNow(); });
  render(<Harness />);
  await act(async () => { await invoke("hotkeys_status"); });
  expect(useIslandStore.getState().toast).toBeNull();
  await act(async () => mockHotkeysStartup(["Ctrl+Alt+Space", COMMAND_HOTKEY_FALLBACKS[0]], { commandHotkey: "Ctrl+Alt+Space" }));
  await waitFor(() => expect(useIslandStore.getState().toast?.shortcut).toBe("Alt+Shift+Space"));
});

it("keeps the toast deduplicated when localStorage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  render(<Harness />);
  await waitFor(() => expect(useIslandStore.getState().toast).not.toBeNull());
  const id = useIslandStore.getState().toast!.id;
  await act(async () => mockEmit("hotkeys://status", await invoke("hotkeys_status")));
  expect(useIslandStore.getState().toast!.id).toBe(id);
});

it("does not consume a fallback notification while DND is enabled", async () => {
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  useIslandStore.setState({ doNotDisturb: true });
  render(<Harness />);
  await act(async () => { await invoke("hotkeys_status"); });
  expect(useIslandStore.getState().toast).toBeNull();
  act(() => useIslandStore.setState({ doNotDisturb: false }));
  await waitFor(() => expect(useIslandStore.getState().toast).not.toBeNull());
});

it.each(["ru", "en"] as const)("renders %s with a nonshrinking shortcut and Settings button outside the truncated label", async (language) => {
  useIslandStore.getState().applySettings(await invoke("settings_set", { patch: { language } }));
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  render(<Harness />);
  const shortcut = await screen.findByText("Ctrl+Shift+Space");
  expect(shortcut).toHaveClass("ig-pill-shortcut");
  expect(shortcut.closest(".ig-truncate")).toBeNull();
  expect(getComputedStyle(shortcut).flexShrink).toBe("0");
  const label = shortcut.previousElementSibling!;
  expect(label).toHaveClass("ig-truncate");
  expect(screen.getByRole("status")).toHaveAttribute("title", useIslandStore.getState().toast!.title);
  const name = language === "en" ? "Settings" : "Настройки";
  const button = screen.getByRole("button", { name });
  expect(button).toHaveTextContent(name);
  expect(getComputedStyle(button).flexShrink).toBe("0");
  fireEvent.click(button);
  expect(useIslandStore.getState().view).toBe("tabs");
  expect(useIslandStore.getState().mode).toBe("collapsed");
});

it("does not mark a queued toast seen before PillToast renders, and retries after remount", async () => {
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  const hidden = render(<Harness renderToast={false} />);
  await waitFor(() => expect(useIslandStore.getState().toast?.shortcut).toBe("Ctrl+Shift+Space"));
  expect(localStorage.getItem(fallbackKey)).toBeNull();
  hidden.unmount();
  act(() => useIslandStore.getState().setToast(null));
  render(<Harness />);
  await screen.findByText("Ctrl+Shift+Space");
  expect(localStorage.getItem(fallbackKey)).toBe("1");
});

it("waits until the expanded panel collapses before showing or consuming a fallback", async () => {
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  useIslandStore.setState({ mode: "expanded" });
  render(<Harness />);
  await act(async () => { await invoke("hotkeys_status"); });
  expect(useIslandStore.getState().toast).toBeNull();
  expect(localStorage.getItem(fallbackKey)).toBeNull();
  act(() => controls.collapseNow());
  await screen.findByText("Ctrl+Shift+Space");
  expect(localStorage.getItem(fallbackKey)).toBe("1");
});

it.each(["ru", "en"] as const)("reports a session-only fallback in %s even if a persisted toast was seen before", async (language) => {
  useIslandStore.getState().applySettings(await invoke("settings_set", { patch: { language } }));
  mockConfig.failSettingsSave = true;
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  localStorage.setItem(fallbackKey, "1");
  const view = render(<Harness />);
  const warning = language === "ru" ? "Не удалось сохранить — действует до перезапуска" : "Could not save — active until restart";
  expect(await screen.findByText(warning)).toBeVisible();
  expect(await invoke("hotkeys_status")).toMatchObject({ command: "ok", commandFallbackFrom: "Ctrl+Alt+Space" });
  expect((await invoke("settings_get")).commandHotkey).toBe("Ctrl+Shift+Space");
  view.unmount();
  act(() => useIslandStore.getState().setToast(null));
  // Same failure on the next startup must remain visible, irrespective of persistent dedup.
  mockHotkeysStartup(["Ctrl+Alt+Space"], { commandHotkey: "Ctrl+Alt+Space" });
  render(<Harness />);
  expect(await screen.findByText(warning)).toBeVisible();
});

it("does not persist a session-only notification and can save after write access returns", async () => {
  mockConfig.failSettingsSave = true;
  mockHotkeysStartup(["Ctrl+Alt+Space"]);
  render(<Harness />);
  await screen.findByText("Не удалось сохранить — действует до перезапуска");
  expect(localStorage.getItem(fallbackKey)).toBeNull();
  mockConfig.failSettingsSave = false;
  await expect(invoke("settings_set", { patch: {} })).resolves.toMatchObject({ commandHotkey: "Ctrl+Shift+Space" });
});
