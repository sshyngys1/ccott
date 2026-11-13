import { expect, it } from "vitest";
import { currencyCompletion, currencySuggestions } from "./currencyCompletion";
import { clearRatesCache, parseCurrencyQuery, setCachedRates } from "./currency";

const catalog = { base: "USD", rates: { USD: 1, KZT: 500, EUR: 0.9, NZD: 1.6, CAD: 1.4 }, stale: true, updatedAt: 1 };

it.each(["100 usd в ", "$100 to "])("offers the provider catalog after %s", query => {
  expect(currencyCompletion(query)).toMatchObject({ fragment: "", base: "USD" });
  expect(currencySuggestions("", catalog)).toEqual(["CAD", "EUR", "KZT", "NZD", "USD"]);
});

it.each([["k", "KZT"], ["тен", "KZT"], ["teng", "KZT"], ["ев", "EUR"], ["eur", "EUR"], ["new", "NZD"]])("narrows by code/RU/EN prefix %s", (fragment, code) => {
  expect(currencySuggestions(fragment, catalog)[0]).toBe(code);
});

it("recognizes a source code prefix and keeps complete expressions out of completion", () => {
  expect(currencyCompletion("100 us")).toEqual({ prefix: "100 ", fragment: "us", base: "USD" });
  for (const query of ["7 zip", "100 usd", "$100", "100 usd to kzt", "1+2", "timer 10 min", "100 kg to lb", "10 pounds in pounds"]) {
    expect(currencyCompletion(query)).toBeNull();
  }
  expect(currencySuggestions("zz", catalog)).toEqual([]);
  expect(currencySuggestions("", null)).toEqual([]);
  expect(currencySuggestions("rub", catalog)).toEqual([]);
});

it.each(["us", "тен", "teng", "nz", "new"])("recognizes the local code/name prefix %s without loading rates", fragment => {
  clearRatesCache();
  expect(currencyCompletion(`100 ${fragment}`)).toMatchObject({ fragment, base: "USD" });
});

it("ranks an initial name match ahead of words inside a different currency name", () => {
  expect(currencySuggestions("дол", catalog)[0]).toBe("USD");
});

it("accepts provider codes even when the platform has no localized name", () => {
  const provider = { ...catalog, rates: { ...catalog.rates, ZZZ: 2 } };
  try {
    setCachedRates("USD", provider);
    expect(currencySuggestions("zz", provider)).toEqual(["ZZZ"]);
    expect(currencyCompletion("100 zz")).toMatchObject({ fragment: "zz", base: "USD" });
    expect(parseCurrencyQuery("100 usd to ZZZ")).toMatchObject({ toCode: "ZZZ" });
    expect(currencyCompletion("100 usd to ZZZ")).toBeNull();
  } finally { clearRatesCache(); }
});

it.each([
  ["100 usd to arm", "arm", "AMD"],
  ["100 usd to pes", "pes", "MXN"],
  ["100 usd to kro", "kro", "DKK"],
])("shows suggestions and keeps completion open on 3-letter fragment for %s", (query, fragment, expectedSuggested) => {
  const fullCatalog = {
    base: "USD",
    rates: { USD: 1, AMD: 388, MXN: 17, DKK: 6.9, EUR: 0.9, KZT: 500, NOK: 10.5, SEK: 10.4 },
    stale: false,
    updatedAt: Date.now(),
  };
  setCachedRates("USD", fullCatalog);
  try {
    expect(currencyCompletion(query)).toMatchObject({ fragment, base: "USD" });
    expect(currencySuggestions(fragment, fullCatalog)).toContain(expectedSuggested);
  } finally {
    clearRatesCache();
  }
});

it.each(["1 bad", "2 std", "100 xxx"])("does not suggest or complete dead codes: %s", (query) => {
  expect(currencyCompletion(query)).toBeNull();
});

it("does not extinguish completion on a 3-letter fragment not in the loaded catalog", () => {
  const limitedCatalog = { base: "USD", rates: { USD: 1, EUR: 0.9, KZT: 500 }, stale: false, updatedAt: 1 };
  setCachedRates("USD", limitedCatalog);
  try {
    expect(currencyCompletion("100 usd to sle")).toMatchObject({ fragment: "sle", base: "USD" });
  } finally {
    clearRatesCache();
  }
});
