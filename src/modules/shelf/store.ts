import { useEffect } from "react";
import { create } from "zustand";
import { invoke } from "../../ipc";
import { localizeMessage, t } from "../../i18n";
import { createEventSync } from "../../lib/ipcSync";
import { useDockStore } from "../../lib/dock/store";
import { requestShell } from "../../shared/shellBus";
import type { ShelfItem } from "../../shared/types";

export const useShelfStore = create<{ items: ShelfItem[]; dropTarget: "pill" | "shelf" | null }>(() => ({ items: [], dropTarget: null }));
// Every request and event advances the same generation. A reply may only apply
// while no newer request, event or subscription lifecycle has superseded it.
let snapshotGeneration = 0;
async function loadSnapshot(load: () => Promise<ShelfItem[]>): Promise<ShelfItem[]> {
  const generation = ++snapshotGeneration;
  const items = await load();
  if (generation === snapshotGeneration) useShelfStore.setState({ items });
  return items;
}
const sync = createEventSync({
  event: "shelf://changed",
  load: () => loadSnapshot(() => invoke("shelf_list")),
  apply: (items, source) => {
    // Initial loads already pass through the same guard as all other replies.
    if (source !== "event") return;
    snapshotGeneration++;
    useShelfStore.setState({ items });
  },
});
function stopSync() { snapshotGeneration++; sync.reset(); }
let consumers = 0;
export function useShelfCount() {
  useEffect(() => {
    consumers++;
    void sync.init();
    return () => { if (--consumers === 0) stopSync(); };
  }, []);
  return useShelfStore(s => s.items.length);
}
export function resetShelfStore() {
  stopSync();
  useShelfStore.setState({ items: [], dropTarget: null });
}
export async function shelfAction<T>(action: () => Promise<T>): Promise<T | undefined> {
  try { return await action(); }
  catch (error) {
    const message = typeof error === "string" ? localizeMessage(error) : error instanceof Error ? localizeMessage(error.message) : t("shelf.error");
    void requestShell({ type: "toast", text: message });
  }
}
export async function refreshShelf() {
  await shelfAction(() => loadSnapshot(() => invoke("shelf_list")));
}
export async function addShelfPaths(paths: string[]) {
  if (paths.length) await shelfAction(() => loadSnapshot(() => invoke("shelf_add", { paths })));
}
export async function removeShelfItems(ids: string[]) {
  await shelfAction(() => loadSnapshot(() => invoke("shelf_remove", { ids })));
}
export async function clearShelf() {
  await shelfAction(() => loadSnapshot(() => invoke("shelf_clear")));
}
export async function openShelfItem(id: string, mode: "open" | "reveal") {
  await shelfAction(() => invoke("shelf_open", { id, mode }));
}
export async function dragShelfItems(ids: string[]) {
  // The shell's existing interaction hold also protects native shelf drags from hover collapse.
  useDockStore.setState({ interacting: true, outgoing: true });
  try { await shelfAction(() => invoke("shelf_start_drag", { ids })); }
  finally { useDockStore.setState({ interacting: false, outgoing: false }); }
}
if (import.meta.hot) import.meta.hot.dispose(resetShelfStore);
