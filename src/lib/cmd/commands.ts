// Owner: F2 (Frontend-Modules). Commands parser and executor (spec §6.10, contracts §20).
import { getLanguage, t, type Language, type TranslationKey } from "../../i18n";
import { ru } from "../../i18n/ru";
import { en } from "../../i18n/en";
import { runCapture } from "../capture/store";
import { useTimerStore } from "../timer/store";
import { useIslandStore } from "../../store";
import { showToast } from "../../shell/toast";

export interface CommandItem {
  id: string;
  kind: "command";
  title: string;
  subtitle: string;
  actionHint: string;
  iconType: "timer" | "capture" | "clipboard" | "note" | "settings";
  execute: () => void | Promise<void>;
}

export interface ParsedTimer {
  ms: number;
  durationLabel: string;
}

function formatDurationUnit(count: number, unit: "h" | "min" | "s", lang: Language): string {
  const numStr = lang === "ru" ? count.toString().replace(".", ",") : count.toString();
  const unitKey = (unit === "h" ? "cmdUnit_h" : unit === "min" ? "cmdUnit_min" : "cmdUnit_s") as TranslationKey;
  const dict = lang === "ru" ? ru : en;
  const unitStr = dict[unitKey];
  return `${numStr} ${unitStr}`;
}

/**
 * Parses timer duration from strings like:
 * - "10 мин", "10 минут", "10m", "10 min"
 * - "90s", "90с", "90 сек"
 * - "1:30" (1 min 30 sec)
 * - "1 ч 30 мин", "1h 30m"
 * - "2 ч", "2h"
 * - "10" (defaults to 10 min)
 */
export function parseTimerDuration(str: string, lang: Language = getLanguage()): ParsedTimer | null {
  const clean = str.trim().toLowerCase();
  if (!clean) return null;

  // 1) mm:ss format (e.g. 1:30 or 01:45)
  const colonMatch = /^(\d+):(\d+)$/.exec(clean);
  if (colonMatch) {
    const mins = Number.parseInt(colonMatch[1], 10);
    const secs = Number.parseInt(colonMatch[2], 10);
    const totalMs = (mins * 60 + secs) * 1000;
    const label = `${mins}:${secs.toString().padStart(2, "0")}`;
    return { ms: totalMs, durationLabel: label };
  }

  // 2) Combined hours + minutes (+ optional seconds), e.g. "1 ч 30 мин", "1h 30m", "2ч 15м"
  const combinedMatch =
    /^(\d+(?:[.,]\d+)?)\s*(?:ч|час(?:а|ов)?|h|hr|hrs|hours?)\s*(\d+(?:[.,]\d+)?)\s*(?:мин(?:ут(?:а|ы|))?|m|min|mins|minutes?)(?:\s*(\d+(?:[.,]\d+)?)\s*(?:с|сек(?:унд(?:а|ы|))?|s|sec|secs|seconds?))?$/iu.exec(
      clean,
    );
  if (combinedMatch) {
    const hours = Number.parseFloat(combinedMatch[1].replace(",", "."));
    const mins = Number.parseFloat(combinedMatch[2].replace(",", "."));
    const secs = combinedMatch[3] ? Number.parseFloat(combinedMatch[3].replace(",", ".")) : 0;
    const totalMs = Math.round(hours * 3600 * 1000 + mins * 60 * 1000 + secs * 1000);
    let label = `${formatDurationUnit(hours, "h", lang)} ${formatDurationUnit(mins, "min", lang)}`;
    if (secs > 0) {
      label += ` ${formatDurationUnit(secs, "s", lang)}`;
    }
    return { ms: totalMs, durationLabel: label };
  }

  // 3) Hours alone
  const hourMatch = /^(\d+(?:[.,]\d+)?)\s*(?:ч|час(?:а|ов)?|h|hr|hrs|hours?)$/iu.exec(clean);
  if (hourMatch) {
    const hours = Number.parseFloat(hourMatch[1].replace(",", "."));
    const totalMs = Math.round(hours * 3600 * 1000);
    return { ms: totalMs, durationLabel: formatDurationUnit(hours, "h", lang) };
  }

  // 4) Minutes alone
  const minMatch = /^(\d+(?:[.,]\d+)?)\s*(?:мин(?:ут(?:а|ы|))?|m|min|mins|minutes?)$/iu.exec(clean);
  if (minMatch) {
    const mins = Number.parseFloat(minMatch[1].replace(",", "."));
    const totalMs = Math.round(mins * 60 * 1000);
    return { ms: totalMs, durationLabel: formatDurationUnit(mins, "min", lang) };
  }

  // 5) Seconds alone
  const secMatch = /^(\d+(?:[.,]\d+)?)\s*(?:с|сек(?:унд(?:а|ы|))?|s|sec|secs|seconds?)$/iu.exec(clean);
  if (secMatch) {
    const secs = Number.parseFloat(secMatch[1].replace(",", "."));
    const totalMs = Math.round(secs * 1000);
    return { ms: totalMs, durationLabel: formatDurationUnit(secs, "s", lang) };
  }

  // 6) Bare number -> default to minutes
  const bareMatch = /^(\d+)$/.exec(clean);
  if (bareMatch) {
    const mins = Number.parseInt(bareMatch[1], 10);
    return { ms: mins * 60 * 1000, durationLabel: formatDurationUnit(mins, "min", lang) };
  }

  return null;
}

