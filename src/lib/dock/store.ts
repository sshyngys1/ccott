import { create } from "zustand";
import { localizeMessage, t } from "../../i18n";
import { dockAdd, dockList, dockOpen, dockRemove, dockReorder, dockStartDrag, pickDockPaths } from "../../ipc/dock";
import type { DockItem } from "../../shared/types";
import { requestShell } from "../../shared/shellBus";
import { createEventSync } from "../ipcSync";
export const useDockStore = create<{
  items: DockItem[];
  dragging: boolean;
  interacting: boolean;
  outgoing: boolean;
}>(() => ({ items: [], dragging: false, interacting: false, outgoing: false }));
const sync = createEventSync({ event: "dock://changed", load: dockList, apply: items => useDockStore.setState({ items }) });
export const initDock = () => sync.init();
export function resetDockStore() {
  sync.reset();
  useDockStore.setState({ items: [], dragging: false, interacting: false, outgoing: false });
}
function errorMessage(error: unknown) {
  return error instanceof Error ? localizeMessage(error.message) : typeof error === "string" ? localizeMessage(error) : t("dock.error");
}
async function change(action: () => Promise<DockItem[]>) {
  try {
    const items = await action();
    useDockStore.setState({ items });
  }
  catch (error) {
    await requestShell({ type: "toast", text: errorMessage(error) });
  }
}
export const addDockPaths = (paths: string[]) => paths.length ? change(() => dockAdd(paths)) : Promise.resolve();
export const removeDockItem = (id: string) => change(() => dockRemove(id));
export const reorderDock = (ids: string[]) => change(() => dockReorder(ids));
export async function openDockItem(id: string) {
  await requestShell({ type: "collapse" });
  try {
    await dockOpen(id);
  }
  catch (error) {
    await requestShell({ type: "toast", text: errorMessage(error) });
  }
}
export async function chooseDockItems(directory: boolean) {
  useDockStore.setState({ interacting: true });
  try {
    await addDockPaths(await pickDockPaths(directory));
  }
  catch (error) {
    await requestShell({ type: "toast", text: errorMessage(error) });
  }
  finally {
    useDockStore.setState({ interacting: false });
  }
}
export async function dragDockItem(id: string) {
  useDockStore.setState({ interacting: true, outgoing: true });
  try {
    await dockStartDrag(id);
  }
  catch (error) {
    await requestShell({ type: "toast", text: errorMessage(error) });
  }
  finally {
    useDockStore.setState({ interacting: false, outgoing: false });
  }
}
/** Move one entry into another entry's slot, preserving every other id. */
export function movedIds(items: DockItem[], from: string, to: string): string[] {
  const ids = items.map(i => i.id), a = ids.indexOf(from), b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b)
    return ids;
  ids.splice(b, 0, ids.splice(a, 1)[0]);
  return ids;
}
