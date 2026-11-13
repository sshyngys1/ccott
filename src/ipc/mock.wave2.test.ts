import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, listen } from "./index";
import { ARTWORK_DELAY_MS, mockConfig,mockCopy, mockLoseKeyboardFocus, mockSetMedia, mockStats, resetMock } from "./mock";

beforeEach(() => resetMock());

describe("mock: keyboard focus", () => {
  it("island_set_keyboard_focus resolves after a short delay, records the call and does not echo focus-changed", async () => {
    const changed = vi.fn();
    const off = await listen("island://focus-changed", changed);
    mockConfig.keyboardFocusDelayMs = 20;
    const t0 = performance.now();
    await invoke("island_set_keyboard_focus", { active: true });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
    expect(mockStats.keyboardFocus).toBe(true);
    await invoke("island_set_keyboard_focus", { active: false });
    expect(mockStats.keyboardFocus).toBe(false);
    expect(mockStats.keyboardFocusCalls).toEqual([true, false]);
    expect(changed).not.toHaveBeenCalled();
    off();
  });

  it("can refuse the keyboard; mockLoseKeyboardFocus emits focus-changed only while it is held", async () => {
    mockConfig.keyboardFocusDelayMs = 0;
    const changed = vi.fn();
    const off = await listen("island://focus-changed", changed);
    mockLoseKeyboardFocus();
    expect(changed).not.toHaveBeenCalled();
    mockConfig.failKeyboardFocus = true;
    await expect(invoke("island_set_keyboard_focus", { active: true })).rejects.toThrow();
    expect(mockStats.keyboardFocus).toBe(false);
    mockConfig.failKeyboardFocus = false;
    await invoke("island_set_keyboard_focus", { active: true });
    mockLoseKeyboardFocus();
    expect(changed).toHaveBeenCalledWith({ active: false });
    expect(mockStats.keyboardFocus).toBe(false);
    off();
  });
});

describe("mock: console helpers", () => {
  it("window.__ISLAND_MOCK__ has the helpers and still the stats", async () => {
    const mock = (window as unknown as { __ISLAND_MOCK__: Record<string, unknown> }).__ISLAND_MOCK__;
    for (const key of ["openSettings", "copy", "loseFocus", "setMedia", "config", "shapeCalls", "keyboardFocusCalls"]) {
      expect(mock).toHaveProperty(key);
    }
    const open = vi.fn();
    const off = await listen("island://open-settings", open);
    (mock.openSettings as () => void)();
    expect(open).toHaveBeenCalledWith(null);
    const added = vi.fn();
    const off2 = await listen("clipboard://added", added);
    const item = (mock.copy as (t: string) => { kind: string })("https://example.com");
    expect(item.kind).toBe("link");
    expect(added).toHaveBeenCalledTimes(1);
    off();
    off2();
  });
});

describe("mock: settings / audio", () => {
  it("settings_set clamps the hover delays to the slider ranges", async () => {
    const s = await invoke("settings_set", { patch: { hoverExpandDelayMs: 5000, hoverCollapseDelayMs: -10 } });
    expect(s.hoverExpandDelayMs).toBe(1000);
    expect(s.hoverCollapseDelayMs).toBe(0);
  });

  it("audio_set_volume / audio_set_muted emit audio://changed with the new state", async () => {
    const changed = vi.fn();
    const off = await listen("audio://changed", changed);
    await invoke("audio_set_volume", { volume: 120 });
    await invoke("audio_set_muted", { muted: true });
    expect(changed).toHaveBeenNthCalledWith(1, expect.objectContaining({ volume: 100, muted: false }));
    expect(changed).toHaveBeenNthCalledWith(2, expect.objectContaining({ volume: 100, muted: true }));
    off();
  });
});

