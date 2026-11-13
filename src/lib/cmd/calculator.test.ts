import { describe, expect, it } from "vitest";
import { evaluateMath } from "./calculator";

describe("evaluateMath", () => {
  it("evaluates basic arithmetic operations", () => {
    expect(evaluateMath("12 * 7 + 3")?.value).toBe("87");
    expect(evaluateMath("12*7+3")?.value).toBe("87");
    expect(evaluateMath("100 / 4 - 5")?.value).toBe("20");
    expect(evaluateMath("2 + 3 * 4")?.value).toBe("14");
    expect(evaluateMath("(2 + 3) * 4")?.value).toBe("20");
    expect(evaluateMath("(12+3)*4 - 15%")?.value).toBe("51");
    expect(evaluateMath("(12+3)*4 - 15%")?.numericValue).toBe(51);
  });

  it("evaluates powers and negative numbers", () => {
    expect(evaluateMath("2 ^ 3")?.value).toBe("8");
    expect(evaluateMath("2 ^ 3 ^ 2")?.value).toBe("512");
    expect(evaluateMath("-5 + 3")?.value).toBe("-2");
    expect(evaluateMath("-(3 + 4)")?.value).toBe("-7");
  });

  it("handles decimal dots and commas with locale formatting", () => {
    expect(evaluateMath("12,5 * 4")?.value).toBe("50");
    expect(evaluateMath("1,5 + 2.5")?.value).toBe("4");

    // RU locale: comma decimal separator
    expect(evaluateMath("0.1 + 0.2", "ru")?.value).toBe("0,3");
    expect(evaluateMath("10 / 4", "ru")?.value).toBe("2,5");

    // EN locale: dot decimal separator
    expect(evaluateMath("0.1 + 0.2", "en")?.value).toBe("0.3");
    expect(evaluateMath("10 / 4", "en")?.value).toBe("2.5");
  });

  it("handles percentages in various forms and locales", () => {
    // 15% of 2400 / 15% от 2400
    expect(evaluateMath("15% of 2400")?.value).toBe("360");
    expect(evaluateMath("15% от 2400")?.value).toBe("360");

    // 2400 - 15%
    expect(evaluateMath("2400 - 15%")?.value).toBe("2 040");

    // 2400 + 15%
    expect(evaluateMath("2400 + 15%")?.value).toBe("2 760");

    // 2400 * 15%
    expect(evaluateMath("2400 * 15%")?.value).toBe("360");

    // 2400 / 15%
    expect(evaluateMath("2400 / 15%")?.value).toBe("16 000");

    // Standalone 15% in RU and EN
    expect(evaluateMath("15%", "ru")?.value).toBe("0,15");
    expect(evaluateMath("15%", "en")?.value).toBe("0.15");
  });

  it("formats large numbers with spaces", () => {
    expect(evaluateMath("1000 * 1000", "ru")?.value).toBe("1 000 000");
    expect(evaluateMath("1000 * 1000", "en")?.value).toBe("1 000 000");
  });

  it("rejects invalid expressions and plain words", () => {
    expect(evaluateMath("")).toBeNull();
    expect(evaluateMath("42")).toBeNull(); // Single number is not treated as calc query
    expect(evaluateMath("hello world")).toBeNull();
    expect(evaluateMath("12 / 0")).toBeNull();
    expect(evaluateMath("telegram")).toBeNull();
  });
});
