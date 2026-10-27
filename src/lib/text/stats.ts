import { countText } from "../../i18n";

export interface TextStats {
  /** Visible characters (grapheme clusters: an emoji with modifiers counts as one). */
  chars: number;
  /** Runs of non-space characters that contain a letter or a digit. */
  words: number;
  /** Lines; an empty text has 0. */
  lines: number;
}

type SegmenterCtor = new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<unknown> };

function countChars(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Seg) {
    let n = 0;
    for (const _ of new Seg(undefined, { granularity: "grapheme" }).segment(text)) {
      void _;
      n++;
    }
    return n;
  }
  return Array.from(text).length;
}

export function textStats(text: string): TextStats {
  if (!text) return { chars: 0, words: 0, lines: 0 };
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return { chars: countChars(text), words, lines: text.split(/\r\n|\r|\n/).length };
}

/** «75 символов · 11 слов · 2 строки» */
export function formatStats({ chars, words, lines }: TextStats): string {
  return [countText(chars, "chars"), countText(words, "words"), countText(lines, "lines")].join(" · ");
}
