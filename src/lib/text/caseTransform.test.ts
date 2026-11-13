import { describe, expect, it } from "vitest";
import { toLower, toSentenceCase, toTitleCase, toUpper } from "./caseTransform";

describe("upper / lower", () => {
  it("handles Cyrillic, Latin and ß/ё", () => {
    expect(toUpper("Привет, ёжик hello")).toBe("ПРИВЕТ, ЁЖИК HELLO");
    expect(toLower("ПРИВЕТ, ЁЖИК Hello")).toBe("привет, ёжик hello");
  });
  it("empty", () => {
    expect(toUpper("")).toBe("");
    expect(toLower("")).toBe("");
  });
});

describe("toTitleCase", () => {
  it("capitalises each word and lower-cases the rest", () => {
    expect(toTitleCase("пРИВЕТ мир ТЕСТ")).toBe("Привет Мир Тест");
  });
  it("hyphens, quotes, brackets and new lines start words", () => {
    expect(toTitleCase("северо-запад «рассвет» (тест)\nновая строка")).toBe("Северо-Запад «Рассвет» (Тест)\nНовая Строка");
  });
  it("keeps apostrophes inside a word", () => {
    expect(toTitleCase("don't STOP")).toBe("Don't Stop");
  });
  it("digits are not letters", () => {
    expect(toTitleCase("3 мушкетёра 2x")).toBe("3 Мушкетёра 2x");
  });
  it("empty", () => expect(toTitleCase("")).toBe(""));
});

describe("toSentenceCase", () => {
  it("capitalises the start and each sentence", () => {
    expect(toSentenceCase("ПРИВЕТ. как дела? хорошо! отлично")).toBe("Привет. Как дела? Хорошо! Отлично");
  });
  it("each line starts a sentence", () => {
    expect(toSentenceCase("первая строка\nвторая строка")).toBe("Первая строка\nВторая строка");
  });
  it("skips leading non-letters", () => {
    expect(toSentenceCase("  «привет» мир. 5 яблок")).toBe("  «Привет» мир. 5 Яблок");
  });
  it("does not capitalise after a decimal point", () => {
    expect(toSentenceCase("цена 3.5 рубля")).toBe("Цена 3.5 рубля");
  });
  it("empty", () => expect(toSentenceCase("")).toBe(""));
});
