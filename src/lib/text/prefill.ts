import type { ClipItem } from "../../shared/types";

/** The clipboard is offered to the «Текст» tab only if the text was copied just now. */
export const PREFILL_MAX_AGE_MS = 2 * 60_000;
/** Longer texts are not pulled in automatically (the textarea would become sluggish). */
export const PREFILL_MAX_LENGTH = 20_000;

/** Same password/token heuristic as the pill, kept within F2's pure logic boundary. */
export function isSecretText(text: string): boolean {
  if (text.length < 8 || text.length > 256 || /\s/u.test(text)) return false;
  const length = [...text].length;
  return length >= 8 && length <= 128 && [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}\s]/u].filter((pattern) => pattern.test(text)).length >= 3;
}

/** Newest plain-text clip (not a link / image / files) that is fresh enough, or null. */
export function pickPrefill(items: readonly ClipItem[], now: number): string | null {
  let best: ClipItem | null = null;
  for (const c of items) {
    if (c.kind !== "text" || !c.text.trim() || c.text.length > PREFILL_MAX_LENGTH) continue;
    if (now < c.createdAt || now - c.createdAt > PREFILL_MAX_AGE_MS || isSecretText(c.text)) continue;
    if (!best || c.createdAt > best.createdAt) best = c;
  }
  return best ? best.text : null;
}
