// Time formatting helpers (ru). All take `now` so they are deterministic in tests.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;

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
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** «14:32» */
export function formatClockHM(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function daysWord(n: number): string {
  const m10 = n % 10;
  return m10 >= 2 && m10 <= 4 && (n < 12 || n > 14) ? "дня" : "дней";
}

/** «только что / N мин назад / N ч назад / вчера / N дня назад / 12 окт» */
export function formatRelativeTime(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < MIN) return "только что"; // also future timestamps (clock skew)
  if (diff < HOUR) return `${Math.floor(diff / MIN)} мин назад`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`;
  const days = calendarDaysAgo(ts, now);
  if (days <= 1) return "вчера";
  if (days < 7) return `${days} ${daysWord(days)} назад`;
  return formatShortDate(ts, now);
}

/** Notes list stamp: today → «14:32», yesterday → «вчера», otherwise «12 окт». */
export function formatNoteStamp(ts: number, now: number): string {
  const days = calendarDaysAgo(ts, now);
  if (days <= 0) return formatClockHM(ts);
  if (days === 1) return "вчера";
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
