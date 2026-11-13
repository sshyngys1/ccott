import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
vi.mock("../ipc", () => ({ listen: (...a: unknown[]) => listenMock(...a), invoke: vi.fn() }));

import { createEventSync, safeListen } from "./ipcSync";

beforeEach(() => {
  listenMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("safeListen", () => {
  it("unsubscribes even when called before the subscription is established", async () => {
    const unlisten = vi.fn();
    let resolve!: (fn: () => void) => void;
    listenMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const stop = safeListen("clipboard://changed", () => {});
    stop();
    resolve(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("a rejected listen is swallowed and reported through onFail", async () => {
    listenMock.mockRejectedValue(new Error("boom"));
    const onFail = vi.fn();
    safeListen("clipboard://changed", () => {}, onFail);
    await new Promise((r) => setTimeout(r, 0));
    expect(onFail).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("createEventSync", () => {
  it("subscribes once and loads once for many init() calls", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const load = vi.fn().mockResolvedValue(1);
    const apply = vi.fn();
    const sync = createEventSync({ event: "audio://changed" as const, load: load as never, apply });
    await Promise.all([sync.init(), sync.init(), sync.init()]);
    await sync.init();
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(1, "load");
  });

  it("an event that arrives during the initial load wins over the load result", async () => {
    let handler: (v: unknown) => void = () => {};
    listenMock.mockImplementation(async (_e: string, cb: (v: unknown) => void) => {
      handler = cb;
      return () => {};
    });
    let finishLoad!: (v: number) => void;
    const load = vi.fn().mockReturnValue(new Promise<number>((r) => (finishLoad = r)));
    const apply = vi.fn();
    const sync = createEventSync({ event: "audio://changed" as const, load: load as never, apply });
    const p = sync.init();
    await Promise.resolve();
    handler(2);
    finishLoad(1);
    await p;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(2, "event");
  });

  it("a failed load is retried on the next init()", async () => {
    listenMock.mockResolvedValue(() => {});
    const load = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(5);
    const apply = vi.fn();
    const sync = createEventSync({ event: "audio://changed" as const, load: load as never, apply });
    await sync.init();
    expect(apply).not.toHaveBeenCalled();
    await sync.init();
    expect(apply).toHaveBeenCalledWith(5, "load");
  });

  it("a failed listen is retried on the next init()", async () => {
    listenMock.mockRejectedValueOnce(new Error("no")).mockResolvedValue(() => {});
    const sync = createEventSync({ event: "audio://changed" as const, load: (async () => 1) as never, apply: () => {} });
    await sync.init();
    await new Promise((r) => setTimeout(r, 0));
    await sync.init();
    expect(listenMock).toHaveBeenCalledTimes(2);
  });

  it("reset() unsubscribes", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const sync = createEventSync({ event: "audio://changed" as const, load: (async () => 1) as never, apply: () => {} });
    await sync.init();
    await Promise.resolve();
    sync.reset();
    expect(unlisten).toHaveBeenCalled();
  });
});
