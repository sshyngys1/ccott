// Case transforms. All of them are locale-independent (no Turkish dotless-i surprises) and keep line breaks.

export const toUpper = (text: string): string => text.toUpperCase();
export const toLower = (text: string): string => text.toLowerCase();

/** «Каждое Слово»: lower-cases everything, then capitalises letters that start a word (after space, hyphen, quote, bracket). */
export function toTitleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-–—"«„“(\[{])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** «Как в предложении»: lower-cases everything, capitalises the first letter of the text, of each line and after . ! ? … */
export function toSentenceCase(text: string): string {
  return text.toLowerCase().replace(/(^|[.!?…]\s+|\n\s*)([^\p{L}\n]*)(\p{L})/gu, (_m, lead: string, mid: string, ch: string) => lead + mid + ch.toUpperCase());
}
