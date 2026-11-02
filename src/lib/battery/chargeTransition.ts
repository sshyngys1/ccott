/** Unknown/initial snapshots do not represent plugging in. */
export function chargeTransition(prev: boolean | null | undefined, next: boolean | null): "plug" | "unplug" | null {
  if (prev === false && next === true) return "plug";
  if (prev === true && next === false) return "unplug";
  return null;
}
