import { describe, expect, it, vi } from "vitest";
import {
  evaluateLocalFeatures,
  getQuickHints,
  mapBackendItem,
} from "./ranking";
import type { CmdItem } from "../../shared/types";

describe("cmd ranking and evaluation", () => {
  it("provides 5 quick hints for empty query", () => {
    const hints = getQuickHints();
    expect(hints).toHaveLength(5);
    expect(hints.map((h) => h.kind)).toEqual(["calc", "percent", "convert", "ruler", "timer"]);
  });

  it("evaluates local features for calculator expression", () => {
    const res = evaluateLocalFeatures("12*7+3");
    expect(res.math?.value).toBe("87");
    expect(res.units).toBeNull();
    expect(res.currencyQuery).toBeNull();
  });

  it("evaluates local features for unit conversion", () => {
    const res = evaluateLocalFeatures("5 км в мили");
    expect(res.units).not.toBeNull();
    expect(res.units?.fromUnit).toBe("km");
    expect(res.units?.toUnit).toBe("mi");
  });

  it("evaluates local features for currency query", () => {
    const res = evaluateLocalFeatures("100 usd в kzt");
    expect(res.currencyQuery).toEqual({
      amount: 100,
      fromCode: "USD",
      toCode: "KZT",
      fromSymbol: "$",
      toSymbol: "₸",
    });
  });

  it("evaluates local features for commands", () => {
    const res = evaluateLocalFeatures("таймер 10 мин");
    expect(res.commands).toHaveLength(1);
    expect(res.commands[0].iconType).toBe("timer");
  });

  it.each([
    ["5 км в мили", "km", "mi"],
    ["10 м в см", "m", "cm"],
    ["10 фунтов в фунт", "lb", "lb"],
    ["10 pounds in pounds", "lb", "lb"],
    ["10 фунтов в кг", "lb", "kg"],
  ])("keeps units ahead of ambiguous currencies: %s", (query, fromUnit, toUnit) => {
    const result = evaluateLocalFeatures(query);
    expect(result.units).toMatchObject({ fromUnit, toUnit });
    expect(result.currencyQuery).toBeNull();
    expect(result.math).toBeNull();
  });

  it.each([
    ["100 фунтов в доллары", "GBP", "USD"],
    ["100 gbp в фунты", "GBP", "GBP"],
    ["100 фунтов стерлингов в фунты", "GBP", "GBP"],
    ["100 р. в тенге", "RUB", "KZT"],
    ["100 канадских долларов в рублях", "CAD", "RUB"],
  ])("recognizes explicit currencies in local features: %s", (query, fromCode, toCode) => {
    const result = evaluateLocalFeatures(query);
    expect(result.currencyQuery).toMatchObject({ fromCode, toCode });
    expect(result.units).toBeNull();
    expect(result.math).toBeNull();
    expect(result.commands).toEqual([]);
  });

  it.each([
    ["12*7+3", "87"],
    ["15% от 2400", "360"],
    ["100 / 4 - 5", "20"],
  ])("preserves calculator results: %s", (query, value) => {
    const result = evaluateLocalFeatures(query);
    expect(result.math?.value).toBe(value);
    expect(result.currencyQuery).toBeNull();
    expect(result.units).toBeNull();
  });

  it.each(["таймер 10 мин", "timer 90s", "таймер 1 ч 30 мин"])
    ("preserves timer commands: %s", (query) => {
      const result = evaluateLocalFeatures(query);
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].iconType).toBe("timer");
      expect(result.currencyQuery).toBeNull();
      expect(result.units).toBeNull();
      expect(result.math).toBeNull();
    });

  it.each(["доллар", "доллары", "рубль", "баксы", "р", "р.", "канадский доллар", "telegram"])
    ("leaves plain search '%s' available to backend search", (query) => {
      expect(evaluateLocalFeatures(query)).toEqual({
        math: null, units: null, currencyQuery: null, commands: [],
      });
    });

  it("maps backend CmdItem and attaches launch handlers", async () => {
    const onAfterLaunch = vi.fn();
    const appItem: CmdItem = {
      id: "app-telegram",
      kind: "app",
      title: "Telegram",
      subtitle: "Telegram.exe",
      icon: null,
    };

    const unified = mapBackendItem(appItem, onAfterLaunch);
    expect(unified.id).toBe("app-telegram");
    expect(unified.group).toBe("apps");

    // Standard launch
    await unified.onExecute();
    expect(onAfterLaunch).toHaveBeenCalledOnce();
  });
});
