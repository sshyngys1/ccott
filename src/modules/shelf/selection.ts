export function selectShelfItem(ids: readonly string[], selected: readonly string[], id: string, anchor: string | null, ctrl: boolean, shift: boolean): string[] {
  if (shift && anchor && ids.includes(anchor)) {
    const a = ids.indexOf(anchor), b = ids.indexOf(id);
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    return ctrl ? [...new Set([...selected, ...range])] : range;
  }
  return ctrl ? selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id] : [id];
}
