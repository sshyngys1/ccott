export interface ParsedReminder { text: string; dueAt: number }

/** Deliberately bounded RU/EN grammar. Dates use the user's local calendar (including DST). */
export function parseReminder(input: string, now = Date.now()): ParsedReminder | null {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return null;
  const source = input.trim().replace(/^(?:напомни(?:\s+мне)?|remind(?:\s+me)?)\s+/iu, "");
  let text: string;
  let dueAt: number;
  const half = /^(?:через\s+полчаса|in\s+(?:half\s+an?\s+hour|half\s+hour))\s+(.+)$/isu.exec(source);
  const relative = /^(?:через|in)\s+(\d+(?:[.,]\d+)?)\s*(минут(?:у|ы)?|мин\.?|час(?:а|ов)?|ч\.?|minutes?|mins?\.?|hours?|hrs?\.?)\s+(.+)$/isu.exec(source);
  if (half || relative) {
    const amount = half ? 30 : Number(relative![1].replace(",", "."));
    const minutes = half || /^(?:м|m)/iu.test(relative![2]);
    dueAt = now + amount * (minutes ? 60_000 : 3_600_000);
    text = (half ? half[1] : relative![3]).replace(/^to(?:\s+|$)/iu, "").trim();
    if (amount <= 0 || dueAt <= now) return null;
  } else {
    const absolute = /^(?:(сегодня|завтра|today|tomorrow)\s+(?:в|at)\s+|(?:во|в|on)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:в|at)\s+|(?:в|at)\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)$/isu.exec(source);
    if (!absolute) return null;
    let hour = Number(absolute[3]);
    const minute = Number(absolute[4] ?? 0);
    if (minute > 59 || (absolute[5] ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (absolute[5]) hour = hour % 12 + (/pm/i.test(absolute[5]) ? 12 : 0);
    const date = new Date(now);
    let days = /^(?:завтра|tomorrow)$/iu.test(absolute[1] ?? "") ? 1 : 0;
    if (absolute[2]) {
      const weekdays = [/^(?:воскресенье|sunday)$/iu, /^(?:понедельник|monday)$/iu, /^(?:вторник|tuesday)$/iu, /^(?:среду|wednesday)$/iu, /^(?:четверг|thursday)$/iu, /^(?:пятницу|friday)$/iu, /^(?:субботу|saturday)$/iu];
      days = (weekdays.findIndex(day => day.test(absolute[2])) - date.getDay() + 7) % 7;
    }
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    if (date.getTime() <= now) date.setDate(date.getDate() + (absolute[2] ? 7 : 1));
    // A nonexistent local wall time during the spring DST transition is ambiguous.
    if (date.getHours() !== hour || date.getMinutes() !== minute) return null;
    dueAt = date.getTime();
    text = absolute[6].replace(/^to(?:\s+|$)/iu, "").trim();
  }
  if (!text || [...text].length > 500 || !Number.isFinite(dueAt) || !Number.isFinite(new Date(dueAt).getTime())) return null;
  return { text, dueAt };
}

export function isReminderCommand(input: string): boolean {
  return /^(?:напомни|remind)(?:\s|$)/iu.test(input.trim());
}
