import { afterEach, expect, it, vi } from "vitest";
import { listenDockDrop } from "../ipc/dock";

const native = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    native.listeners.set(name, callback);
    return native.off;
  }),
}));
afterEach(() => { vi.unstubAllGlobals(); native.listeners.clear(); vi.clearAllMocks(); });

it("IPC drop adapter preserves physical coordinates for native enter, over and drop", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const callback = vi.fn();
  const stop = await listenDockDrop(callback);
  const position = { x: 150, y: 240 };
  const paths = ["C:\\Report.pdf"];
  for (const type of ["enter", "over", "drop"] as const) {
    native.listeners.get(`tauri://drag-${type}`)?.({ payload: { position, ...(type !== "over" ? { paths } : {}) } });
    expect(callback).toHaveBeenLastCalledWith({ type, position, paths: type !== "over" ? paths : undefined });
  }
  native.listeners.get("tauri://drag-leave")?.({ payload: null });
  expect(callback).toHaveBeenLastCalledWith({ type: "leave", paths: undefined });
  stop();
  expect(native.off).toHaveBeenCalledTimes(4);
});

it("browser drop adapter preserves coordinates and unsubscribes", async () => {
  const callback = vi.fn();
  const stop = await listenDockDrop(callback);
  const detail = { type: "drop", paths: ["C:\\Report.pdf"], position: { x: 100, y: 200 } };
  window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail }));
  expect(callback).toHaveBeenCalledExactlyOnceWith(detail);
  stop();
  window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail }));
  expect(callback).toHaveBeenCalledTimes(1);
});
