import { describe, expect, it } from "vitest";
import {
  calendarDaysAgo,
  formatClockHM,
  formatNoteStamp,
  formatRelativeTime,
  formatTimerFace,
  formatTimerPill,
  formatTrackTime,
} from "./format";

// Local-time constructors: the helpers work in local time, so do the tests.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime();
const NOW = at(2026, 10, 27, 15, 30);

describe("formatRelativeTime", () => {
  it("just now", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("только что");
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("только что"); // clock skew
  });
  it("minutes", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1 мин назад");
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 мин назад");
  });
  it("hours within 24 h", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1 ч назад");
    expect(formatRelativeTime(NOW - 5 * 3_600_000, NOW)).toBe("5 ч назад");
    expect(formatRelativeTime(NOW - 23 * 3_600_000, NOW)).toBe("23 ч назад");
  });
  it("yesterday", () => {
    expect(formatRelativeTime(at(2026, 10, 26, 9), NOW)).toBe("вчера");
    expect(formatRelativeTime(at(2026, 10, 26, 15, 0), NOW)).toBe("вчера");
  });
  it("N days ago (дня / дней)", () => {
    expect(formatRelativeTime(at(2026, 10, 25, 9), NOW)).toBe("2 дня назад");
    expect(formatRelativeTime(at(2026, 10, 24, 9), NOW)).toBe("3 дня назад");
    expect(formatRelativeTime(at(2026, 10, 23, 9), NOW)).toBe("4 дня назад");
    expect(formatRelativeTime(at(2026, 10, 22, 9), NOW)).toBe("5 дней назад");
    expect(formatRelativeTime(at(2026, 10, 21, 9), NOW)).toBe("6 дней назад");
  });
  it("a week or more → short date", () => {
    expect(formatRelativeTime(at(2026, 10, 12, 9), NOW)).toBe("12 окт");
    expect(formatRelativeTime(at(2026, 1, 3, 9), NOW)).toBe("3 янв");
  });
  it("previous year includes the year", () => {
    expect(formatRelativeTime(at(2025, 12, 31, 9), NOW)).toBe("31 дек 2025");
  });
});

describe("formatNoteStamp", () => {
  it("today → time, yesterday → вчера, older → date", () => {
    expect(formatNoteStamp(at(2026, 10, 27, 9, 5), NOW)).toBe("09:05");
    expect(formatNoteStamp(at(2026, 10, 26, 23, 59), NOW)).toBe("вчера");
    expect(formatNoteStamp(at(2026, 10, 20, 8), NOW)).toBe("20 окт");
  });
});

describe("calendarDaysAgo / formatClockHM", () => {
  it("is calendar based, not 24 h based", () => {
    expect(calendarDaysAgo(at(2026, 10, 26, 23, 0), at(2026, 10, 27, 1, 0))).toBe(1);
    expect(calendarDaysAgo(at(2026, 10, 27, 0, 1), at(2026, 10, 27, 23, 59))).toBe(0);
  });
  it("pads", () => expect(formatClockHM(at(2026, 1, 1, 7, 3))).toBe("07:03"));
});

describe("formatTrackTime", () => {
  it("m:ss", () => {
    expect(formatTrackTime(0)).toBe("0:00");
    expect(formatTrackTime(84_000)).toBe("1:24");
    expect(formatTrackTime(221_999)).toBe("3:41");
  });
  it("hours", () => expect(formatTrackTime(3_723_000)).toBe("1:02:03"));
  it("garbage → 0:00", () => {
    expect(formatTrackTime(-5)).toBe("0:00");
    expect(formatTrackTime(NaN)).toBe("0:00");
  });
});

describe("timer formats", () => {
  it("rounds the remainder up", () => {
    expect(formatTimerFace(252_000)).toBe("04:12");
    expect(formatTimerFace(251_001)).toBe("04:12");
    expect(formatTimerFace(1)).toBe("00:01");
    expect(formatTimerFace(0)).toBe("00:00");
  });
  it("minutes above 59 stay minutes", () => expect(formatTimerFace(75 * 60_000)).toBe("75:00"));
  it("pill variant has no leading zero", () => {
    expect(formatTimerPill(252_000)).toBe("4:12");
    expect(formatTimerPill(0)).toBe("0:00");
    expect(formatTimerPill(NaN)).toBe("0:00");
  });
});
