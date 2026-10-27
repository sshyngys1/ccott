// Owner: F1. Picks which module's live activity (`compact`) is shown inside the collapsed pill.
import type { IslandModule } from "../shared/types";

/** Pure: among modules whose compact activity is active, the highest `priority` wins (ties → lower `order`). */
export function pickCompact(modules: readonly IslandModule[], active: readonly boolean[]): IslandModule | null {
  let best: IslandModule | null = null;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    if (!m.compact || !active[i]) continue;
    const bestPriority: number = best?.compact?.priority ?? Number.NEGATIVE_INFINITY;
    if (m.compact.priority > bestPriority || (best && m.compact.priority === bestPriority && m.order < best.order)) {
      best = m;
    }
  }
  return best;
}

/**
 * Calls every module's `useIsActive` hook. `modules` must be a stable, module-level list (like the registry):
 * the number and order of hook calls never changes between renders.
 */
export function useActiveCompact(modules: readonly IslandModule[]): IslandModule | null {
  const active: boolean[] = [];
  for (const m of modules) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- static list, stable call order
    active.push(m.compact ? m.compact.useIsActive() : false);
  }
  return pickCompact(modules, active);
}
