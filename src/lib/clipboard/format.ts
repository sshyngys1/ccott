import { t, countText } from "../../i18n";
// Presentation helpers for clipboard rows (spec §6.4). Pure.
import type { ClipItem } from "../../shared/types";
import { formatRelativeTime } from "../time/format";

const APP_NAMES: Record<string, string> = {
  get explorer() { return t("fileExplorer"); },
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  get windowsterminal() { return t("terminal"); },
  code: "VS Code",
  get notepad() { return t("notepad"); },
  get snippingtool() { return t("snippingTool"); },
  get screenclippinghost() { return t("snippingTool"); },
  winword: "Word",
  excel: "Excel",
  powerpnt: "PowerPoint",
  telegram: "Telegram",
};

/** «Telegram.exe» → «Telegram», «explorer.exe» → «Проводник». */
export function appLabel(sourceApp: string): string {
  const base = sourceApp.replace(/\.exe$/i, "").trim();
  if (!base) return "";
  return APP_NAMES[base.toLowerCase()] ?? base;
}

const SCREENSHOT_APPS = new Set(["snippingtool", "screenclippinghost", "sharex", "lightshot", "greenshot"]);

/** Row title: the preview collapsed to a single line; images get a generic caption. */
export function clipTitle(item: ClipItem): string {
  if (item.kind === "image") {
    return SCREENSHOT_APPS.has(item.sourceApp.replace(/\.exe$/i, "").toLowerCase()) ? t("screenshot") : t("image");
  }
  const line = item.preview.replace(/\s+/g, " ").trim();
  return line || (item.kind === "files" ? t("files") : t("emptyEntry"));
}

/** Number of files in a `files` item (`text` is newline-joined paths). */
export function fileCount(item: ClipItem): number {
  return item.text.split(/\r?\n/).filter((l) => l.trim()).length;
}

/** Meta line: «3 файла · Проводник · 5 мин назад», «Telegram · вчера». */
export function clipMeta(item: ClipItem, now: number): string {
  const parts: string[] = [];
  if (item.kind === "files") {
    const n = fileCount(item);
    if (n > 0) parts.push(countText(n, "files"));
  }
  const app = appLabel(item.sourceApp);
  if (app) parts.push(app);
  parts.push(formatRelativeTime(item.createdAt, now));
  return parts.join(" · ");
}

/** Pinned first (spec §6.4), the rest keep the backend order (newest first). */
export function groupClips(items: readonly ClipItem[]): { pinned: ClipItem[]; recent: ClipItem[]; ordered: ClipItem[] } {
  const pinned = items.filter((c) => c.pinned);
  const recent = items.filter((c) => !c.pinned);
  return { pinned, recent, ordered: [...pinned, ...recent] };
}

/** Index of the keyboard cursor: the item with `cursorId`, otherwise the first one (spec: the cursor starts on the first row). */
export function cursorIndex(ordered: readonly ClipItem[], cursorId: number | null): number {
  if (ordered.length === 0) return -1;
  const i = cursorId === null ? -1 : ordered.findIndex((c) => c.id === cursorId);
  return i === -1 ? 0 : i;
}

/** Id of the item `delta` rows away from the cursor, clamped to the list. */
export function moveCursor(ordered: readonly ClipItem[], cursorId: number | null, delta: number): number | null {
  if (ordered.length === 0) return null;
  const i = Math.min(ordered.length - 1, Math.max(0, cursorIndex(ordered, cursorId) + delta));
  return ordered[i].id;
}

/** After the item under the cursor disappears, the cursor goes to its neighbour (next, else previous). */
export function cursorAfterRemoval(ordered: readonly ClipItem[], removedId: number): number | null {
  const i = ordered.findIndex((c) => c.id === removedId);
  if (i === -1) return null;
  return (ordered[i + 1] ?? ordered[i - 1])?.id ?? null;
}