/**
 * Parses and returns command items matching the query.
 */
export function evaluateCommands(query: string, lang: Language = getLanguage()): CommandItem[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: CommandItem[] = [];

  // Check timer command: «таймер 10 мин», «timer 90s», etc.
  const timerMatch = /^(?:таймер|timer)(?:\s+(.*))?$/iu.exec(trimmed);
  if (timerMatch) {
    const durationStr = timerMatch[1] ?? "";
    const parsed = durationStr
      ? parseTimerDuration(durationStr, lang)
      : { ms: 5 * 60 * 1000, durationLabel: formatDurationUnit(5, "min", lang) };

    if (parsed && parsed.ms > 0) {
      const duration = parsed.durationLabel;
      results.push({
        id: `cmd-timer-${parsed.ms}`,
        kind: "command",
        title: t("cmdTimerTitle", { duration }),
        subtitle: t("cmdTimerSubtitle", { duration }),
        actionHint: t("cmdActionRun"),
        iconType: "timer",
        execute: () => {
          useTimerStore.getState().startDuration(parsed.ms);
          showToast({
            label: t("cmdTimerStarted", { duration }),
          });
        },
      });
    }
  }

  // Other system commands
  const q = trimmed.toLowerCase();

  // Screenshot / capture
  if (/^(?:скриншот|снимок|screen|screenshot|capture)$/iu.test(q)) {
    results.push({
      id: "cmd-screenshot",
      kind: "command",
      title: t("cmdCaptureTitle"),
      subtitle: t("cmdCaptureSubtitle"),
      actionHint: t("cmdCaptureAction"),
      iconType: "capture",
      execute: () => {
        void runCapture("region", "copy");
      },
    });
  }

  // Clipboard
  if (/^(?:буфер|буфер\s+обмена|клип|clipboard)$/iu.test(q)) {
    results.push({
      id: "cmd-clipboard",
      kind: "command",
      title: t("cmdClipboardTitle"),
      subtitle: t("cmdClipboardSubtitle"),
      actionHint: t("cmdActionOpen"),
      iconType: "clipboard",
      execute: () => {
        useIslandStore.getState().setActiveTab("clipboard");
        useIslandStore.getState().setView("tabs");
      },
    });
  }

  // Notes
  if (/^(?:заметка|заметки|note|notes)$/iu.test(q)) {
    results.push({
      id: "cmd-notes",
      kind: "command",
      title: t("cmdNotesTitle"),
      subtitle: t("cmdNotesSubtitle"),
      actionHint: t("cmdNotesAction"),
      iconType: "note",
      execute: async () => {
        const { useNotesStore } = await import("../notes/store");
        useNotesStore.getState().newNote(true);
        useIslandStore.getState().setActiveTab("notes");
        useIslandStore.getState().setView("tabs");
      },
    });
  }

  // Settings
  if (/^(?:настройки|параметры|settings|preferences)$/iu.test(q)) {
    results.push({
      id: "cmd-settings",
      kind: "command",
      title: t("cmdSettingsTitle"),
      subtitle: t("cmdSettingsSubtitle"),
      actionHint: t("cmdActionOpen"),
      iconType: "settings",
      execute: () => {
        useIslandStore.getState().setView("settings");
      },
    });
  }

  return results;
}
