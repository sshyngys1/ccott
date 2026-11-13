// Owner: F2 (Frontend-Modules). Physical units parser & converter (spec §6.10, contracts §20).
// Categories: length, mass, temperature, volume, speed, data, time.
import { getLanguage, type Language, type TranslationKey } from "../../i18n";
import { ru } from "../../i18n/ru";
import { en } from "../../i18n/en";
import { formatCmdNumber } from "./format";

export interface UnitResult {
  value: string;
  formula: string;
  meta?: string;
  category: "length" | "mass" | "temperature" | "volume" | "speed" | "data" | "time";
  fromUnit: string;
  toUnit: string;
  numericValue: number;
  formattedNumber: string;
}

interface UnitSpec {
  id: string;
  category: "length" | "mass" | "temperature" | "volume" | "speed" | "data" | "time";
  primarySymbol: string;
  pattern: RegExp;
  toBase: (val: number) => number;
  fromBase: (baseVal: number) => number;
}

const UNITS: UnitSpec[] = [
  // ── Length (base: meter) ──
  {
    id: "mm",
    category: "length",
    primarySymbol: "mm",
    pattern: /^(?:mm|мм|миллиметр(?:а|ов)?|millimeter|millimeters)$/iu,
    toBase: (v) => v / 1000,
    fromBase: (b) => b * 1000,
  },
  {
    id: "cm",
    category: "length",
    primarySymbol: "cm",
    pattern: /^(?:cm|см|сантиметр(?:а|ов)?|centimeter|centimeters)$/iu,
    toBase: (v) => v / 100,
    fromBase: (b) => b * 100,
  },
  {
    id: "m",
    category: "length",
    primarySymbol: "m",
    pattern: /^(?:m|м|метр(?:а|ов)?|meter|meters)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "km",
    category: "length",
    primarySymbol: "km",
    pattern: /^(?:km|км|километр(?:а|ов)?|kilometer|kilometers)$/iu,
    toBase: (v) => v * 1000,
    fromBase: (b) => b / 1000,
  },
  {
    id: "in",
    category: "length",
    primarySymbol: "in",
    pattern: /^(?:in|дюйм(?:а|ов)?|inch|inches)$/iu,
    toBase: (v) => v * 0.0254,
    fromBase: (b) => b / 0.0254,
  },
  {
    id: "ft",
    category: "length",
    primarySymbol: "ft",
    pattern: /^(?:ft|фут(?:а|ов)?|foot|feet)$/iu,
    toBase: (v) => v * 0.3048,
    fromBase: (b) => b / 0.3048,
  },
  {
    id: "yd",
    category: "length",
    primarySymbol: "yd",
    pattern: /^(?:yd|ярд(?:а|ов)?|yard|yards)$/iu,
    toBase: (v) => v * 0.9144,
    fromBase: (b) => b / 0.9144,
  },
  {
    id: "mi",
    category: "length",
    primarySymbol: "mi",
    pattern: /^(?:mi|мил(?:я|и|ей|ь)|mile|miles)$/iu,
    toBase: (v) => v * 1609.344,
    fromBase: (b) => b / 1609.344,
  },

  // ── Mass (base: gram) ──
  {
    id: "mg",
    category: "mass",
    primarySymbol: "mg",
    pattern: /^(?:mg|мг|миллиграмм(?:а|ов)?|milligram|milligrams)$/iu,
    toBase: (v) => v / 1000,
    fromBase: (b) => b * 1000,
  },
  {
    id: "g",
    category: "mass",
    primarySymbol: "g",
    pattern: /^(?:g|г|грамм(?:а|ов)?|gram|grams)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "kg",
    category: "mass",
    primarySymbol: "kg",
    pattern: /^(?:kg|кг|килограмм(?:а|ов)?|kilogram|kilograms)$/iu,
    toBase: (v) => v * 1000,
    fromBase: (b) => b / 1000,
  },
  {
    id: "t",
    category: "mass",
    primarySymbol: "t",
    pattern: /^(?:t|т|тонн(?:а|ы|)?|ton|tonne|tons|tonnes)$/iu,
    toBase: (v) => v * 1_000_000,
    fromBase: (b) => b / 1_000_000,
  },
  {
    id: "oz",
    category: "mass",
    primarySymbol: "oz",
    pattern: /^(?:oz|унц(?:ия|ии|ий)|ounce|ounces)$/iu,
    toBase: (v) => v * 28.349523125,
    fromBase: (b) => b / 28.349523125,
  },
  {
    id: "lb",
    category: "mass",
    primarySymbol: "lb",
    pattern: /^(?:lb|lbs|фунт(?:а|ов)?|pound|pounds)$/iu,
    toBase: (v) => v * 453.59237,
    fromBase: (b) => b / 453.59237,
  },

  // ── Temperature (base: Celsius) ──
  {
    id: "c",
    category: "temperature",
    primarySymbol: "°C",
    pattern: /^(?:c|°c|цельси(?:й|я)|celsius)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "f",
    category: "temperature",
    primarySymbol: "°F",
    pattern: /^(?:f|°f|фаренгейт(?:а)?|fahrenheit)$/iu,
    toBase: (v) => ((v - 32) * 5) / 9,
    fromBase: (b) => (b * 9) / 5 + 32,
  },
  {
    id: "k",
    category: "temperature",
    primarySymbol: "K",
    pattern: /^(?:k|°k|кельвин(?:а)?|kelvin)$/iu,
    toBase: (v) => v - 273.15,
    fromBase: (b) => b + 273.15,
  },

  // ── Volume (base: milliliter) ──
  {
    id: "ml",
    category: "volume",
    primarySymbol: "ml",
    pattern: /^(?:ml|мл|миллилитр(?:а|ов)?|milliliter|milliliters)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "l",
    category: "volume",
    primarySymbol: "l",
    pattern: /^(?:l|л|литр(?:а|ов)?|liter|liters)$/iu,
    toBase: (v) => v * 1000,
    fromBase: (b) => b / 1000,
  },
  {
    id: "gal",
    category: "volume",
    primarySymbol: "gal",
    pattern: /^(?:gal|галлон(?:а|ов)?|gallon|gallons)$/iu,
    toBase: (v) => v * 3785.411784,
    fromBase: (b) => b / 3785.411784,
  },
  {
    id: "floz",
    category: "volume",
    primarySymbol: "fl oz",
    pattern: /^(?:fl\s*oz|floz|жидк(?:ая|ой|их)\s*унц(?:ия|ии|ий)|fluid\s*ounce)$/iu,
    toBase: (v) => v * 29.5735295625,
    fromBase: (b) => b / 29.5735295625,
  },
  {
    id: "cup",
    category: "volume",
    primarySymbol: "cup",
    pattern: /^(?:cup|чашк(?:а|и|ек)|cups)$/iu,
    toBase: (v) => v * 236.5882365,
    fromBase: (b) => b / 236.5882365,
  },

  // ── Speed (base: m/s) ──
  {
    id: "mps",
    category: "speed",
    primarySymbol: "m/s",
    pattern: /^(?:m\/s|м\/с|м\/сек|meters\s*per\s*second)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "kmh",
    category: "speed",
    primarySymbol: "km/h",
    pattern: /^(?:km\/h|kmh|км\/ч|км\/час|kph|kilometers\s*per\s*hour)$/iu,
    toBase: (v) => v / 3.6,
    fromBase: (b) => b * 3.6,
  },
  {
    id: "mph",
    category: "speed",
    primarySymbol: "mph",
    pattern: /^(?:mph|миль\/ч|миль\/час|miles\s*per\s*hour)$/iu,
    toBase: (v) => v * 0.44704,
    fromBase: (b) => b / 0.44704,
  },
  {
    id: "knot",
    category: "speed",
    primarySymbol: "kn",
    pattern: /^(?:kn|knot|knots|узел|узл(?:а|ов))$/iu,
    toBase: (v) => v * 0.514444444,
    fromBase: (b) => b / 0.514444444,
  },

  // ── Data (base: bytes, 1024 standard) ──
  {
    id: "b",
    category: "data",
    primarySymbol: "B",
    pattern: /^(?:b|б|байт(?:а|ов)?|byte|bytes)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "kb",
    category: "data",
    primarySymbol: "KB",
    pattern: /^(?:kb|кб|килобайт(?:а|ов)?|kilobyte|kilobytes)$/iu,
    toBase: (v) => v * 1024,
    fromBase: (b) => b / 1024,
  },
  {
    id: "mb",
    category: "data",
    primarySymbol: "MB",
    pattern: /^(?:mb|мб|мегабайт(?:а|ов)?|megabyte|megabytes)$/iu,
    toBase: (v) => v * 1024 * 1024,
    fromBase: (b) => b / (1024 * 1024),
  },
  {
    id: "gb",
    category: "data",
    primarySymbol: "GB",
    pattern: /^(?:gb|гб|гигабайт(?:а|ов)?|gigabyte|gigabytes)$/iu,
    toBase: (v) => v * 1024 * 1024 * 1024,
    fromBase: (b) => b / (1024 * 1024 * 1024),
  },
  {
    id: "tb",
    category: "data",
    primarySymbol: "TB",
    pattern: /^(?:tb|тб|терабайт(?:а|ов)?|terabyte|terabytes)$/iu,
    toBase: (v) => v * 1024 * 1024 * 1024 * 1024,
    fromBase: (b) => b / (1024 * 1024 * 1024 * 1024),
  },

  // ── Time (base: seconds) ──
  {
    id: "ms",
    category: "time",
    primarySymbol: "ms",
    pattern: /^(?:ms|мс|миллисекунд(?:а|ы|)?|millisecond|milliseconds)$/iu,
    toBase: (v) => v / 1000,
    fromBase: (b) => b * 1000,
  },
  {
    id: "s",
    category: "time",
    primarySymbol: "s",
    pattern: /^(?:s|с|сек|секунд(?:а|ы|)|second|seconds)$/iu,
    toBase: (v) => v,
    fromBase: (b) => b,
  },
  {
    id: "min",
    category: "time",
    primarySymbol: "min",
    pattern: /^(?:min|мин|минут(?:а|ы|)|minute|minutes)$/iu,
    toBase: (v) => v * 60,
    fromBase: (b) => b / 60,
  },
  {
    id: "h",
    category: "time",
    primarySymbol: "h",
    pattern: /^(?:h|hr|hrs|ч|час(?:а|ов)?|hour|hours)$/iu,
    toBase: (v) => v * 3600,
    fromBase: (b) => b / 3600,
  },
  {
    id: "d",
    category: "time",
    primarySymbol: "d",
    pattern: /^(?:d|д|дн|ден(?:ь|я)|дней|day|days|сут|сут(?:ка|ки|ок))$/iu,
    toBase: (v) => v * 86400,
    fromBase: (b) => b / 86400,
  },
  {
    id: "wk",
    category: "time",
    primarySymbol: "wk",
    pattern: /^(?:wk|нед|недел(?:я|и|ь)|week|weeks)$/iu,
    toBase: (v) => v * 604800,
    fromBase: (b) => b / 604800,
  },
  {
    id: "yr",
    category: "time",
    primarySymbol: "yr",
    pattern: /^(?:yr|г|год(?:а)?|лет|year|years)$/iu,
    toBase: (v) => v * 31536000,
    fromBase: (b) => b / 31536000,
  },
];

