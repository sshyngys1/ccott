import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri, listen, registerHoverTarget } from "./index";
import { mockEmit, mockListenerCount, resetMock } from "./mock";

beforeEach(() => resetMock());

/** `registerHoverTarget` attaches its listeners after the lazily imported mock resolves (a microtask or two). */
const flushLazyMock = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("ipc wrappers", () => {
  it("uses the mock when __TAURI_INTERNALS__ is absent", () => {
    expect(isTauri()).toBe(false);
  });

  it("takes no args for argument-less commands", async () => {
    const monitors = await invoke("window_list_monitors");
    expect(monitors.length).toBeGreaterThan(0);
    expect(monitors.some((m) => m.isPrimary)).toBe(true);
  });

  it("listen returns an unlisten function", async () => {
    const cb = vi.fn();
    const off = await listen("island://hover", cb);
    mockEmit("island://hover", { inside: true });
    off();
    mockEmit("island://hover", { inside: false });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ inside: true });
    expect(mockListenerCount("island://hover")).toBe(0);
  });

  it("registerHoverTarget turns pointer events into island://hover", async () => {
    const el = document.createElement("div");
    const cb = vi.fn();
    const off = await listen("island://hover", cb);
    const stop = registerHoverTarget(el);
    await flushLazyMock();
    el.dispatchEvent(new Event("pointerenter"));
    el.dispatchEvent(new Event("pointerleave"));
    expect(cb.mock.calls.map((c) => c[0])).toEqual([{ inside: true }, { inside: false }]);
    stop();
    el.dispatchEvent(new Event("pointerenter"));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it("registerHoverTarget cleaned up before the lazy mock has loaded never attaches listeners", async () => {
    const el = document.createElement("div");
    const cb = vi.fn();
    const off = await listen("island://hover", cb);
    registerHoverTarget(el)(); // synchronous stop, before the dynamic import() resolves
    await flushLazyMock();
    el.dispatchEvent(new Event("pointerenter"));
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("registerHoverTarget(null) is a safe no-op", () => {
    expect(() => registerHoverTarget(null)()).not.toThrow();
  });
});

describe("mock: window", () => {
  it("window_set_vibrancy applies none", async () => {
    const r = await invoke("window_set_vibrancy", { mode: "acrylic" });
    expect(r.requested).toBe("acrylic");
    expect(r.applied).toBe("none");
  });

  it("counts island_set_shape / island_set_mode calls", async () => {
    const { mockStats } = await import("./mock");
    await invoke("island_set_shape", { shape: { x: 1, y: 2, width: 3, height: 4, radius: 5 } });
    await invoke("island_set_mode", { mode: "expanded" });
    expect(mockStats.shapeCalls).toBe(1);
    expect(mockStats.lastShape?.width).toBe(3);
    expect(mockStats.lastMode).toBe("expanded");
  });
});

describe("mock: clipboard", () => {
  it("has 10 entries, 2 pinned, with varied sources", async () => {
    const all = await invoke("clipboard_list", { query: "", limit: 100 });
    expect(all).toHaveLength(10);
    expect(all.filter((c) => c.pinned)).toHaveLength(2);
    const sources = new Set(all.map((c) => c.sourceApp));
    expect(sources.has("Telegram.exe")).toBe(true);
    expect(sources.has("chrome.exe")).toBe(true);
    expect(new Set(all.map((c) => c.kind))).toEqual(new Set(["text", "link", "image", "files"]));
  });

  it("orders pinned first, then by createdAt desc", async () => {
    const all = await invoke("clipboard_list", { query: "", limit: 100 });
    const firstUnpinned = all.findIndex((c) => !c.pinned);
    expect(firstUnpinned).toBe(2);
    expect(all.slice(firstUnpinned).some((c) => c.pinned)).toBe(false);
    for (const group of [all.slice(0, firstUnpinned), all.slice(firstUnpinned)]) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i - 1].createdAt).toBeGreaterThanOrEqual(group[i].createdAt);
      }
    }
  });

  it("respects limit and query", async () => {
    expect(await invoke("clipboard_list", { query: "", limit: 3 })).toHaveLength(3);
    const tg = await invoke("clipboard_list", { query: "telegram", limit: 100 });
    expect(tg.length).toBeGreaterThan(0);
    expect(tg.every((c) => c.sourceApp === "Telegram.exe")).toBe(true);
  });

  it("pin moves an item to the top and emits clipboard://changed", async () => {
    const changed = vi.fn();
    const off = await listen("clipboard://changed", changed);
    await invoke("clipboard_pin", { id: 2, pinned: true });
    const all = await invoke("clipboard_list", { query: "", limit: 100 });
    expect(all.filter((c) => c.pinned)).toHaveLength(3);
    expect(all[0].id).toBe(2); // newest pinned first
    expect(changed).toHaveBeenCalledTimes(1);
    await invoke("clipboard_pin", { id: 2, pinned: false });
    expect((await invoke("clipboard_list", { query: "", limit: 100 })).filter((c) => c.pinned)).toHaveLength(2);
    off();
  });

  it("delete and clear actually change the list", async () => {
    await invoke("clipboard_delete", { id: 3 });
    const afterDelete = await invoke("clipboard_list", { query: "", limit: 100 });
    expect(afterDelete).toHaveLength(9);
    expect(afterDelete.some((c) => c.id === 3)).toBe(false);

    await invoke("clipboard_clear", { keepPinned: true });
    const kept = await invoke("clipboard_list", { query: "", limit: 100 });
    expect(kept.every((c) => c.pinned)).toBe(true);
    expect(kept).toHaveLength(2);

    await invoke("clipboard_clear", { keepPinned: false });
    expect(await invoke("clipboard_list", { query: "", limit: 100 })).toHaveLength(0);
  });

  it("returns copies: mutating a result does not touch the mock", async () => {
    const a = await invoke("clipboard_list", { query: "", limit: 1 });
    a[0].text = "hacked";
    const b = await invoke("clipboard_list", { query: "", limit: 1 });
    expect(b[0].text).not.toBe("hacked");
  });
});

