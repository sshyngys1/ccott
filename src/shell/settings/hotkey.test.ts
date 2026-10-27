import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_HIDE_APPS,
  DEFAULT_SUMMON_HOTKEY,
  buildAutoHideAppRows,
  formatAcceleratorFromKeyEvent,
  normalizeAccelerator,
  normalizeAutoHideApps,
  normalizeAutoHideExe,
  normalizeFullscreenAllowlist,
  toggleAutoHideApp,
  toggleFullscreenAllowlist,
} from "./hotkey";

describe("formatAcceleratorFromKeyEvent", () => {
  it("formats modifier + key combinations in canonical order", () => {
    expect(formatAcceleratorFromKeyEvent({ key: " ", code: "Space", ctrlKey: true, altKey: true })).toBe("Ctrl+Alt+Space");
    expect(formatAcceleratorFromKeyEvent({ key: "i", code: "KeyI", ctrlKey: true, altKey: true })).toBe(DEFAULT_SUMMON_HOTKEY);
    expect(formatAcceleratorFromKeyEvent({ key: "k", code: "KeyK", shiftKey: true, ctrlKey: true })).toBe("Ctrl+Shift+K");
    expect(formatAcceleratorFromKeyEvent({ key: "F11", code: "F11", altKey: true })).toBe("Alt+F11");
    expect(formatAcceleratorFromKeyEvent({ key: "5", code: "Digit5", metaKey: true, shiftKey: true })).toBe("Shift+Super+5");
    expect(formatAcceleratorFromKeyEvent({ key: "ArrowUp", code: "ArrowUp", ctrlKey: true })).toBe("Ctrl+Up");
  });

  it("falls back to event.key when event.code is omitted", () => {
    expect(formatAcceleratorFromKeyEvent({ key: " ", ctrlKey: true, altKey: true })).toBe("Ctrl+Alt+Space");
    expect(formatAcceleratorFromKeyEvent({ key: "q", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+Q");
    expect(formatAcceleratorFromKeyEvent({ key: "f2", altKey: true })).toBe("Alt+F2");
  });

  it("returns null for modifier-only or modifierless key presses", () => {
    expect(formatAcceleratorFromKeyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true })).toBeNull();
    expect(formatAcceleratorFromKeyEvent({ key: "Alt", code: "AltLeft", altKey: true })).toBeNull();
    expect(formatAcceleratorFromKeyEvent({ key: "a", code: "KeyA" })).toBeNull();
    expect(formatAcceleratorFromKeyEvent({ key: " ", code: "Space" })).toBeNull();
  });
});

describe("normalizeAccelerator", () => {
  it("normalizes valid combinations and allows empty string", () => {
    expect(normalizeAccelerator("")).toBe("");
    expect(normalizeAccelerator("  ")).toBe("");
    expect(normalizeAccelerator("alt + ctrl + space")).toBe("Ctrl+Alt+Space");
    expect(normalizeAccelerator("Win+Shift+f12")).toBe("Shift+Super+F12");
  });

  it("throws a clear Russian message on invalid combinations", () => {
    expect(() => normalizeAccelerator("Space")).toThrow(/модификатор/);
    expect(() => normalizeAccelerator("Ctrl+Alt")).toThrow(/основная клавиша/);
    expect(() => normalizeAccelerator("Ctrl+A+B")).toThrow(/несколько основных клавиш/);
    expect(() => normalizeAccelerator("Ctrl+Неизвестно")).toThrow(/Неподдерживаемая клавиша/);
  });
});

describe("fullscreenAllowlist helpers", () => {
  it("normalizes and toggles exe names case-insensitively", () => {
    expect(normalizeFullscreenAllowlist([" CS2.EXE ", "chrome.exe", "cs2.exe", ""])).toEqual(["cs2.exe", "chrome.exe"]);
    expect(toggleFullscreenAllowlist(["chrome.exe"], "CS2.exe", true)).toEqual(["chrome.exe", "cs2.exe"]);
    expect(toggleFullscreenAllowlist(["chrome.exe", "CS2.EXE"], "cs2.exe", false)).toEqual(["chrome.exe"]);
  });
});

describe("autoHideApps helpers", () => {
  it("normalizes user exe input and merges autoHideApps with recent maximized apps", () => {
    expect(DEFAULT_AUTO_HIDE_APPS).toEqual([
      "chrome.exe",
      "msedge.exe",
      "firefox.exe",
      "browser.exe",
      "opera.exe",
      "brave.exe",
      "vivaldi.exe",
    ]);
    expect(normalizeAutoHideExe("  Code ")).toBe("code.exe");
    expect(normalizeAutoHideExe("C:\\Program Files\\Obsidian\\Obsidian.EXE")).toBe("obsidian.exe");
    expect(normalizeAutoHideExe("   ")).toBe("");
    expect(normalizeAutoHideApps([" CHROME.EXE ", "firefox.exe", "chrome.exe"])).toEqual(["chrome.exe", "firefox.exe"]);
    expect(toggleAutoHideApp(["chrome.exe"], "Code.exe", true)).toEqual(["chrome.exe", "code.exe"]);
    expect(toggleAutoHideApp(["chrome.exe", "code.exe"], "CHROME.EXE", false)).toEqual(["code.exe"]);

    const rows = buildAutoHideAppRows(
      ["chrome.exe"],
      [{ exe: "code.exe", title: "Visual Studio Code", lastSeen: 100 }],
      ["chrome.exe", "firefox.exe"],
      [],
    );
    expect(rows).toEqual([
      { exe: "chrome.exe", title: "chrome.exe", enabled: true },
      { exe: "firefox.exe", title: "firefox.exe", enabled: false },
      { exe: "code.exe", title: "Visual Studio Code", enabled: false },
    ]);
  });
});
