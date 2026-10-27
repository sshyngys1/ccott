// Locale-aware time helpers. All take `now` so they are deterministic in tests.
import { t, getLocale } from "../../i18n";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Whole calendar days between two timestamps in local time (0 = same day, 1 = yesterday …). */
export function calendarDaysAgo(ts: number, now: number): number {
  const a = new Date(ts);
  const b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / DAY);
}

/** «12 окт» (with the year when it differs from the current one). */
export function formatShortDate(ts: number, now: number): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat(getLocale(), {
    day: "numeric", month: "short",
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" as const }),
  }).formatToParts(d).filter((p) => ["day", "month", "year"].includes(p.type))
    .map((p) => p.type === "month" ? p.value.replace(/\.$/, "") : p.value).join(" ");
}

/** «14:32» */
export function formatClockHM(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts);
}

/** «только что / N мин назад / N ч назад / вчера / N дня назад / 12 окт» */
export function formatRelativeTime(ts: number, now: number): string {
  const diff = now - ts;
  const relative = (value: number, unit: Intl.RelativeTimeFormatUnit, style: "short" | "long" = "short") =>
    new Intl.RelativeTimeFormat(getLocale(), { numeric: "always", style }).format(-value, unit).replace(/\./g, "").replace(/\u00a0/g, " ");
  if (diff < MIN) return t("justNow"); // also future timestamps (clock skew)
  if (diff < HOUR) return relative(Math.floor(diff / MIN), "minute");
  if (diff < DAY) return relative(Math.floor(diff / HOUR), "hour");
  const days = calendarDaysAgo(ts, now);
  if (days <= 1) return t("yesterday");
  if (days < 7) return relative(days, "day", "long");
  return formatShortDate(ts, now);
}

/** Notes list stamp: today → «14:32», yesterday → «вчера», otherwise «12 окт». */
export function formatNoteStamp(ts: number, now: number): string {
  const days = calendarDaysAgo(ts, now);
  if (days <= 0) return formatClockHM(ts);
  if (days === 1) return t("yesterday");
  return formatShortDate(ts, now);
}

/** Track position: «1:24», «1:02:03». Negative / NaN → «0:00». */
export function formatTrackTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Remaining time rounded *up* to whole seconds, so «00:00» is shown only when the timer is really done. */
function ceilSeconds(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** Timer face: «04:12» (minutes can exceed 59: «75:00»). */
export function formatTimerFace(ms: number): string {
  const total = ceilSeconds(ms);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Timer in the pill: «4:12» (minutes without a leading zero). */
export function formatTimerPill(ms: number): string {
  const total = ceilSeconds(ms);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}
