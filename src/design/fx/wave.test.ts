import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { addDockPaths, initDock, removeDockItem, reorderDock, resetDockStore, useDockStore } from "../../lib/dock/store";
import { attachWave } from "../motion";
import { addedIds, islandReady, nextAttachSignal, waveCircle } from "./wave";

describe("wave logic", () => {
  it("addedIds lists only entries that were not there before", () => {
    expect(addedIds([{ id: "a" }], [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["b", "c"]);
    expect(addedIds([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }])).toEqual([]);
    expect(addedIds([{ id: "a" }, { id: "b" }], [{ id: "a" }])).toEqual([]);
  });

  it("nextAttachSignal bumps seq on new ids and keeps the old signal otherwise", () => {
    const first = nextAttachSignal(null, ["x"]);
    expect(first).toEqual({ ids: ["x"], seq: 1 });
    expect(nextAttachSignal(first, [])).toBe(first);
    expect(nextAttachSignal(first, ["y", "z"])).toEqual({ ids: ["y", "z"], seq: 2 });
  });

  it("the ring reaches every corner of the island plus the band", () => {
    const island = { width: 720, height: 396 };
    const origin = { x: 40, y: 370 };
    const { left, top, size } = waveCircle(island, origin, attachWave.band);
    const r = size / 2;
    expect(left + r).toBe(origin.x);
    expect(top + r).toBe(origin.y);
    for (const [x, y] of [[0, 0], [720, 0], [0, 396], [720, 396]]) expect(r - Math.hypot(x - origin.x, y - origin.y)).toBeGreaterThanOrEqual(attachWave.band);
  });

  it("waits for the island to open, never blocks on an unknown panel width", () => {
    expect(islandReady(300, 720, 0.92)).toBe(false);
    expect(islandReady(700, 720, 0.92)).toBe(true);
    expect(islandReady(100, 0, 0.92)).toBe(true);
  });

  it("timings stay in the brief: 700–900 ms, 48–80 px band, opacity ≤ 0.35", () => {
    expect(attachWave.duration).toBeGreaterThanOrEqual(0.7);
    expect(attachWave.duration).toBeLessThanOrEqual(0.9);
    expect(attachWave.band).toBeGreaterThanOrEqual(48);
    expect(attachWave.band).toBeLessThanOrEqual(80);
    expect(attachWave.peakOpacity).toBeLessThanOrEqual(0.35);
    expect(attachWave.pop.scale).toEqual([0.6, 1.08, 1]);
  });
});

describe("dock store signal", () => {
  beforeEach(async () => {
    resetMock();
    resetDockStore();
    await initDock();
  });
  afterEach(() => {
    resetDockStore();
    vi.restoreAllMocks();
  });

  it("a new entry raises lastAdded with its id", async () => {
    await addDockPaths(["C:\\New folder"]);
    const { items, lastAdded } = useDockStore.getState();
    expect(lastAdded?.seq).toBe(1);
    expect(lastAdded?.ids).toEqual([items[items.length - 1].id]);
  });

  it("several files in one drop → one signal with all new ids", async () => {
    await addDockPaths(["C:\\One", "C:\\Two"]);
    expect(useDockStore.getState().lastAdded).toMatchObject({ seq: 1, ids: expect.arrayContaining([expect.any(String), expect.any(String)]) });
    expect(useDockStore.getState().lastAdded?.ids).toHaveLength(2);
  });

  it("a duplicate drop, a removal, a reorder and an error raise nothing", async () => {
    await addDockPaths(["C:\\New folder"]);
    const signal = useDockStore.getState().lastAdded;
    await addDockPaths(["C:\\New folder"]);
    expect(useDockStore.getState().lastAdded).toBe(signal);
    const ids = useDockStore.getState().items.map((i) => i.id);
    await removeDockItem(ids[0]);
    await reorderDock(useDockStore.getState().items.map((i) => i.id).reverse());
    expect(useDockStore.getState().lastAdded).toBe(signal);
    // the mock refuses more than 12 entries
    for (let i = 0; i < 12; i++) await invoke("dock_add", { paths: [`C:\\Fill ${i}`] }).catch(() => {});
    await initDock();
    const before = useDockStore.getState().lastAdded;
    await addDockPaths(["C:\\Too many"]);
    expect(useDockStore.getState().lastAdded).toBe(before);
  });
});
