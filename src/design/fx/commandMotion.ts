import { durations } from "../motion";

/** Result delays are bounded so long lists never trail behind typing. Seconds for Motion. */
export function resultDelay(index: number): number {
  return Math.min(12, Math.max(0, Math.floor(index))) * durations.resultStagger;
}
