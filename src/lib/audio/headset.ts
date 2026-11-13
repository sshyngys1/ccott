import type { AudioDevice } from "../../shared/types";

/** Name-only fallback until the contract exposes output transport/category. */
export function isHeadsetName(name: string): boolean {
  return /bluetooth|\bbt\b|airpods|buds|headset|headphones|hands[ -]?free|наушники|гарнитура|\b(?:wh|wf)-|\bjbl\b/i.test(name);
}

/** undefined means no baseline yet; null means a known missing output. */
export function detectHeadsetConnect(prev: AudioDevice | null | undefined, next: AudioDevice | null): AudioDevice | null {
  if (prev === undefined || !next?.isDefault || (prev?.id === next.id && prev.isDefault)) return null;
  return isHeadsetName(next.name) ? next : null;
}
