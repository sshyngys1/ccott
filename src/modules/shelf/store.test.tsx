import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockListenerCount, resetMock } from "../../ipc/mock";
import type { ShelfItem } from "../../shared/types";
import { addShelfPaths, clearShelf, dragShelfItems, refreshShelf, removeShelfItems, resetShelfStore, useShelfCount, useShelfStore } from "./store";

beforeEach(() => { resetMock(); resetShelfStore(); });
afterEach(() => { resetShelfStore(); vi.restoreAllMocks(); });

function Host() { return <span data-testid="count">{useShelfCount()}</span>; }
function deferredSnapshot() {
  let resolve!: (items: ShelfItem[]) => void;
  const promise = new Promise<ShelfItem[]>(done => { resolve = done; });
  return { promise, resolve };
}

it.each(["clear", "drag"] as const)("initial list cannot overwrite a newer %s event", async change => {
  const old = await ipc.invoke("shelf_list");
  const deferred = deferredSnapshot();
  vi.spyOn(ipc, "invoke").mockReturnValueOnce(deferred.promise);
  render(<Host />);
  await waitFor(() => expect(mockListenerCount("shelf://changed")).toBe(1));
  await act(async () => { if (change === "clear") await clearShelf(); else await dragShelfItems([old[0].id]); });
  const current = useShelfStore.getState().items;
  expect(current).toHaveLength(change === "clear" ? 0 : 3);
  await act(async () => { deferred.resolve(old); await deferred.promise; });
  expect(useShelfStore.getState().items).toEqual(current);
  expect(screen.getByTestId("count")).toHaveTextContent(String(current.length));
});

const requests = [
  ["list", refreshShelf],
  ["add", () => addShelfPaths(["C:\\New.txt"])],
  ["remove", () => removeShelfItems(["shelf-4"])],
  ["clear", clearShelf],
] as const;

it.each(requests.flatMap(([name, request]) => (["clear", "drag"] as const).map(change => ({ name, request, change }))))(
  "late $name response cannot overwrite a newer $change event", async ({ request, change }) => {
    render(<Host />);
    await waitFor(() => expect(useShelfStore.getState().items).toHaveLength(4));
    const old = useShelfStore.getState().items;
    const deferred = deferredSnapshot();
    vi.spyOn(ipc, "invoke").mockReturnValueOnce(deferred.promise);
    const pending = request();
    await act(async () => { if (change === "clear") await clearShelf(); else await dragShelfItems([old[0].id]); });
    const current = useShelfStore.getState().items;
    expect(current).toHaveLength(change === "clear" ? 0 : 3);
    await act(async () => { deferred.resolve(old); await pending; });
    expect(useShelfStore.getState().items).toEqual(current);
    expect(screen.getByTestId("count")).toHaveTextContent(String(current.length));
  },
);

it("newer replies win without events, and reset invalidates outstanding replies", async () => {
  const old = await ipc.invoke("shelf_list");
  const first = deferredSnapshot();
  const second = deferredSnapshot();
  vi.spyOn(ipc, "invoke").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const pendingFirst = refreshShelf();
  const pendingSecond = refreshShelf();
  second.resolve(old.slice(1)); await pendingSecond;
  first.resolve(old); await pendingFirst;
  expect(useShelfStore.getState().items).toEqual(old.slice(1));
  const last = deferredSnapshot();
  vi.spyOn(ipc, "invoke").mockReturnValueOnce(last.promise);
  const pendingLast = refreshShelf();
  resetShelfStore();
  last.resolve(old); await pendingLast;
  expect(useShelfStore.getState().items).toEqual([]);
});
