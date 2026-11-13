import { describe, expect, it } from "vitest";
import { formatStats, textStats } from "./stats";

describe("textStats", () => {
  it("empty text is all zeros", () => expect(textStats("")).toEqual({ chars: 0, words: 0, lines: 0 }));
  it("counts chars, words and lines", () => {
    expect(textStats("Привет мир\nвторая строка")).toEqual({ chars: 24, words: 4, lines: 2 });
  });
  it("whitespace-only text has chars and lines but no words", () => {
    expect(textStats("  \n ")).toEqual({ chars: 4, words: 0, lines: 2 });
  });
  it("punctuation alone is not a word", () => {
    expect(textStats("a - b — c !")).toMatchObject({ words: 3 });
  });
  it("emoji count as one character", () => {
    expect(textStats("😀").chars).toBe(1);
    expect(textStats("👨‍👩‍👧").chars).toBe(1);
  });
  it("CRLF is one line break", () => {
    expect(textStats("a\r\nb\r\nc").lines).toBe(3);
  });
  it("a trailing newline starts a new (empty) line, like in a textarea", () => {
    expect(textStats("a\n").lines).toBe(2);
  });
});

describe("formatStats", () => {
  it("uses Russian plural forms", () => {
    expect(formatStats({ chars: 1, words: 1, lines: 1 })).toBe("1 символ · 1 слово · 1 строка");
    expect(formatStats({ chars: 2, words: 3, lines: 4 })).toBe("2 символа · 3 слова · 4 строки");
    expect(formatStats({ chars: 75, words: 11, lines: 5 })).toBe("75 символов · 11 слов · 5 строк");
    expect(formatStats({ chars: 0, words: 0, lines: 0 })).toBe("0 символов · 0 слов · 0 строк");
  });
});
