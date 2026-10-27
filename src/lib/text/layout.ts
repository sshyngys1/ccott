// Keyboard layout fixer: ЙЦУКЕН ⇄ QWERTY by *physical key position* (standard Windows «Русская» layout).
// Text typed in the wrong layout "Ghbdtn" ⇄ "Привет". Letters and punctuation map key-for-key:
//   EN ` ~ @ # $ ^ & [ ] { } ; : ' " , . / ? < >   ⇄   RU ё Ё " № ; : ? х ъ Х Ъ ж Ж э Э б ю . , Б Ю
// Caveat (inherent to the key-position approach): a punctuation mark typed *on purpose* in the right layout is converted
// as a key too ("Привет, мир." → "Ghbdtn? vbh/"), exactly like a user typing the same keys in the other layout.

export type LayoutDirection = "ru-en" | "en-ru";

const EN_LOWER = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RU_LOWER = "ёйцукенгшщзхъфывапролджэячсмитьбю.";
const EN_UPPER = "~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?";
const RU_UPPER = "ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";

// [EN, RU] pairs by key position, then number-row punctuation that differs between layouts, then the backslash key.
const PAIRS: Array<[string, string]> = [];
const en = [...EN_LOWER, ...EN_UPPER];
const ru = [...RU_LOWER, ...RU_UPPER];
for (let i = 0; i < en.length; i++) PAIRS.push([en[i], ru[i]]);
PAIRS.push(["@", '"'], ["#", "№"], ["$", ";"], ["^", ":"], ["&", "?"], ["|", "/"]);

const EN_TO_RU = new Map<string, string>();
const RU_TO_EN = new Map<string, string>();
for (const [e, r] of PAIRS) {
  EN_TO_RU.set(e, r);
  RU_TO_EN.set(r, e);
}
// RU "." is the "/" key and RU "," is Shift+"/" ("?"): the EN "." and "," keys are the letters ю and б. The shared
// glyphs below are pinned explicitly so the reverse table never depends on the order of the pairs above.
RU_TO_EN.set(".", "/");
RU_TO_EN.set(",", "?");
RU_TO_EN.set("?", "&");
RU_TO_EN.set(";", "$");
RU_TO_EN.set(":", "^");
RU_TO_EN.set('"', "@");
RU_TO_EN.set("/", "|");

const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[A-Za-z]/g;

/** Decide which way to convert: more Cyrillic letters than Latin → RU→EN, otherwise EN→RU. */
export function detectLayoutDirection(text: string): LayoutDirection {
  const cyr = text.match(CYRILLIC)?.length ?? 0;
  const lat = text.match(LATIN)?.length ?? 0;
  return cyr > lat ? "ru-en" : "en-ru";
}

export interface LayoutResult {
  text: string;
  direction: LayoutDirection;
}

/** Convert text typed in the wrong layout. `direction` omitted → auto-detected from the letters. */
export function convertLayout(text: string, direction: LayoutDirection = detectLayoutDirection(text)): LayoutResult {
  const table = direction === "ru-en" ? RU_TO_EN : EN_TO_RU;
  let out = "";
  for (const ch of text) out += table.get(ch) ?? ch;
  return { text: out, direction };
}
