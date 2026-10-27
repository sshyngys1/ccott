import { describe, expect, it } from "vitest";
import { clipboardToastPreview } from "./toast";

describe("clipboardToastPreview", () => {
  it.each(["Password123", "pass123!", "PASSWORD1!", "Aa!aaaaa", "Пароль123!", "Aa1" + "🏝".repeat(125)])("masks a token with at least three character classes: %s", (text) => {
    expect(clipboardToastPreview(text)).toBe("••••••");
  });

  it.each(["Aa123!x", "a".repeat(129) + "A1!", "lowercase", "UPPERCASE", "123456789", "LettersOnly", "lower1234", "привет мир", "A1!a\ntext", "Aa123! x", "Aa123!x\t", "Aa123!x\u00a0"])("keeps ordinary, spaced or out-of-range text: %s", (text) => {
    expect(clipboardToastPreview(text, "видимый текст")).toBe("видимый текст");
  });

  it("uses the original clipboard text, not a preview that has flattened newlines", () => {
    expect(clipboardToastPreview("Aa1!\nAAAA", "Aa1!AAAA")).toBe("Aa1!AAAA");
    expect(clipboardToastPreview("Aa1!" + "a".repeat(124))).toBe("••••••");
    expect(clipboardToastPreview("Aa1!" + "a".repeat(125))).not.toBe("••••••");
  });
});
