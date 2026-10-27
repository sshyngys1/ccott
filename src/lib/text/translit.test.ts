import { describe, expect, it } from "vitest";
import { transliterate } from "./translit";

describe("transliterate (RU → Latin)", () => {
  it("basic words", () => {
    expect(transliterate("привет мир")).toBe("privet mir");
    expect(transliterate("Москва")).toBe("Moskva");
  });
  it("multi-letter letters", () => {
    expect(transliterate("жук щука чай шар хор цирк юла яма ёж")).toBe("zhuk shchuka chay shar khor tsirk yula yama yozh");
  });
  it("hard and soft signs are dropped, ы → y, э → e, й → y", () => {
    expect(transliterate("объект мысль эхо май")).toBe("obekt mysl ekho may");
  });
  it("capitalised multi-letter letters: Zh, Shch, Yo", () => {
    expect(transliterate("Жуков Щербаков Ёлкин")).toBe("Zhukov Shcherbakov Yolkin");
  });
  it("all-caps words keep all caps", () => {
    expect(transliterate("ЖУК")).toBe("ZHUK");
    expect(transliterate("ПРИВЕТ ЩУКА")).toBe("PRIVET SHCHUKA");
    expect(transliterate("ЯЮ")).toBe("YAYU");
  });
  it("a lone upper-case letter is capitalised, not shouted", () => {
    expect(transliterate("Я")).toBe("Ya");
    expect(transliterate("Я пришёл")).toBe("Ya prishyol");
  });
  it("leaves Latin, digits, punctuation, emoji and newlines untouched", () => {
    expect(transliterate("Hello, мир! 123 😀\nстрока 2")).toBe("Hello, mir! 123 😀\nstroka 2");
  });
  it("empty string", () => expect(transliterate("")).toBe(""));
  it("full pangram", () => {
    expect(transliterate("Съешь же ещё этих мягких французских булок")).toBe(
      "Sesh zhe eshchyo etikh myagkikh frantsuzskikh bulok",
    );
  });
});
