import { create } from "zustand";
import type { TranslationKey } from "../../i18n";
import { retainDock, useDockStore } from "../../lib/dock/store";
import type { DockItem } from "../../shared/types";

export type DropChoiceZone = "dock" | "shelf";

export interface DropChoiceState {
  active: boolean;
  hoveredZone: DropChoiceZone | null;
  paths: string[];
}

export const useDropChoiceStore = create<DropChoiceState>(() => ({
  active: false,
  hoveredZone: null,
  paths: [],
}));

let dropChoiceRetainRelease: (() => void) | null = null;

export function startDropChoice(paths: string[] = []): void {
  if (!dropChoiceRetainRelease) {
    dropChoiceRetainRelease = retainDock();
  }
  useDropChoiceStore.setState({ active: true, hoveredZone: null, paths });
  useDockStore.setState({ dragging: true });
}

export function setDropChoiceHover(zone: DropChoiceZone | null): void {
  useDropChoiceStore.setState({ hoveredZone: zone });
}

export function resetDropChoice(): void {
  if (dropChoiceRetainRelease) {
    dropChoiceRetainRelease();
    dropChoiceRetainRelease = null;
  }
  useDropChoiceStore.setState({ active: false, hoveredZone: null, paths: [] });
  useDockStore.setState({ dragging: false });
}

export function checkDockAcceptable(
  paths?: readonly string[],
  items: readonly DockItem[] = useDockStore.getState().items,
): { ok: boolean; reasonKey: TranslationKey | "" } {
  if (items.length >= 12) {
    return { ok: false, reasonKey: "dropChoice.dockFull" };
  }
  if (!paths || paths.length === 0) {
    return { ok: false, reasonKey: "dropChoice.dockIncompatible" };
  }
  const isInvalid = paths.some(p => {
    if (!p || typeof p !== "string") return true;
    if (p.startsWith("http://") || p.startsWith("https://")) return true;
    if (p.includes("\0")) return true;
    const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
    return !isAbs;
  });
  if (isInvalid) {
    return { ok: false, reasonKey: "dropChoice.dockIncompatible" };
  }
  const key = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const existingKeys = new Set(items.map(i => key(i.path)));
  const fresh = paths.filter(p => !existingKeys.has(key(p)));
  if (fresh.length === 0) {
    return { ok: false, reasonKey: "dropChoice.dockDuplicate" };
  }
  if (items.length + fresh.length > 12) {
    return { ok: false, reasonKey: "dropChoice.dockFull" };
  }
  return { ok: true, reasonKey: "" };
}
