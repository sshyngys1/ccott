// Owner: motion-fx. Pure logic of the attach wave (AttachWave.tsx). Spec: docs/design-spec.md §9b.2.

/** Ids that a successful dock add put into the dock; `seq` grows by one per add, so the same ids can wave again. */
export type AttachSignal = { ids: string[]; seq: number };

/** Ids present in `after` but not in `before` (a duplicate drop, a removal or a reorder → none). */
export function addedIds(before: readonly { id: string }[], after: readonly { id: string }[]): string[] {
  const known = new Set(before.map((item) => item.id));
  return after.filter((item) => !known.has(item.id)).map((item) => item.id);
}

/** The next signal after an add, or the same one (no wave) when nothing new appeared. */
export function nextAttachSignal(prev: AttachSignal | null, ids: string[]): AttachSignal | null {
  return ids.length ? { ids, seq: (prev?.seq ?? 0) + 1 } : prev;
}

/**
 * The ring as a square box in island coordinates, centred on `origin`. Its radius reaches the farthest island corner
 * plus the band, so at full size the whole band has passed every edge and corner.
 */
export function waveCircle(island: { width: number; height: number }, origin: { x: number; y: number }, band: number) {
  const dx = Math.max(origin.x, island.width - origin.x);
  const dy = Math.max(origin.y, island.height - origin.y);
  const radius = Math.ceil(Math.hypot(dx, dy) + band);
  return { left: origin.x - radius, top: origin.y - radius, size: radius * 2 };
}

/** The island has (nearly) reached the panel size, so the wave can start. An unknown panel width never blocks. */
export function islandReady(width: number, panelWidth: number, ratio: number): boolean {
  return !(panelWidth > 0) || width >= panelWidth * ratio;
}
