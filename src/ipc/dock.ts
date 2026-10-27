import { invoke, isTauri, type Unlisten } from ".";
import { t } from "../i18n";
export const dockList = () => invoke("dock_list");
export const dockAdd = (paths: string[]) => invoke("dock_add", { paths });
export const dockRemove = (id: string) => invoke("dock_remove", { id });
export const dockReorder = (ids: string[]) => invoke("dock_reorder", { ids });
export const dockOpen = (id: string) => invoke("dock_open", { id });
export const dockStartDrag = (id: string) => invoke("dock_start_drag", { id });
export async function pickDockPaths(directory: boolean): Promise<string[]> {
  if (!isTauri())
    return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const value = await open({ directory, multiple: true, title: t(directory ? "dock.pickFolder" : "dock.pickFile") });
  return value ? typeof value === "string" ? [value] : value : [];
}
export type DockDrop = {
  type: "enter" | "over" | "leave" | "drop";
  paths?: string[];
};
/** Native OLE drops retain full filesystem paths. HTML5 DnD is intentionally not used on Windows. */
export async function listenDockDrop(cb: (event: DockDrop) => void): Promise<Unlisten> {
  if (isTauri()) {
    // Tao's parent HWND and Wry's child HWND emit into different target scopes.
    // A global listener receives both, including a WebView2 child recreated after startup.
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten: Unlisten[] = [];
    try {
      for (const type of ["enter", "over", "leave", "drop"] as const) {
        unlisten.push(await listen<{
          paths?: string[];
        }>(`tauri://drag-${type}`, event => {
          cb({ type, paths: event.payload?.paths });
        }));
      }
    }
    catch (error) {
      unlisten.forEach(off => off());
      throw error;
    }
    return () => unlisten.forEach(off => off());
  }
  const handler = (event: Event) => cb((event as CustomEvent<DockDrop>).detail);
  window.addEventListener("ccott:dock-drop", handler);
  return () => window.removeEventListener("ccott:dock-drop", handler);
}
