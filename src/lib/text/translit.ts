// Transliteration RU → Latin.
//
// Scheme: a readable variant of GOST 7.79-2000 (system B) / BGN-PCGN, without diacritics and without apostrophes:
//   а a · б b · в v · г g · д d · е e · ё yo · ж zh · з z · и i · й y · к k · л l · м m · н n · о o · п p · р r
//   с s · т t · у u · ф f · х kh · ц ts · ч ch · ш sh · щ shch · ъ (dropped) · ы y · ь (dropped) · э e · ю yu · я ya
// Unlike strict GOST system B the "j", "x", "cz", "shh", "`" forms are avoided, so «Щука» reads «Shchuka».
// Case: a multi-letter result keeps the capital only on its first letter («Ж» → «Zh»); it becomes all-caps when the
// neighbouring Cyrillic letter is also upper case («ЖУК» → «ZHUK»). Everything that is not Russian stays as is.

const MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const isCyrLetter = (ch: string | undefined): boolean => !!ch && /[а-яё]/i.test(ch);
const isUpper = (ch: string): boolean => ch !== ch.toLowerCase();

export function transliterate(text: string): string {
  const chars = Array.from(text);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const latin = MAP[lower];
    if (latin === undefined) {
      out += ch;
      continue;
    }
    if (!isUpper(ch) || latin === "") {
      out += latin;
      continue;
    }
    if (latin.length === 1) {
      out += latin.toUpperCase();
      continue;
    }
    // Multi-letter output of an upper-case letter: «Zh» in «Жук», «ZH» in «ЖУК» / «ЖК».
    const next = chars[i + 1];
    const prev = chars[i - 1];
    const shout = (isCyrLetter(next) && isUpper(next)) || (isCyrLetter(prev) && isUpper(prev));
    out += shout ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
  }
  return out;
}
