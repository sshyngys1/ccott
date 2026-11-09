import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "./index";

const native = vi.hoisted(() => ({ stop: vi.fn(), listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen, emit: native.emit }));

beforeEach(() => {
  native.stop.mockReset();
  native.listen.mockReset().mockResolvedValue(native.stop);
  native.emit.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });

it("registers listener before acquiring the native watch and releases it exactly once", async () => {
  const stop = await listen("control://changed", () => {});
  expect(native.listen).toHaveBeenCalledWith("control://changed", expect.any(Function));
  const subscription = native.emit.mock.calls[0][1];
  expect(subscription).toEqual({ token: expect.any(String), active: true });
  expect(native.listen.mock.invocationCallOrder[0]).toBeLessThan(native.emit.mock.invocationCallOrder[0]);
  stop(); stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(native.emit).toHaveBeenLastCalledWith("control://subscription", { token: subscription.token, active: false });
  expect(native.emit).toHaveBeenCalledTimes(2);
});

it("pagehide releases the watch and later React cleanup remains idempotent", async () => {
  const stop = await listen("control://changed", () => {});
  window.dispatchEvent(new Event("pagehide"));
  stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(native.emit).toHaveBeenCalledTimes(2);
  expect(native.emit.mock.calls[1][1].active).toBe(false);
});

it("failed subscription closes the already installed native listener", async () => {
  native.emit.mockRejectedValueOnce(new Error("IPC failed"));
  await expect(listen("control://changed", () => {})).rejects.toThrow("IPC failed");
  expect(native.stop).toHaveBeenCalledTimes(1);
});

it("other event subscriptions do not start control polling", async () => {
  const stop = await listen("settings://changed", () => {});
  expect(native.emit).not.toHaveBeenCalled();
  stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
});
