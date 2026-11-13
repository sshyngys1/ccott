import { getLocale, pluralCategory, t, type TranslationKey } from "../../i18n";
import type { DownloadItem } from "../../shared/types";

export function formatBytes(bytes: number, locale = getLocale()): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const power = Math.min(4, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)));
  const units = ["downloads.bytes", "downloads.kb", "downloads.mb", "downloads.gb", "downloads.tb"] as const;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: power ? 1 : 0 }).format(value / 1024 ** power)} ${t(units[power])}`;
}

export function downloadsTitle(active: DownloadItem[]): string {
  if (active.length <= 1) return active[0]?.name || t("downloads.loading");
  const category = pluralCategory(active.length);
  const suffix = ["one", "few", "many"].includes(category) ? category : "other";
  return t(`downloads.count.${suffix}` as TranslationKey, { count: active.length });
}

export function downloadsSummary(active: DownloadItem[]): { detail: string; percent: number | null } {
  const received = active.reduce((sum, item) => sum + item.receivedBytes, 0);
  const knownSpeed = active.every((item) => item.bytesPerSec !== null);
  const speed = knownSpeed ? active.reduce((sum, item) => sum + (item.bytesPerSec ?? 0), 0) : null;
  const total = active.length > 0 && active.every((item) => item.totalBytes !== null && item.totalBytes > 0)
    ? active.reduce((sum, item) => sum + (item.totalBytes ?? 0), 0) : null;
  return {
    detail: `${formatBytes(received)} · ${speed === null ? t("downloads.speedUnknown") : t("downloads.speed", { size: formatBytes(speed) })}`,
    percent: total === null ? null : Math.min(100, Math.max(0, Math.round(received / total * 100))),
  };
}
