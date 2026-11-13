import { useEffect } from "react";
import { create } from "zustand";
import { t } from "../../i18n";
import { invoke } from "../../ipc";
import { requestShell } from "../../shared/shellBus";
import type { DownloadItem } from "../../shared/types";
import { createEventSync } from "../ipcSync";

export const DOWNLOADS_PRIORITY = 15; // media = 10, timer = 20
export const useDownloadsStore = create<{ items: DownloadItem[] }>()(() => ({ items: [] }));
let completed = new Set<string>();

export async function openDownload(id: string, mode: "open" | "reveal"): Promise<void> {
  try {
    await invoke("downloads_open", { id, mode });
  } catch (error) {
    console.warn("[island] downloads_open failed", error);
    void requestShell({ type: "toast", text: t("downloads.openFailed") });
  }
}

const sync = createEventSync({
  event: "downloads://changed",
  load: () => invoke("downloads_list"),
  apply: (items, source) => {
    for (const item of items) {
      if (item.state === "done" && !completed.has(item.id) && source === "event") {
        void requestShell({
          type: "toast",
          text: t("downloads.done", { name: item.name || t("downloads.loading") }),
          actions: [
            { label: t("downloads.open"), icon: "file", onClick: () => { void openDownload(item.id, "open"); } },
            { label: t("downloads.reveal"), icon: "folder", onClick: () => { void openDownload(item.id, "reveal"); } },
          ],
        });
      }
    }
    completed = new Set(items.filter((item) => item.state === "done").map((item) => item.id));
    useDownloadsStore.setState({ items });
  },
});

export const initDownloads = () => sync.init();
let consumers = 0;

export function useDownloadsActive(): boolean {
  useEffect(() => {
    consumers++;
    void initDownloads();
    return () => { if (--consumers === 0) sync.reset(); };
  }, []);
  return useDownloadsStore((s) => s.items.some((item) => item.state === "active"));
}

export function resetDownloadsStore(): void {
  sync.reset();
  completed.clear();
  useDownloadsStore.setState({ items: [] });
}
if (import.meta.hot) import.meta.hot.dispose(resetDownloadsStore);