function findUnit(str: string): UnitSpec | undefined {
  const clean = str.trim().toLowerCase();
  return UNITS.find((u) => u.pattern.test(clean));
}

function getLocalizedSymbol(unit: UnitSpec, lang: Language): string {
  const key = `cmdUnit_${unit.id}` as TranslationKey;
  const dict = lang === "ru" ? ru : en;
  return dict[key] ?? unit.primarySymbol;
}

/**
 * Parses queries like "5 км в мили", "10 lb to kg", "100 f в c", "16 gb in mb".
 */
export function evaluateUnits(query: string, lang: Language = getLanguage()): UnitResult | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Match pattern: <amount><unit1> (в|to|into|in) <unit2>
  const match = /^([+-]?\d+(?:[.,]\d+)?)\s*([^\d\s]+(?:\s+[^\d\s]+)?)\s+(?:в|to|into|in)\s+([^\d\s]+(?:\s+[^\d\s]+)?)$/iu.exec(
    trimmed,
  );

  if (!match) return null;

  const amountStr = match[1].replace(",", ".");
  const amount = Number.parseFloat(amountStr);
  if (Number.isNaN(amount)) return null;

  const rawUnit1 = match[2];
  const rawUnit2 = match[3];

  const u1 = findUnit(rawUnit1);
  const u2 = findUnit(rawUnit2);

  if (!u1 || !u2) return null;
  if (u1.category !== u2.category) return null;

  // Convert
  const baseVal = u1.toBase(amount);
  const targetVal = u2.fromBase(baseVal);

  const sym1 = getLocalizedSymbol(u1, lang);
  const sym2 = getLocalizedSymbol(u2, lang);

  const formattedTarget = formatCmdNumber(targetVal, lang);
  const formattedSource = formatCmdNumber(amount, lang);

  // Example: 5 km = 3.1069 mi (or 5 км = 3,1069 мили)
  const formula = `${formattedSource} ${sym1} = ${formattedTarget} ${sym2}`;
  const value = `= ${formattedTarget} ${sym2}`;

  // Calculate 1 u1 in u2 for meta
  const oneBase = u1.toBase(1);
  const oneTarget = u2.fromBase(oneBase);
  const meta = `${formatCmdNumber(1, lang)} ${sym1} = ${formatCmdNumber(oneTarget, lang)} ${sym2}`;

  return {
    value,
    formula,
    meta,
    category: u1.category,
    fromUnit: u1.primarySymbol,
    toUnit: u2.primarySymbol,
    numericValue: targetVal,
    formattedNumber: formattedTarget,
  };
}
