import type { Language } from "../../i18n";
import {
  cachedCurrencyCatalog,
  findCurrency,
  getActiveCurrencyCodes,
  parseCurrencyQuery,
  type CurrencyRates,
} from "./currency";
import { evaluateUnits } from "./units";

export interface CurrencyCompletion {
  prefix: string;
  fragment: string;
  base: string;
}

/** Only incomplete currency tokens compete with Enter; complete queries keep copy/launch. */
export function currencyCompletion(query: string): CurrencyCompletion | null {
  if (evaluateUnits(query)) return null;
  const catalog = cachedCurrencyCatalog();
  const inCatalog = (code: string) => !catalog || catalog.base === code || catalog.rates[code] !== undefined;

  const target = /^(.*\s(?:в|to)\s+)([\p{L} ]*)$/iu.exec(query);
  if (target) {
    const source = parseCurrencyQuery(target[1].replace(/\s(?:в|to)\s+$/iu, ""));
    const frag = target[2].trim();
    const found = findCurrency(frag);
    if (!source || (found && inCatalog(found.code))) return null;
    return { prefix: target[1], fragment: frag, base: source.fromCode };
  }
  const source = /^(\s*\d+(?:[.,]\d+)?\s*)(\p{L}[\p{L} ]*)$/u.exec(query);
  if (!source) return null;
  const frag = source[2].trim();
  const found = findCurrency(frag);
  if (found && inCatalog(found.code)) return null;
  const parsed = parseCurrencyQuery(query);
  if (parsed && inCatalog(parsed.fromCode) && inCatalog(parsed.toCode)) return null;
  const codes = [...getActiveCurrencyCodes()];
  if (!matchingCurrencyCodes(frag, codes).length) return null;
  return { prefix: source[1], fragment: frag, base: "USD" };
}

export function currencyName(code: string, language: Language): string {
  return new Intl.DisplayNames([language], { type: "currency" }).of(code) ?? code;
}

export function currencySuggestions(fragment: string, catalog: CurrencyRates | null): string[] {
  if (!catalog) return [];
  return matchingCurrencyCodes(fragment, [catalog.base, ...Object.keys(catalog.rates)]);
}

function matchingCurrencyCodes(fragment: string, catalogCodes: readonly string[]): string[] {
  const query = fragment.trim().toLocaleLowerCase();
  const codes = [...new Set(catalogCodes)]
    .filter(code => /^[A-Z]{3}$/.test(code));
  const rank = (code: string) => {
    if (code.toLowerCase() === query) return 0;
    if (code.toLowerCase().startsWith(query)) return 1;
    const names = (["ru", "en"] as const).map(language => currencyName(code, language).toLocaleLowerCase());
    if (names.some(name => name.startsWith(query))) return 2;
    if (names.some(name => name.split(/[\s-]+/u).some(word => word.startsWith(query)))) return 3;
    return Infinity;
  };
  return codes.map(code => ({ code, rank: rank(code) })).filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code)).map(item => item.code);
}
