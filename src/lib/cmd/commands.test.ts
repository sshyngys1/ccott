import { describe, expect, it, vi } from "vitest";
import { evaluateCommands, parseTimerDuration } from "./commands";
import { useTimerStore } from "../timer/store";
import { setLanguage } from "../../i18n";

describe("commands parser", () => {
  it("parses timer duration from various formats in RU and EN", () => {
    // RU
    setLanguage("ru");
    expect(parseTimerDuration("10 мин", "ru")?.ms).toBe(600_000);
    expect(parseTimerDuration("10 мин", "ru")?.durationLabel).toBe("10 мин");
    expect(parseTimerDuration("10 минут", "ru")?.ms).toBe(600_000);
    expect(parseTimerDuration("10m", "ru")?.ms).toBe(600_000);
    expect(parseTimerDuration("90s", "ru")?.ms).toBe(90_000);
    expect(parseTimerDuration("90с", "ru")?.ms).toBe(90_000);
    expect(parseTimerDuration("90 с", "ru")?.durationLabel).toBe("90 с");
    expect(parseTimerDuration("1:30", "ru")?.ms).toBe(90_000);
    expect(parseTimerDuration("1:30", "ru")?.durationLabel).toBe("1:30");
    expect(parseTimerDuration("2 ч", "ru")?.ms).toBe(7_200_000);
    expect(parseTimerDuration("2 ч", "ru")?.durationLabel).toBe("2 ч");
    expect(parseTimerDuration("1 ч 30 мин", "ru")?.ms).toBe(5_400_000);
    expect(parseTimerDuration("1 ч 30 мин", "ru")?.durationLabel).toBe("1 ч 30 мин");
    expect(parseTimerDuration("5", "ru")?.ms).toBe(300_000);

    // EN
    setLanguage("en");
    expect(parseTimerDuration("10 min", "en")?.ms).toBe(600_000);
    expect(parseTimerDuration("10 min", "en")?.durationLabel).toBe("10 min");
    expect(parseTimerDuration("90 s", "en")?.ms).toBe(90_000);
    expect(parseTimerDuration("90 s", "en")?.durationLabel).toBe("90 s");
    expect(parseTimerDuration("1:30", "en")?.ms).toBe(90_000);
    expect(parseTimerDuration("1:30", "en")?.durationLabel).toBe("1:30");
    expect(parseTimerDuration("2 h", "en")?.ms).toBe(7_200_000);
    expect(parseTimerDuration("2 h", "en")?.durationLabel).toBe("2 h");
    expect(parseTimerDuration("1 h 30 min", "en")?.ms).toBe(5_400_000);
    expect(parseTimerDuration("1 h 30 min", "en")?.durationLabel).toBe("1 h 30 min");
  });

  it("evaluates timer command and generates localized actions in RU and EN", () => {
    // RU
    setLanguage("ru");
    const itemsRu = evaluateCommands("таймер 10 мин", "ru");
    expect(itemsRu).toHaveLength(1);
    expect(itemsRu[0].kind).toBe("command");
    expect(itemsRu[0].iconType).toBe("timer");
    expect(itemsRu[0].title).toBe("Таймер 10 мин");
    expect(itemsRu[0].subtitle).toBe("Запустить таймер на 10 мин");

    // Execute
    const startDurationSpy = vi.spyOn(useTimerStore.getState(), "startDuration");
    itemsRu[0].execute();
    expect(startDurationSpy).toHaveBeenCalledWith(600_000);

    // EN
    setLanguage("en");
    const itemsEn = evaluateCommands("timer 10 min", "en");
    expect(itemsEn).toHaveLength(1);
    expect(itemsEn[0].title).toBe("Timer 10 min");
    expect(itemsEn[0].subtitle).toBe("Start timer for 10 min");
  });

  it("evaluates other system commands", () => {
    expect(evaluateCommands("скриншот")).toHaveLength(1);
    expect(evaluateCommands("screenshot")).toHaveLength(1);
    expect(evaluateCommands("буфер")).toHaveLength(1);
    expect(evaluateCommands("clipboard")).toHaveLength(1);
    expect(evaluateCommands("настройки")).toHaveLength(1);
  });

  it("returns empty array for non-matching queries", () => {
    expect(evaluateCommands("")).toEqual([]);
    expect(evaluateCommands("telegram")).toEqual([]);
  });
});
