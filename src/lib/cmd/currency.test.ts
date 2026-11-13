import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCurrencyConversion,
  clearRatesCache,
  fetchRatesForBase,
  findCurrency,
  setCachedRates,
  getDefaultCurrency,
  parseCurrencyQuery,
  type CurrencyRates,
} from "./currency";
import * as ipc from "../../ipc";

const currencyForms: [string, string[]][] = [
  ["USD", ["доллар", "доллара", "доллару", "долларом", "долларе", "доллары", "долларов", "долларам", "долларами", "долларах"]],
  ["EUR", ["евро", "eur", "€"]],
  ["RUB", ["рубль", "рубля", "рублю", "рублём", "рублем", "рубле", "рубли", "рублей", "рублям", "рублями", "рублях"]],
  ["KZT", ["тенге", "тг", "₸"]],
  ["GBP", ["фунт", "фунта", "фунту", "фунтом", "фунте", "фунты", "фунтов", "фунтам", "фунтами", "фунтах", "фунтов стерлингов"]],
  ["JPY", ["иена", "иены", "иене", "иену", "иеной", "иеною", "иен", "иенам", "иенами", "иенах"]],
  ["CNY", ["юань", "юаня", "юаню", "юанем", "юане", "юани", "юаней", "юаням", "юанями", "юанях"]],
  ["CHF", ["франк", "франка", "франку", "франком", "франке", "франки", "франков", "франкам", "франками", "франках"]],
  ["CAD", ["канадский доллар", "канадского доллара", "канадскому доллару", "канадским долларом", "канадском долларе", "канадские доллары", "канадских долларов", "канадским долларам", "канадскими долларами", "канадских долларах"]],
  ["AUD", ["австралийский доллар", "австралийского доллара", "австралийскому доллару", "австралийским долларом", "австралийском долларе", "австралийские доллары", "австралийских долларов", "австралийским долларам", "австралийскими долларами", "австралийских долларах"]],
  ["TRY", ["лира", "лиры", "лире", "лиру", "лирой", "лирою", "лир", "лирам", "лирами", "лирах"]],
  ["GEL", ["лари", "gel", "₾"]],
  ["AMD", ["драм", "драма", "драму", "драмом", "драме", "драмы", "драмов", "драмам", "драмами", "драмах"]],
  ["UZS", ["сум", "сума", "суму", "сумом", "суме", "сумы", "сумов", "сумам", "сумами", "сумах"]],
  ["BYN", ["белорусский рубль", "белорусского рубля", "белорусскому рублю", "белорусским рублём", "белорусском рубле", "белорусские рубли", "белорусских рублей", "белорусским рублям", "белорусскими рублями", "белорусских рублях"]],
];

