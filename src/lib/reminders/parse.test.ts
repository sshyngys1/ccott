import { describe, expect, it } from "vitest";
import { isReminderCommand, parseReminder } from "./parse";

const now = new Date(2026, 10, 2, 10, 0).getTime(); // Monday, local time.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
describe("RU/EN reminder grammar", () => {
  it.each([
    ["напомни через 20 минут позвонить маме", "позвонить маме", 20],
    ["напомни мне через 2 часа Купить хлеб", "Купить хлеб", 120],
    ["через полчаса чай", "чай", 30],
    ["remind me in 2 hours to Call Mom", "Call Mom", 120],
    ["remind in 1 minute to stretch", "stretch", 1],
    ["in half an hour tea", "tea", 30],
    ["через 1,5 часа кофе", "кофе", 90],
    ["через 1 минуту кофе", "кофе", 1],
    ["через 5 мин. 🏝", "🏝", 5],
  ])("parses %s", (phrase, text, minutes) => expect(parseReminder(phrase, now)).toEqual({ text, dueAt: now + Number(minutes) * 60_000 }));
  it.each([
    ["завтра в 9 встреча", 3, 9, 0], ["tomorrow at 9 meeting", 3, 9, 0],
    ["в пятницу в 18:00 встреча", 6, 18, 0], ["on friday at 6pm meeting", 6, 18, 0],
    ["сегодня в 21:30 встреча", 2, 21, 30], ["today at 12am meeting", 3, 0, 0],
    ["at 12pm meeting", 2, 12, 0], ["в 9 встреча", 3, 9, 0],
    ["сегодня в 9 встреча", 3, 9, 0], ["в 10 встреча", 3, 10, 0],
    ["on monday at 9 meeting", 9, 9, 0], ["в понедельник в 11 встреча", 2, 11, 0],
    ["в воскресенье в 23:59 встреча", 8, 23, 59], ["on tuesday at 6:05am meeting", 3, 6, 5],
    ["в среду в 0 встреча", 4, 0, 0], ["в четверг в 17 встреча", 5, 17, 0],
    ["в субботу в 8 встреча", 7, 8, 0], ["во вторник в 6 встреча", 3, 6, 0],
  ])("uses local calendar for %s", (phrase, day, hour, minute) => expect(parseReminder(phrase, now)?.dueAt).toBe(at(day, hour, minute)));
  it.each(["", "напомни", "напомни купить хлеб", "через 0 минут чай", "через -1 час чай", "через полчаса", "tomorrow at 24:00 x", "at 13pm x", "at 0am x", "в 12:60 x", "завтра в 9", "in 2 days x", "unknown tomorrow at 9 x", "on someday at 6pm x", "at 6pm to ", `через 1 час ${"я".repeat(501)}`])("rejects %s", phrase => expect(parseReminder(phrase, now)).toBeNull());
  it("handles month/year transitions and Sunday to Monday", () => {
    expect(parseReminder("tomorrow at 9 x", new Date(2026, 11, 31, 23).getTime())?.dueAt).toBe(new Date(2027, 0, 1, 9).getTime());
    expect(parseReminder("on monday at 9 x", new Date(2026, 10, 8, 10).getTime())?.dueAt).toBe(new Date(2026, 10, 9, 9).getTime());
  });
  it.each(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])("resolves English weekday %s", day => {
    const expected = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(day);
    const parsed = parseReminder(`on ${day} at 11:15am Lunch`, now)!;
    expect(new Date(parsed.dueAt).getDay()).toBe(expected);
    expect(new Date(parsed.dueAt).getHours()).toBe(11);
    expect(parsed.text).toBe("Lunch");
  });
  it("validates finite/range limits and counts Unicode characters", () => {
    expect(parseReminder("in 1 hour x", NaN)).toBeNull();
    expect(parseReminder(`in ${"9".repeat(400)} hours x`, now)).toBeNull();
    expect(parseReminder(`in 1 hour ${"🏝".repeat(500)}`, now)?.text).toHaveLength(1000);
  });
  it("only reserves explicit command prefixes", () => {
    expect(isReminderCommand("Напомни через полчаса чай")).toBe(true);
    expect(isReminderCommand(" REMIND me in 2 hours to call")).toBe(true);
    expect(isReminderCommand("reminder app")).toBe(false);
  });
});
