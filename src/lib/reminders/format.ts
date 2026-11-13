import { getLocale, t } from "../../i18n";
import type { ParsedReminder } from "./parse";

export const formatReminderTime = (dueAt: number): string => new Intl.DateTimeFormat(getLocale(), {
  weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(dueAt);

export const reminderPreview = (item: ParsedReminder): string => t("reminders.preview", { when: formatReminderTime(item.dueAt), text: item.text });