describe("mock: media / audio / settings / notes", () => {
  it("has a playing track with artwork data: URL", async () => {
    const m = await invoke("media_get_state");
    expect(m.hasSession).toBe(true);
    expect(m.status).toBe("playing");
    expect(m.artwork?.startsWith("data:image/svg+xml")).toBe(true);
    expect(m.positionMs).toBeGreaterThan(0);
    expect(m.durationMs).toBeGreaterThan(m.positionMs);
  });

  it("media_action playPause toggles status and emits media://changed", async () => {
    const changed = vi.fn();
    const off = await listen("media://changed", changed);
    await invoke("media_action", { action: "playPause" });
    expect((await invoke("media_get_state")).status).toBe("paused");
    await invoke("media_action", { action: "playPause" });
    expect((await invoke("media_get_state")).status).toBe("playing");
    expect(changed).toHaveBeenCalledTimes(2);
    off();
  });

  it("next/previous switch tracks and seek moves the position", async () => {
    const first = await invoke("media_get_state");
    await invoke("media_action", { action: "next" });
    const second = await invoke("media_get_state");
    expect(second.title).not.toBe(first.title);
    await invoke("media_action", { action: "previous" });
    expect((await invoke("media_get_state")).title).toBe(first.title);
    await invoke("media_seek", { positionMs: 10_000 });
    expect((await invoke("media_get_state")).positionMs).toBe(10_000);
  });

  it("audio: 64% on «Динамики», volume/mute/device mutate", async () => {
    const a = await invoke("audio_get_state");
    expect(a.volume).toBe(64);
    expect(a.device?.name).toBe("Динамики");
    await invoke("audio_set_volume", { volume: 30 });
    await invoke("audio_set_muted", { muted: true });
    const b = await invoke("audio_get_state");
    expect(b.volume).toBe(30);
    expect(b.muted).toBe(true);
    await invoke("audio_set_device", { id: "dev-headphones" });
    expect((await invoke("audio_get_state")).device?.id).toBe("dev-headphones");
    expect((await invoke("audio_list_devices")).filter((d) => d.isDefault)).toHaveLength(1);
  });

  it("settings defaults and patch + settings://changed", async () => {
    const s = await invoke("settings_get");
    expect(s.hoverExpandDelayMs).toBe(120);
    expect(s.hoverCollapseDelayMs).toBe(350);
    const changed = vi.fn();
    const off = await listen("settings://changed", changed);
    const next = await invoke("settings_set", { patch: { theme: "light" } });
    expect(next.theme).toBe("light");
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    off();
  });

  it("notes: 3 seeded, create / update / delete", async () => {
    expect(await invoke("notes_list")).toHaveLength(3);
    const created = await invoke("notes_save", { note: { id: null, folder: "Работа", title: "Новая", body: "<p>x</p>" } });
    expect(created.id).toBeGreaterThan(3);
    expect(await invoke("notes_list")).toHaveLength(4);
    const updated = await invoke("notes_save", { note: { id: created.id, folder: "Работа", title: "Новая 2", body: "" } });
    expect(updated.title).toBe("Новая 2");
    expect((await invoke("notes_list"))[0].id).toBe(created.id); // most recently updated first
    await invoke("notes_delete", { id: created.id });
    expect(await invoke("notes_list")).toHaveLength(3);
  });
});
