// Owner: F1. Pure tab ordering and visibility logic (contracts §23).
import { movedIds } from "../../lib/dock/store";
import { isModuleEnabled, resetTabFeatures } from "../../lib/features";
import {
  DEFAULT_TAB_ORDER,
  type FeatureId,
  type IslandModule,
  type ModuleId,
  type Settings,
} from "../../shared/types";

const KNOWN_TAB_IDS: ReadonlySet<string> = new Set<string>(DEFAULT_TAB_ORDER);

/**
 * Orders registered modules according to `tabOrder`:
 * - skips unknown or duplicate IDs
 * - appends any missing known IDs at the end in `DEFAULT_TAB_ORDER` order
 */
export function normalizeTabModules(
  modules: readonly IslandModule[],
  tabOrder: readonly (ModuleId | string)[] | null | undefined,
): IslandModule[] {
  const byId = new Map<string, IslandModule>();
  for (const mod of modules) {
    if (mod && typeof mod.id === "string" && KNOWN_TAB_IDS.has(mod.id) && !byId.has(mod.id)) {
      byId.set(mod.id, mod);
    }
  }

  const ordered: IslandModule[] = [];
  const seen = new Set<string>();

  if (Array.isArray(tabOrder)) {
    for (const id of tabOrder) {
      if (typeof id !== "string" || seen.has(id)) continue;
      const mod = byId.get(id);
      if (!mod) continue;
      seen.add(id);
      ordered.push(mod);
    }
  }

  for (const id of DEFAULT_TAB_ORDER) {
    if (seen.has(id)) continue;
    const mod = byId.get(id);
    if (!mod) continue;
    seen.add(id);
    ordered.push(mod);
  }

  return ordered;
}

/**
 * Returns visible tabs in user order:
 * - `"home"` is always visible
 * - other tabs are visible iff their feature is not in `disabledFeatures`
 */
export function orderVisibleTabs(
  modules: readonly IslandModule[],
  tabOrder: readonly (ModuleId | string)[] | null | undefined,
  disabledFeatures: readonly FeatureId[] | null | undefined,
): IslandModule[] {
  const disabled = Array.isArray(disabledFeatures) ? disabledFeatures : [];
  return normalizeTabModules(modules, tabOrder).filter((mod) => isModuleEnabled(mod.id, disabled));
}

/**
 * Returns currently hidden tab modules (for the `+` menu in tab edit mode).
 */
export function getDisabledTabModules(
  modules: readonly IslandModule[],
  tabOrder: readonly (ModuleId | string)[] | null | undefined,
  disabledFeatures: readonly FeatureId[] | null | undefined,
): IslandModule[] {
  const disabled = Array.isArray(disabledFeatures) ? disabledFeatures : [];
  return normalizeTabModules(modules, tabOrder).filter((mod) => !isModuleEnabled(mod.id, disabled));
}

/**
 * Moves `fromId` into `toId`'s slot using the shared `movedIds` helper, preserving hidden tabs' positions.
 */
export function reorderTabOrder(
  modules: readonly IslandModule[],
  tabOrder: readonly (ModuleId | string)[] | null | undefined,
  fromId: ModuleId,
  toId: ModuleId,
): ModuleId[] {
  const normalized = normalizeTabModules(modules, tabOrder);
  return movedIds(normalized, fromId, toId);
}

/**
 * Patch for «Reset» in tab edit mode: restores `DEFAULT_TAB_ORDER` and re-enables all tab features,
 * leaving non-tab disabled features (`dock`, `battery`, `audioMeter`) untouched.
 */
export function resetTabsPatch(
  disabledFeatures: readonly FeatureId[],
): Pick<Settings, "tabOrder" | "disabledFeatures"> {
  return {
    tabOrder: [...DEFAULT_TAB_ORDER],
    disabledFeatures: resetTabFeatures(disabledFeatures),
  };
}
