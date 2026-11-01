import { create } from "zustand";
import { localizeMessage, t } from "../../i18n";
import { dockAdd, dockList, dockOpen, dockRemove, dockReorder, dockStartDrag, pickDockPaths } from "../../ipc/dock";
import type { DockItem } from "../../shared/types";
import { requestShell } from "../../shared/shellBus";
import { createEventSync } from "../ipcSync";
import { addedIds, nextAttachSignal, type AttachSignal } from "../../design/fx/wave";

export const useDockStore = create<{
  items: DockItem[];
  dragging: boolean;
  interacting: boolean;
  outgoing: boolean;
  /** fx: entries the last successful add put into the dock (drives the attach wave, src/design/fx/AttachWave.tsx). */
  lastAdded: AttachSignal | null;
}>(() => ({ items: [], dragging: false, interacting: false, outgoing: false, lastAdded: null }));

const sync = createEventSync({ event: "dock://changed", load: dockList, apply: items => useDockStore.setState({ items }) });

export const initDock = () => sync.init();

export function resetDockStore() {
  sync.reset();
  useDockStore.setState({ items: [], dragging: false, interacting: false, outgoing: false, lastAdded: null });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? localizeMessage(error.message) : typeof error === "string" ? localizeMessage(error) : t("dock.error");
}

async function change(action: () => Promise<DockItem[]>, signalAdded = false) {
  const before = useDockStore.getState().items;
  try {
    const items = await action();
    const lastAdded = signalAdded ? nextAttachSignal(useDockStore.getState().lastAdded, addedIds(before, items)) : useDockStore.getState().lastAdded;
    useDockStore.setState({ items, lastAdded });
  }
  catch (error) {
    await requestShell({ type: "toast", text: errorMessage(error) });
  }
}

export const addDockPaths = (paths: string[]) => paths.length ? change(() => dockAdd(paths), true) : Promise.resolve();

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
  const ids = items.map(item => item.id);
  const fromIndex = ids.indexOf(from);
  const toIndex = ids.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
    return ids;
  ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
  return ids;
}
