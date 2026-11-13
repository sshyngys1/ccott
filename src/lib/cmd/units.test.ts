import { describe, expect, it } from "vitest";
import { evaluateUnits } from "./units";
import { setLanguage } from "../../i18n";

describe("evaluateUnits", () => {
  it("converts length units in RU and EN", () => {
    // RU
    setLanguage("ru");
    const resRu = evaluateUnits("5 км в мили", "ru");
    expect(resRu).not.toBeNull();
    expect(resRu?.fromUnit).toBe("km");
    expect(resRu?.toUnit).toBe("mi");
    expect(resRu?.numericValue).toBeCloseTo(3.10686, 3);
    expect(resRu?.formattedNumber).toBe("3,1069");
    expect(resRu?.value).toBe("= 3,1069 мили");
    expect(resRu?.formula).toBe("5 км = 3,1069 мили");
    expect(resRu?.meta).toBe("1 км = 0,6214 мили");

    // EN
    setLanguage("en");
    const resEn = evaluateUnits("5 km to mi", "en");
    expect(resEn).not.toBeNull();
    expect(resEn?.fromUnit).toBe("km");
    expect(resEn?.toUnit).toBe("mi");
    expect(resEn?.numericValue).toBeCloseTo(3.10686, 3);
    expect(resEn?.formattedNumber).toBe("3.1069");
    expect(resEn?.value).toBe("= 3.1069 mi");
    expect(resEn?.formula).toBe("5 km = 3.1069 mi");
    expect(resEn?.meta).toBe("1 km = 0.6214 mi");

    const res2 = evaluateUnits("10 miles to km", "en");
    expect(res2?.numericValue).toBeCloseTo(16.0934, 3);
  });

  it("converts mass units in RU and EN", () => {
    setLanguage("ru");
    const resRu = evaluateUnits("10 lb to kg", "ru");
    expect(resRu).not.toBeNull();
    expect(resRu?.fromUnit).toBe("lb");
    expect(resRu?.toUnit).toBe("kg");
    expect(resRu?.numericValue).toBeCloseTo(4.5359, 3);
    expect(resRu?.formattedNumber).toBe("4,5359");
    expect(resRu?.value).toBe("= 4,5359 кг");

    const res2Ru = evaluateUnits("500 г в кг", "ru");
    expect(res2Ru?.value).toBe("= 0,5 кг");

    setLanguage("en");
    const resEn = evaluateUnits("10 lb to kg", "en");
    expect(resEn?.value).toBe("= 4.5359 kg");
  });

  it("converts temperatures", () => {
    setLanguage("ru");
    const resFtoC = evaluateUnits("100 f в c", "ru");
    expect(resFtoC).not.toBeNull();
    expect(resFtoC?.numericValue).toBeCloseTo(37.7778, 3);
    expect(resFtoC?.value).toBe("= 37,7778 °C");

    setLanguage("en");
    const resCtoF = evaluateUnits("0 c to f", "en");
    expect(resCtoF?.numericValue).toBe(32);
    expect(resCtoF?.value).toBe("= 32 °F");

    const resKtoC = evaluateUnits("300 k to c", "en");
    expect(resKtoC?.numericValue).toBeCloseTo(26.85, 2);
  });

  it("converts volume and speed", () => {
    setLanguage("ru");
    const resVolRu = evaluateUnits("1 gal to l", "ru");
    expect(resVolRu?.numericValue).toBeCloseTo(3.7854, 3);
    expect(resVolRu?.value).toBe("= 3,7854 л");

    const resSpeedRu = evaluateUnits("100 km/h in mph", "ru");
    expect(resSpeedRu?.numericValue).toBeCloseTo(62.1371, 3);
    expect(resSpeedRu?.value).toBe("= 62,1371 миль/ч");

    setLanguage("en");
    const resSpeedEn = evaluateUnits("100 km/h in mph", "en");
    expect(resSpeedEn?.value).toBe("= 62.1371 mph");
  });

  it("converts data units", () => {
    setLanguage("ru");
    const resRu = evaluateUnits("16 gb in mb", "ru");
    expect(resRu?.numericValue).toBe(16384);
    expect(resRu?.value).toBe("= 16 384 МБ");

    setLanguage("en");
    const resEn = evaluateUnits("16 gb in mb", "en");
    expect(resEn?.numericValue).toBe(16384);
    expect(resEn?.value).toBe("= 16 384 MB");

    const res2 = evaluateUnits("1024 кб в мб", "en");
    expect(res2?.numericValue).toBe(1);
  });

  it("converts time units including days and fractions", () => {
    setLanguage("ru");
    const resRu = evaluateUnits("2.5 h in min", "ru");
    expect(resRu?.numericValue).toBe(150);
    expect(resRu?.value).toBe("= 150 мин");

    const resDaysRu = evaluateUnits("3 сут в ч", "ru");
    expect(resDaysRu?.numericValue).toBe(72);
    expect(resDaysRu?.value).toBe("= 72 ч");

    const resSecRu = evaluateUnits("90 s to min", "ru");
    expect(resSecRu?.numericValue).toBe(1.5);
    expect(resSecRu?.value).toBe("= 1,5 мин");

    setLanguage("en");
    const resSecEn = evaluateUnits("90 s to min", "en");
    expect(resSecEn?.numericValue).toBe(1.5);
    expect(resSecEn?.value).toBe("= 1.5 min");
  });

  it("rejects mismatched categories or invalid syntax", () => {
    expect(evaluateUnits("5 km to kg")).toBeNull();
    expect(evaluateUnits("10 hello in world")).toBeNull();
    expect(evaluateUnits("just text")).toBeNull();
  });
});
