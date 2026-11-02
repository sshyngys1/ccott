// Owner: F2 (Frontend-Modules). Currency parser & converter (spec §6.10, contracts §20).
import { getLanguage, type Language } from "../../i18n";
import { invoke } from "../../ipc";
import type { CurrencyRates } from "../../shared/types";
import { evaluateUnits } from "./units";
export type { CurrencyRates };

export interface CurrencyQuery {
  amount: number;
  fromCode: string;
  toCode: string;
  fromSymbol: string;
  toSymbol: string;
}

export interface CurrencyResult {
  value: string;
  formula: string;
  meta: string;
  fromCode: string;
  toCode: string;
  fromSymbol: string;
  toSymbol: string;
  amount: number;
  convertedAmount: number;
  formattedAmount: string;
  rate: number;
  stale: boolean;
  updatedAt: number;
}

interface CurrencyInfo {
  code: string;
  symbol: string;
  pattern: RegExp;
}

// Reuse declension endings instead of listing each inflected currency name.
// Russian names are regex literals: they are input patterns, not UI text (see literals.test.ts).
const SOFT_NOUN_ENDING = /(?:ь|я|ю|[её]м|е|и|ей|ям|ями|ях)/.source;
const FEMININE_NOUN_ENDING = /(?:а|ы|е|у|ой|ою|ам|ами|ах)?/.source;
const ADJECTIVE_ENDING = /(?:ий|ого|ому|им|ом|ие|их|ими)/.source;

function hardNoun(stem: RegExp, plural: RegExp = /ы/): string {
  return `${stem.source}(?:${/а|у|ом|е|ов|ам|ами|ах/.source}|${plural.source})?`;
}

function after(stem: RegExp, ending: string): string {
  return `${stem.source}${ending}`;
}

const SPACE = /\s+/.source;
const DOLLAR = hardNoun(/доллар/);
const RUBLE = after(/рубл/, SOFT_NOUN_ENDING);

function currency(code: string, symbol: string, ...aliases: (string | RegExp)[]): CurrencyInfo {
  const sources = aliases.map((a) => (typeof a === "string" ? a : a.source));
  return { code, symbol, pattern: new RegExp(`^(?:${sources.join("|")})$`, "iu") };
}

const CURRENCIES: CurrencyInfo[] = [
  currency("USD", "$", /\$/, "usd", DOLLAR, hardNoun(/бакс/), "dollars?"),
  currency("EUR", "€", "€", "eur", /евро/, "euros?"),
  currency("RUB", "₽", "₽", "rub", /руб/, RUBLE, "rubles?"),
  currency("KZT", "₸", "₸", "kzt", /тг/, /тенге/, "tenge"),
  currency("GBP", "£", "£", "gbp", `${hardNoun(/фунт/)}${/(?:\s+стерлингов)?/.source}`, "pounds?"),
  currency("JPY", "¥", "¥", "jpy", after(/иен/, FEMININE_NOUN_ENDING), "yen"),
  currency("CNY", "¥", "cny", after(/юан/, SOFT_NOUN_ENDING), "yuan"),
  currency("CHF", "CHF", "chf", hardNoun(/франк/, /и/), "francs?"),
  currency("CAD", "C$", "cad", /c\$/, /cad\$/, `${after(/канадск/, ADJECTIVE_ENDING)}${SPACE}${DOLLAR}`),
  currency("AUD", "A$", "aud", /a\$/, /aud\$/, `${after(/австралийск/, ADJECTIVE_ENDING)}${SPACE}${DOLLAR}`),
  currency("TRY", "₺", "₺", "try", after(/лир/, FEMININE_NOUN_ENDING), "lira"),
  currency("GEL", "₾", "₾", "gel", /лари/, "lari"),
  currency("AMD", "֏", "֏", "amd", hardNoun(/драм/), "dram"),
  currency("UZS", "UZS", "uzs", hardNoun(/сум/), "som"),
  currency("BYN", "Br", "byn", `${after(/белорусск/, ADJECTIVE_ENDING)}${SPACE}${RUBLE}`),
];

