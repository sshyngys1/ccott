import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from ".";
import { mockHotkeysStartup, mockListen, resetMock } from "./mock";
import { COMMAND_HOTKEY_FALLBACKS } from "../shared/types";

beforeEach(resetMock);

it("reports startup fallback and emits settings/status, skipping occupied fallbacks", async () => {
  const settings = vi.fn(), status = vi.fn();
  const offSettings = mockListen("settings://changed", settings);
  const offStatus = mockListen("hotkeys://status", status);
  try {
    mockHotkeysStartup(["Ctrl+Alt+Space", COMMAND_HOTKEY_FALLBACKS[0]]);
    expect((await invoke("settings_get")).commandHotkey).toBe(COMMAND_HOTKEY_FALLBACKS[1]);
    expect(await invoke("hotkeys_status")).toEqual({ summon: "ok", command: "ok", commandFallbackFrom: "Ctrl+Alt+Space" });
    expect(settings).toHaveBeenCalledOnce(); expect(status).toHaveBeenCalledOnce();
  } finally { offSettings(); offStatus(); }
});

it("all busy keeps the default, custom busy is preserved, and off is reported", async () => {
  mockHotkeysStartup(["Ctrl+Alt+Space", ...COMMAND_HOTKEY_FALLBACKS]);
  expect((await invoke("settings_get")).commandHotkey).toBe("Ctrl+Alt+Space");
  expect((await invoke("hotkeys_status")).command).toBe("busy");
  mockHotkeysStartup(["Ctrl+Shift+X"], { summonHotkey: "", commandHotkey: "Ctrl+Shift+X" });
  expect((await invoke("settings_get")).commandHotkey).toBe("Ctrl+Shift+X");
  expect(await invoke("hotkeys_status")).toEqual({ summon: "off", command: "busy", commandFallbackFrom: null });
});

it("settings_set preserves an unchanged busy shortcut and rejects a pair without partial changes", async () => {
  mockHotkeysStartup(["Ctrl+Shift+X", "Ctrl+Alt+Z"], { commandHotkey: "Ctrl+Shift+X" });
  await invoke("settings_set", { patch: { summonHotkey: "Ctrl+Alt+K" } });
  expect(await invoke("hotkeys_status")).toEqual({ summon: "ok", command: "busy", commandFallbackFrom: null });
  const before = await invoke("settings_get");
  await expect(invoke("settings_set", { patch: { summonHotkey: "Ctrl+Alt+Z", commandHotkey: "Ctrl+Shift+K" } })).rejects.toThrow();
  expect(await invoke("settings_get")).toEqual(before);
  await expect(invoke("settings_set", { patch: { commandHotkey: "Space" } })).rejects.toThrow();
  expect(await invoke("settings_get")).toEqual(before);
  await invoke("settings_set", { patch: { commandHotkey: "", summonHotkey: "" } });
  expect(await invoke("hotkeys_status")).toEqual({ summon: "off", command: "off", commandFallbackFrom: null });
});
