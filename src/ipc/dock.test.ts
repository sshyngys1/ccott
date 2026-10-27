import { afterEach, expect, it, vi } from "vitest";
import { listenDockDrop } from "./dock";

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
const off = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    listeners.set(name, callback);
    return off;
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  listeners.clear();
  vi.clearAllMocks();
});

it("receives parent-window and webview drops without restricting the event target", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const callback = vi.fn();
  const unsubscribe = await listenDockDrop(callback);
  const { listen } = await import("@tauri-apps/api/event");
  expect(listen).toHaveBeenCalledWith("tauri://drag-drop", expect.any(Function));
  listeners.get("tauri://drag-drop")?.({ payload: { paths: ["C:\\Test.pdf"] } });
  listeners.get("tauri://drag-leave")?.({ payload: null });
  expect(callback.mock.calls).toEqual([
    [{ type: "drop", paths: ["C:\\Test.pdf"] }],
    [{ type: "leave", paths: undefined }],
  ]);
  unsubscribe();
  expect(off).toHaveBeenCalledTimes(4);
});