const SYMBOL_PREFIXES: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "₽": "RUB",
  "₸": "KZT",
  "£": "GBP",
  "¥": "JPY",
  "₺": "TRY",
  "₾": "GEL",
  "֏": "AMD",
  "c$": "CAD",
  "a$": "AUD",
};

const REGION_CURRENCIES: Record<string, string> = {
  KZ: "KZT", RU: "RUB", BY: "BYN", UZ: "UZS", AM: "AMD", GE: "GEL",
  TR: "TRY", GB: "GBP", JP: "JPY", CN: "CNY", CH: "CHF", CA: "CAD", AU: "AUD",
};
const EURO_REGIONS = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "AD", "MC", "SM", "VA", "ME", "XK",
]);

/** Pure locale-to-currency mapping; a region takes precedence over the language. */
export function getDefaultCurrency(locale: string): string {
  try {
    const { region, language } = new Intl.Locale(locale.trim());
    if (!region) return language === "ru" ? "RUB" : "USD";
    if (EURO_REGIONS.has(region)) return "EUR";
    return REGION_CURRENCIES[region] ?? "USD";
  } catch {
    return "USD";
  }
}

export function findCurrency(str: string): CurrencyInfo | undefined {
  const clean = str.trim().toLowerCase();
  return CURRENCIES.find((c) => c.pattern.test(clean));
}

/** Parse an amount and currency, optionally followed by a separator and target. */
export function parseCurrencyQuery(
  query: string,
  locale: string = typeof navigator === "undefined" ? "en-US" : navigator.language,
): CurrencyQuery | null {
  const trimmed = query.trim().replace(/\s+/gu, " ");
  if (!trimmed) return null;

  // A complete physical conversion (e.g. "10 pounds in pounds") wins the ambiguity.
  if (evaluateUnits(trimmed)) return null;

  const parts = trimmed.split(/(?:\s+(?:в|во|на|to|into|in)(?:\s+|$)|\s*(?:=|->|→)\s*)/iu);
  if (parts.length > 2) return null;
  const source = parts[0].trim();
  const prefix = /^(c\$|a\$|[$€₽₸£¥₺₾֏])\s*(\d+(?:[.,]\d+)?)$/iu.exec(source);
  const suffix = /^(\d+(?:[.,]\d+)?)\s*(.+)$/u.exec(source);
  const amountRaw = prefix?.[2] ?? suffix?.[1];
  if (!amountRaw) return null;

  // The one-letter ruble abbreviation is only valid immediately after an amount.
  const fromRaw = prefix
    ? SYMBOL_PREFIXES[prefix[1].toLowerCase()]
    : suffix?.[2].trim();
  if (!fromRaw) return null;
  const fromInfo = findCurrency(!prefix && /^р\.?$/iu.test(fromRaw) ? "RUB" : fromRaw);
  const amount = Number(amountRaw.replace(",", "."));
  if (!fromInfo || !Number.isFinite(amount)) return null;

  let target = parts[1];
  if (!target) {
    target = getDefaultCurrency(locale);
    if (target === fromInfo.code) target = target === "USD" ? "EUR" : "USD";
  }
  const toInfo = findCurrency(target);
  if (!toInfo) return null;

  return {
    amount,
    fromCode: fromInfo.code,
    toCode: toInfo.code,
    fromSymbol: fromInfo.symbol,
    toSymbol: toInfo.symbol,
  };
}

// In-memory cache for session
const ratesCache = new Map<string, { rates: CurrencyRates; fetchedAt: number }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function clearRatesCache(): void {
  ratesCache.clear();
}

export function setCachedRates(base: string, rates: CurrencyRates): void {
  ratesCache.set(base.toUpperCase(), { rates, fetchedAt: Date.now() });
}