describe("mock: media", () => {
  it("seek / playPause emit media://changed; a paused track keeps its position", async () => {
    const changed = vi.fn();
    const off = await listen("media://changed", changed);
    await invoke("media_seek", { positionMs: 50_000 });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ positionMs: 50_000, status: "playing" }));
    await invoke("media_action", { action: "playPause" });
    const paused = changed.mock.calls[changed.mock.calls.length - 1][0];
    expect(paused.status).toBe("paused");
    expect(paused.positionMs).toBeGreaterThanOrEqual(50_000);
    off();
  });

  it("a playing track moves on to the next one when it ends", async () => {
    vi.useFakeTimers();
    try {
      const changed = vi.fn();
      const off = await listen("media://changed", changed);
      const first = await invoke("media_get_state");
      mockSetMedia({ positionMs: first.durationMs - 1000, positionSampledAt: Date.now() });
      changed.mockClear();
      await vi.advanceTimersByTimeAsync(1100);
      expect(changed).toHaveBeenCalledTimes(1);
      const next = changed.mock.calls[0][0];
      expect(next.title).not.toBe(first.title);
      expect(next.status).toBe("playing");
      expect(next.positionMs).toBe(0);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a paused or session-less player never auto-advances", async () => {
    vi.useFakeTimers();
    try {
      const changed = vi.fn();
      const off = await listen("media://changed", changed);
      mockSetMedia({ status: "paused" });
      changed.mockClear();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(changed).not.toHaveBeenCalled();
      mockSetMedia({ hasSession: false, status: "stopped" });
      changed.mockClear();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(changed).not.toHaveBeenCalled();
      off();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mock: track change artwork (mirrors SMTC)", () => {
  it("next emits media://changed with artwork null, then the cover ~1.5 s later", async () => {
    vi.useFakeTimers();
    try {
      const changed = vi.fn();
      const off = await listen("media://changed", changed);
      const first = await invoke("media_get_state");
      expect(first.artwork).not.toBeNull();
      await invoke("media_action", { action: "next" });
      expect(changed).toHaveBeenCalledTimes(1);
      const bare = changed.mock.calls[0][0];
      expect(bare.title).not.toBe(first.title);
      expect(bare.artwork).toBeNull();
      expect((await invoke("media_get_state")).artwork).toBeNull();

      await vi.advanceTimersByTimeAsync(ARTWORK_DELAY_MS - 10);
      expect(changed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20);
      expect(changed).toHaveBeenCalledTimes(2);
      const full = changed.mock.calls[1][0];
      expect(full.title).toBe(bare.title);
      expect(full.artwork?.startsWith("data:image/")).toBe(true);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second track change before the cover arrives drops the stale cover", async () => {
    vi.useFakeTimers();
    try {
      const changed = vi.fn();
      const off = await listen("media://changed", changed);
      await invoke("media_action", { action: "next" });
      await vi.advanceTimersByTimeAsync(500);
      await invoke("media_action", { action: "next" });
      changed.mockClear();
      await vi.advanceTimersByTimeAsync(ARTWORK_DELAY_MS + 50);
      expect(changed).toHaveBeenCalledTimes(1); // only the cover of the current track
      expect(changed.mock.calls[0][0].title).toBe((await invoke("media_get_state")).title);
      off();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mock: clipboard", () => {
  it("clipboard_paste records the request, moves the entry to the top of its group and emits clipboard://changed", async () => {
    const changed = vi.fn();
    const off = await listen("clipboard://changed", changed);
    await invoke("clipboard_paste", { id: 5, mode: "copy" });
    expect(mockStats.lastPaste).toEqual({ id: 5, mode: "copy" });
    expect(changed).toHaveBeenCalledTimes(1);
    const unpinned = (await invoke("clipboard_list", { query: "", limit: 100 })).filter((c) => !c.pinned);
    expect(unpinned[0].id).toBe(5);
    await expect(invoke("clipboard_paste", { id: 999, mode: "paste" })).rejects.toThrow();
    off();
  });

  it("has a data: URL image thumbnail; mockCopy emits added + changed and lists the new entry", async () => {
    const image = (await invoke("clipboard_list", { query: "", limit: 100 })).find((c) => c.kind === "image");
    expect(image?.preview.startsWith("data:image/")).toBe(true);
    expect(image?.text).toBe("");
    const added = vi.fn();
    const changed = vi.fn();
    const off = await listen("clipboard://added", added);
    const off2 = await listen("clipboard://changed", changed);
    const item = mockCopy({ kind: "text", text: "новая запись" });
    expect(added).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, text: "новая запись" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await invoke("clipboard_list", { query: "", limit: 100 }))[2].id).toBe(item.id); // right below the 2 pinned
    off();
    off2();
  });
});
