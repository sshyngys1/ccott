import { describe, expect, it } from "vitest";
import { convertLayout, detectLayoutDirection } from "./layout";

describe("detectLayoutDirection", () => {
  it("Latin gibberish → en-ru", () => expect(detectLayoutDirection("Ghbdtn vbh")).toBe("en-ru"));
  it("Cyrillic → ru-en", () => expect(detectLayoutDirection("Руддщ цщкдв")).toBe("ru-en"));
  it("empty / digits only → en-ru (default)", () => {
    expect(detectLayoutDirection("")).toBe("en-ru");
    expect(detectLayoutDirection("12345")).toBe("en-ru");
  });
  it("mixed: the majority wins", () => {
    expect(detectLayoutDirection("Привет hello мир")).toBe("ru-en");
    expect(detectLayoutDirection("Привет hello world")).toBe("en-ru");
  });
});

describe("convertLayout", () => {
  it("EN → RU letters", () => {
    expect(convertLayout("Ghbdtn vbh").text).toBe("Привет мир");
    expect(convertLayout("ghbdtn").direction).toBe("en-ru");
  });
  it("RU → EN letters (auto)", () => {
    const r = convertLayout("Руддщ цщкдв");
    expect(r.text).toBe("Hello world");
    expect(r.direction).toBe("ru-en");
  });
  it("punctuation keys EN → RU", () => {
    expect(convertLayout("[];',./`").text).toBe("хъжэбю.ё");
    expect(convertLayout("{}:\"<>?~").text).toBe("ХЪЖЭБЮ,Ё");
  });
  it("punctuation keys RU → EN", () => {
    expect(convertLayout("хъжэбю.ё", "ru-en").text).toBe("[];',./`");
    expect(convertLayout("ХЪЖЭБЮ,Ё", "ru-en").text).toBe("{}:\"<>?~");
  });
  it("number-row shifted punctuation differs between layouts", () => {
    expect(convertLayout("@#$^&", "en-ru").text).toBe('"№;:?');
    expect(convertLayout('"№;:?', "ru-en").text).toBe("@#$^&");
  });
  it("digits, spaces, newlines and unknown chars stay", () => {
    expect(convertLayout("ghbdtn 123\n!%*()-=_+😀").text).toBe("привет 123\n!%*()-=_+😀");
  });
  it("mixed text is converted only in the chosen direction", () => {
    expect(convertLayout("ghbdtn привет", "en-ru").text).toBe("привет привет");
    expect(convertLayout("ghbdtn привет", "ru-en").text).toBe("ghbdtn ghbdtn");
  });
  it("empty string", () => expect(convertLayout("")).toEqual({ text: "", direction: "en-ru" }));
  it("round-trips a full Russian sentence (letters and punctuation)", () => {
    const ru = "Съешь же ещё этих мягких французских булок, да выпей чаю.";
    const en = convertLayout(ru, "ru-en").text;
    expect(en).not.toBe(ru);
    expect(convertLayout(en, "en-ru").text).toBe(ru);
  });
  it("the backslash key survives (shared glyph)", () => {
    expect(convertLayout("a\\b", "en-ru").text).toBe("ф\\и");
    expect(convertLayout("ф\\и", "ru-en").text).toBe("a\\b");
  });
});