export async function fetchRatesForBase(base: string): Promise<CurrencyRates> {
  const normBase = base.toUpperCase();
  const cached = ratesCache.get(normBase);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates;
  }

  const res = await invoke("cmd_currency_rates", { base: normBase });
  ratesCache.set(normBase, { rates: res, fetchedAt: Date.now() });
  return res;
}

export function formatCurrencyValue(amount: number, symbol: string, lang: Language = getLanguage()): string {
  if (!Number.isFinite(amount)) return "";
  let formatted: string;
  if (lang === "ru") {
    if (Math.abs(amount - Math.round(amount)) < 1e-4) {
      formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0, useGrouping: true })
        .format(Math.round(amount))
        .replace(/[\u00a0\u202f]/g, " ");
    } else {
      formatted = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
        .format(amount)
        .replace(/[\u00a0\u202f]/g, " ");
    }
  } else {
    if (Math.abs(amount - Math.round(amount)) < 1e-4) {
      const parts = Math.round(amount).toString().split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      formatted = parts.join(".");
    } else {
      const rounded = Number(Math.round(Number(amount + "e+2")) + "e-2");
      const parts = rounded.toFixed(2).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      formatted = parts.join(".");
    }
  }
  return `= ${formatted} ${symbol}`;
}

export function formatRateNumber(rate: number, lang: Language = getLanguage()): string {
  let str: string;
  if (rate >= 100) str = rate.toFixed(2);
  else if (rate >= 1) str = rate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  else str = rate.toPrecision(4);

  return lang === "ru" ? str.replace(".", ",") : str;
}

/**
 * Calculates conversion using rates.
 */
export function calculateCurrencyConversion(
  query: CurrencyQuery,
  ratesData: CurrencyRates,
  lang: Language = getLanguage(),
): CurrencyResult | null {
  const { fromCode, toCode, amount, fromSymbol, toSymbol } = query;

  let rate: number | undefined;

  if (ratesData.base === fromCode) {
    rate = ratesData.rates[toCode];
  } else if (ratesData.base === toCode && ratesData.rates[fromCode]) {
    rate = 1 / ratesData.rates[fromCode];
  } else if (ratesData.rates[fromCode] && ratesData.rates[toCode]) {
    rate = ratesData.rates[toCode] / ratesData.rates[fromCode];
  }

  if (rate === undefined || !Number.isFinite(rate)) {
    return null;
  }

  const convertedAmount = amount * rate;
  const value = formatCurrencyValue(convertedAmount, toSymbol, lang);

  // Group thousands for amount and convertedStr
  let amountStr: string;
  let convertedStr: string;

  if (lang === "ru") {
    amountStr = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, useGrouping: true })
      .format(amount)
      .replace(/[\u00a0\u202f]/g, " ");
    convertedStr = Math.abs(convertedAmount - Math.round(convertedAmount)) < 1e-4
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0, useGrouping: true })
          .format(Math.round(convertedAmount))
          .replace(/[\u00a0\u202f]/g, " ")
      : new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
          .format(convertedAmount)
          .replace(/[\u00a0\u202f]/g, " ");
  } else {
    amountStr = Math.round(amount) === amount
      ? amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
      : amount.toString();
    convertedStr = Math.round(convertedAmount) === convertedAmount
      ? Math.round(convertedAmount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
      : convertedAmount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  const formula = `${amountStr} ${fromCode} = ${convertedStr} ${toCode}`;
  const rateFormatted = formatRateNumber(rate, lang);
  const meta = `1 ${fromCode} = ${rateFormatted} ${toCode}`;

  return {
    value,
    formula,
    meta,
    fromCode,
    toCode,
    fromSymbol,
    toSymbol,
    amount,
    convertedAmount,
    formattedAmount: convertedStr,
    rate,
    stale: ratesData.stale,
    updatedAt: ratesData.updatedAt,
  };
}