describe("currency words and locale defaults", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["100 usd", "100доллар", "$100", "100 долларов", "100 евро"])("uses the configured target for %s", query => {
    expect(parseCurrencyQuery(query, "ru-RU", "KZT")?.toCode).toBe("KZT");
  });

  it.each(["100 kzt", "₸100", "100 тенге"])("keeps the legacy fallback when the source equals the configured target: %s", query => {
    expect(parseCurrencyQuery(query, "ru-RU", "KZT")).toEqual(parseCurrencyQuery(query, "ru-RU"));
  });

  it("preserves the empty setting and explicit target", () => {
    expect(parseCurrencyQuery("100 usd", "ru-RU", "")).toEqual(parseCurrencyQuery("100 usd", "ru-RU"));
    expect(parseCurrencyQuery("100 usd to eur", "ru-RU", "KZT")?.toCode).toBe("EUR");
    expect(parseCurrencyQuery("100 NZD to KZT", "ru-RU", "KZT")).toMatchObject({ fromCode: "NZD", toCode: "KZT" });
  });

  it.each([
    ["100 долларов в тенге", "USD", "KZT", 100],
    ["1000 рублей в тенге", "RUB", "KZT", 1000],
    ["100 $ в ₸", "USD", "KZT", 100],
    ["$100 в тенге", "USD", "KZT", 100],
    ["100 dollars to euro", "USD", "EUR", 100],
    ["100 usd в kzt", "USD", "KZT", 100],
    ["100 доллар в рубли", "USD", "RUB", 100],
    ["100 долларов в рублях", "USD", "RUB", 100],
    ["100 евро в рублях", "EUR", "RUB", 100],
    ["100 баксов в тенге", "USD", "KZT", 100],
    ["100 канадских долларов в тенге", "CAD", "KZT", 100],
    ["100 usd", "USD", "KZT", 100],
    ["100 долларов", "USD", "KZT", 100],
  ])("parses the supplied example: %s", (query, fromCode, toCode, amount) => {
    expect(parseCurrencyQuery(query, "ru-KZ")).toMatchObject({ amount, fromCode, toCode });
  });

  it.each(currencyForms.flatMap(([code, forms]) => forms.map((form) => [code, form])))
    ("recognizes %s form '%s' as a complete source and target", (code, form) => {
      expect(parseCurrencyQuery(`100 ${form} в kzt`)).toMatchObject({ fromCode: code, toCode: "KZT" });
      expect(parseCurrencyQuery(`100 kzt в ${form}`)).toMatchObject({ fromCode: "KZT", toCode: code });
    });

  it.each(["бакс", "бакса", "баксу", "баксом", "баксе", "баксов", "баксы", "баксам", "баксами", "баксах"])
    ("recognizes slang '%s'", (form) => {
      expect(parseCurrencyQuery(`100 ${form} в тенге`)?.fromCode).toBe("USD");
      expect(parseCurrencyQuery(`100 тенге в ${form}`)?.toCode).toBe("USD");
    });

  it.each(["руб", "р", "р."])("recognizes ruble abbreviation '%s' after an amount", (form) => {
    expect(parseCurrencyQuery(`100 ${form} в тенге`)).toMatchObject({ fromCode: "RUB", toCode: "KZT" });
    expect(parseCurrencyQuery(`100${form}`, "ru-KZ")).toMatchObject({ fromCode: "RUB", toCode: "KZT" });
    expect(parseCurrencyQuery(form)).toBeNull();
  });

  it.each(["в", "во", "на", "to", "in", "=", "->", "→", "into"])
    ("supports separator '%s', case and repeated whitespace", (separator) => {
      for (const source of ["100 КАНАДСКИХ   ДОЛЛАРОВ", "$ 100", "100$"]) {
        expect(parseCurrencyQuery(`  ${source}\t ${separator.toUpperCase()}   БЕЛОРУССКИХ\nРУБЛЯХ  `))
          .toMatchObject({ amount: 100, fromCode: source.includes("КАНАДСКИХ") ? "CAD" : "USD", toCode: "BYN" });
      }
    });

  it.each(["=", "->", "→"])("supports compact symbolic separator '%s'", (separator) => {
    expect(parseCurrencyQuery(`100usd${separator}eur`)).toMatchObject({ fromCode: "USD", toCode: "EUR" });
    expect(parseCurrencyQuery(`$100${separator}€`)).toMatchObject({ fromCode: "USD", toCode: "EUR" });
  });

  it.each(["в", "во", "на", "to", "into", "in", "=", "->", "→"])
    ("uses the omitted-target default for trailing '%s' with or without amount spacing", (separator) => {
      for (const source of ["777баксов", "777 баксов", "100$", "100 usd", "100 евро", "$100"]) {
        for (const trailing of ["", " "]) {
          for (const locale of ["ru-KZ", "ru-RU", "en-US", "de-DE"]) {
            expect(parseCurrencyQuery(`${source} ${separator.toUpperCase()}${trailing}`, locale))
              .toEqual(parseCurrencyQuery(source, locale));
            expect(parseCurrencyQuery(source, locale)).not.toBeNull();
          }
        }
      }
    });

  it.each(["=", "->", "→"])("uses the default after compact trailing '%s'", (separator) => {
    expect(parseCurrencyQuery(`100евро${separator}`, "ru-KZ"))
      .toMatchObject({ amount: 100, fromCode: "EUR", toCode: "KZT" });
  });

  it.each([
    ["$", "USD"], ["€", "EUR"], ["₽", "RUB"], ["₸", "KZT"], ["£", "GBP"],
    ["¥", "JPY"], ["₺", "TRY"], ["₾", "GEL"], ["֏", "AMD"], ["C$", "CAD"], ["A$", "AUD"],
  ])("recognizes symbol %s before and after the amount", (symbol, fromCode) => {
    expect(parseCurrencyQuery(`${symbol}100 в eur`)).toMatchObject({ amount: 100, fromCode, toCode: "EUR" });
    expect(parseCurrencyQuery(`100${symbol} в eur`)).toMatchObject({ amount: 100, fromCode, toCode: "EUR" });
  });

  it("normalizes whitespace within a complete multiword source name", () => {
    expect(parseCurrencyQuery(" 100\tканадских\nдолларов\tво\nбелорусских\tрублях "))
      .toMatchObject({ amount: 100, fromCode: "CAD", toCode: "BYN" });
  });

  it.each([
    ["ru-KZ", "KZT"], ["ru-RU", "RUB"], ["ru-BY", "BYN"], ["uz-UZ", "UZS"],
    ["hy-AM", "AMD"], ["ka-GE", "GEL"], ["tr-TR", "TRY"], ["en-GB", "GBP"],
    ["ja-JP", "JPY"], ["zh-CN", "CNY"], ["de-CH", "CHF"], ["en-CA", "CAD"],
    ["en-AU", "AUD"], ["en-US", "USD"], ["de-DE", "EUR"], ["bg-BG", "EUR"],
    ["ru", "RUB"], ["en", "USD"], ["de", "USD"], ["ru-ZA", "USD"],
    ["zh-Hans-CN", "CNY"], ["ru-kz", "KZT"], [" en-GB ", "GBP"],
    ["", "USD"], ["invalid_locale", "USD"],
  ])("maps locale %s to %s without consulting the environment", (locale, expected) => {
    expect(getDefaultCurrency(locale)).toBe(expected);
  });

  it.each([
    "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "VA", "ME", "XK",
  ])("selects EUR for euro region %s", (region) => {
    expect(getDefaultCurrency(`en-${region}`)).toBe("EUR");
  });

  it.each([
    ["ru-KZ", "KZT"], ["ru-RU", "RUB"], ["en-US", "EUR"],
    ["de-DE", "EUR"], ["ru", "RUB"], ["en", "EUR"],
  ])("uses locale %s for an omitted target (%s)", (locale, toCode) => {
    for (const query of ["100 долларов", "100 usd", "$100", "100$"]) {
      expect(parseCurrencyQuery(query, locale)).toMatchObject({ amount: 100, fromCode: "USD", toCode });
    }
  });

  it.each(currencyForms.map(([code]) => code))
    ("avoids implicit self-conversion for %s", (code) => {
      const localeByCurrency: Record<string, string> = {
        USD: "en-US", EUR: "de-DE", RUB: "ru-RU", KZT: "ru-KZ", GBP: "en-GB",
        JPY: "ja-JP", CNY: "zh-CN", CHF: "de-CH", CAD: "en-CA", AUD: "en-AU",
        TRY: "tr-TR", GEL: "ka-GE", AMD: "hy-AM", UZS: "uz-UZ", BYN: "ru-BY",
      };
      expect(parseCurrencyQuery(`100 ${code}`, localeByCurrency[code]))
        .toMatchObject({ fromCode: code, toCode: code === "USD" ? "EUR" : "USD" });
      expect(parseCurrencyQuery(`100 ${code} в ${code}`, localeByCurrency[code]))
        .toMatchObject({ fromCode: code, toCode: code });
    });

  it("reads navigator.language on each call independently of the UI language", () => {
    const language = vi.spyOn(navigator, "language", "get").mockReturnValue("ru-KZ");
    expect(parseCurrencyQuery("$100")?.toCode).toBe("KZT");
    language.mockReturnValue("ru-RU");
    expect(parseCurrencyQuery("100 долларов")?.toCode).toBe("RUB");
  });

  it("keeps decimal amounts and rejects non-finite amounts", () => {
    expect(parseCurrencyQuery("100,5 долларов в рублях")?.amount).toBe(100.5);
    expect(parseCurrencyQuery("$100.5 в тенге")?.amount).toBe(100.5);
    expect(parseCurrencyQuery(`${"9".repeat(400)} usd`)).toBeNull();
  });

  it.each([
    "", "доллар", "доллары", "баксы", "канадский доллар", "usd", "р", "р.", "100",
    "100 unknown", "100 канадских долларов лишнее", "100 канадских", "100 белорусских",
    "100 usd в unknown", "100 usd в eur в kzt", "100 usd==eur",
    "100 usd в р", "100 usd в р.", "р100", "100usdfoo", "100 долларов + 5", "$100 usd",
    "5 км в мили", "10 м в см", "10 pounds in pounds", "10 pounds in kg", "10 фунтов в фунт",
    "usd 100 to", "баксы 100 в", "Calculator", "Chrome", "100 usd intoo", "100 usd в т",
    "12*7+3", "15% от 2400", "таймер 10 мин", "timer 90s",
  ])("does not convert invalid, incomplete or non-currency query '%s'", (query) => {
    expect(parseCurrencyQuery(query)).toBeNull();
  });
});

