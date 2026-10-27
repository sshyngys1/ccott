// Owner: F1. Pill clock: HH:MM, refreshed once per minute, aligned to the start of the minute.
import { useEffect, useState } from "react";

export function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «пн, 26 окт.» */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
}

/** Milliseconds until the next minute boundary (always in 1..60000). */
export function msUntilNextMinute(date: Date): number {
  return 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
}

export function useClock(): string {
  const [text, setText] = useState(() => formatClock(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setText(formatClock(new Date()));
        schedule();
      }, msUntilNextMinute(new Date()));
    };
    setText(formatClock(new Date()));
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return text;
}
