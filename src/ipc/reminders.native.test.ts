import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "./index";

const native = vi.hoisted(() => ({ stop: vi.fn(), listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen, emit: native.emit }));
beforeEach(() => {
  native.stop.mockReset(); native.listen.mockReset().mockResolvedValue(native.stop);
  native.emit.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });

it("installs due listener before allowing startup delivery; pagehide/cleanup stop exactly once", async () => {
  const stop = await listen("reminders://due", () => {});
  expect(native.listen).toHaveBeenCalledWith("reminders://due", expect.any(Function));
  expect(native.listen.mock.invocationCallOrder[0]).toBeLessThan(native.emit.mock.invocationCallOrder[0]);
  const subscription = native.emit.mock.calls[0][1];
  expect(native.emit).toHaveBeenCalledWith("reminders://subscription", { token: expect.any(String), active: true });
  window.dispatchEvent(new Event("pagehide")); stop(); stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(native.emit).toHaveBeenLastCalledWith("reminders://subscription", { token: subscription.token, active: false });
  expect(native.emit).toHaveBeenCalledTimes(2);
});
it("a failed ready signal releases the installed due listener", async () => {
  native.emit.mockRejectedValueOnce(new Error("IPC failed"));
  await expect(listen("reminders://due", () => {})).rejects.toThrow("IPC failed");
  expect(native.stop).toHaveBeenCalledTimes(1);
});
it("list updates alone do not acquire the timer", async () => {
  const stop = await listen("reminders://changed", () => {});
  expect(native.emit).not.toHaveBeenCalled(); stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
});
