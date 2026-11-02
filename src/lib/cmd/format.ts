// Owner: F2 (Frontend-Modules). Number & formatting utilities for Command Bar (spec §6.10, contracts §20).
import { getLanguage, type Language } from "../../i18n";

/**
 * Formats a number according to the interface language.
 * RU: comma decimal separator, space thousands separator (Intl.NumberFormat),
 *     at most 4 decimal digits, without trailing zeros.
 * EN: dot decimal separator, space thousands grouping,
 *     at most 4 decimal digits, without trailing zeros.
 */
export function formatCmdNumber(n: number, lang: Language = getLanguage()): string {
  if (!Number.isFinite(n)) return "";

  if (lang === "ru") {
    const formatted = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 4,
      useGrouping: true,
    }).format(n);
    return formatted.replace(/[\u00a0\u202f]/g, " ");
  }

  // EN: as currently (dot decimal separator, space thousands grouping, up to 4 fraction digits without trailing zeros)
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    const parts = Math.round(n).toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return parts.join(".");
  }

  const rounded = Number(Math.round(Number(n + "e+4")) + "e-4");
  const str = rounded.toString();
  const parts = str.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return parts.join(".");
}
