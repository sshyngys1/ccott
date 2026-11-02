import type { DownloadItem } from "../shared/types";

let items: DownloadItem[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let sequence = 0;
export const mockDownloadOpens: { id: string; mode: "open" | "reveal" }[] = [];
type Emit = (items: DownloadItem[]) => void;

export function resetMockDownloads(): void {
  clearTimeout(timer);
  timer = undefined;
  items = [];
  started = false;
  mockDownloadOpens.length = 0;
}

/** Explicit entry point also lets tests drive the complete simulation with fake timers. */
export function startMockDownload(emit: Emit): void {
  resetMockDownloads();
  started = true;
  const now = Date.now();
  items = [{ id: `mock-download-${++sequence}`, name: "CCOTT-demo.zip", state: "active",
    receivedBytes: 12.4 * 1024 ** 2, totalBytes: null, bytesPerSec: 3.1 * 1024 ** 2, startedAt: now, updatedAt: now }];
  emit(items);
  let ticks = 0;
  const tick = () => {
    ticks++;
    items = items.map((item) => ({ ...item, receivedBytes: item.receivedBytes + 3.1 * 1024 ** 2,
      state: ticks >= 8 ? "done" : "active", bytesPerSec: ticks >= 8 ? null : 3.1 * 1024 ** 2, updatedAt: Date.now() }));
    emit(items);
    timer = setTimeout(ticks >= 8 ? () => { items = []; emit(items); } : tick, ticks >= 8 ? 300_000 : 1000);
  };
  timer = setTimeout(tick, 1000);
}

export function listMockDownloads(enabled: boolean, emit: Emit): DownloadItem[] {
  // The browser demo starts automatically; tests opt in and control its clock explicitly.
  if (enabled && !started && import.meta.env.MODE !== "test") startMockDownload(emit);
  return enabled ? items : [];
}

export function setMockDownloadsEnabled(enabled: boolean, emit: Emit): void {
  resetMockDownloads();
  if (enabled && import.meta.env.MODE !== "test") startMockDownload(emit);
  else emit([]);
}

export function openMockDownload(id: string, mode: "open" | "reveal"): void {
  const item = items.find((item) => item.id === id);
  if (!item) throw new Error("Download is no longer available");
  if (mode === "open" && item.state !== "done") throw new Error("Download is not complete");
  mockDownloadOpens.push({ id, mode });
}