describe("currency converter", () => {
  beforeEach(() => {
    clearRatesCache();
  });
  afterEach(() => { vi.restoreAllMocks(); clearRatesCache(); });

  it.each(["success", "failure"])("releases the shared request after %s so a later fetch can retry", async outcome => {
    const rates = { base: "USD", rates: { KZT: 500 }, stale: false, updatedAt: 1 };
    let resolve!: (rates: CurrencyRates) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<CurrencyRates>((done, fail) => { resolve = done; reject = fail; });
    const spy = vi.spyOn(ipc, "invoke").mockReturnValueOnce(pending).mockResolvedValue(rates);
    const first = fetchRatesForBase("usd");
    const second = fetchRatesForBase("USD");
    expect(first).toBe(second);
    expect(spy).toHaveBeenCalledExactlyOnceWith("cmd_currency_rates", { base: "USD" });
    if (outcome === "success") {
      resolve(rates);
      await expect(first).resolves.toEqual(rates);
      clearRatesCache();
    } else {
      reject(new Error("offline"));
      await expect(first).rejects.toThrow("offline");
    }
    await expect(fetchRatesForBase("USD")).resolves.toEqual(rates);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns expired session rates as stale when fetching fails offline", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const saved = { base: "USD", rates: { KZT: 500, NZD: 1.6 }, stale: false, updatedAt: 1 };
    setCachedRates("USD", saved);
    vi.spyOn(Date, "now").mockReturnValue(13 * 60 * 60 * 1000);
    vi.spyOn(ipc, "invoke").mockRejectedValue(new Error("offline"));
    await expect(fetchRatesForBase("USD")).resolves.toEqual({ ...saved, stale: true });
    await expect(fetchRatesForBase("EUR")).rejects.toThrow("offline");
  });

  it("parses currency queries with codes and symbols", () => {
    const q1 = parseCurrencyQuery("100 usd в kzt");
    expect(q1).toEqual({
      amount: 100,
      fromCode: "USD",
      toCode: "KZT",
      fromSymbol: "$",
      toSymbol: "₸",
    });

    const q2 = parseCurrencyQuery("€50 to rub");
    expect(q2).toEqual({
      amount: 50,
      fromCode: "EUR",
      toCode: "RUB",
      fromSymbol: "€",
      toSymbol: "₽",
    });

    const q3 = parseCurrencyQuery("$100 in eur");
    expect(q3?.fromCode).toBe("USD");
    expect(q3?.toCode).toBe("EUR");

    const q4 = parseCurrencyQuery("100 gbp в kzt");
    expect(q4?.fromCode).toBe("GBP");
    expect(q4?.toCode).toBe("KZT");
  });

  it("calculates conversions correctly with rates", () => {
    const rates: CurrencyRates = {
      base: "USD",
      rates: {
        USD: 1,
        EUR: 0.92,
        KZT: 495,
        GBP: 0.78,
      },
      updatedAt: Date.now() - 3600000,
      stale: false,
    };

    const query = parseCurrencyQuery("100 usd в kzt")!;
    const res = calculateCurrencyConversion(query, rates);

    expect(res).not.toBeNull();
    expect(res?.convertedAmount).toBe(49500);
    expect(res?.value).toBe("= 49 500 ₸");
    expect(res?.formula).toBe("100 USD = 49 500 KZT");
    expect(res?.stale).toBe(false);
  });

  it("handles offline stale rates correctly", () => {
    const gbpRates: CurrencyRates = {
      base: "GBP",
      rates: {
        GBP: 1,
        KZT: 635.4,
      },
      updatedAt: Date.now() - 7200000,
      stale: true,
    };

    const query = parseCurrencyQuery("100 gbp в kzt")!;
    const res = calculateCurrencyConversion(query, gbpRates);

    expect(res).not.toBeNull();
    expect(res?.convertedAmount).toBe(63540);
    expect(res?.value).toBe("= 63 540 ₸");
    expect(res?.formula).toBe("100 GBP = 63 540 KZT");
    expect(res?.stale).toBe(true);
  });

  it("rejects invalid syntax or unknown currencies", () => {
    expect(parseCurrencyQuery("100 foo to bar")).toBeNull();
    expect(parseCurrencyQuery("hello")).toBeNull();
  });

  it("clears pendingRates along with ratesCache", () => {
    let resolve!: (rates: CurrencyRates) => void;
    const pending = new Promise<CurrencyRates>(done => { resolve = done; });
    const spy = vi.spyOn(ipc, "invoke").mockReturnValueOnce(pending);
    const p1 = fetchRatesForBase("EUR");
    expect(spy).toHaveBeenCalledTimes(1);
    clearRatesCache();
    spy.mockResolvedValueOnce({ base: "EUR", rates: { USD: 1.1 }, stale: false, updatedAt: 2 });
    const p2 = fetchRatesForBase("EUR");
    expect(p2).not.toBe(p1);
    expect(spy).toHaveBeenCalledTimes(2);
    resolve({ base: "EUR", rates: { USD: 1.0 }, stale: false, updatedAt: 1 });
  });

  it.each(["arm", "pes", "kro", "bad", "std", "xxx"])("does not recognize historic/dead currency code %s", (code) => {
    expect(findCurrency(code)).toBeUndefined();
    expect(parseCurrencyQuery(`1 ${code}`)).toBeNull();
  });

  it.each(["1 bad", "2 std", "100 xxx"])("rejects dead currency query %s", (query) => {
    expect(parseCurrencyQuery(query)).toBeNull();
  });
});
