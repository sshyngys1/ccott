import { useEffect } from "react";
import { t } from "../i18n";
import { invoke, listen, type Unlisten } from "../ipc";
import { isFeatureEnabled, useFeatureEnabled } from "../lib/features";
import { playChime } from "../lib/timer/chime";
import { useIslandStore } from "../store";
import type { Reminder } from "../shared/types";

let sequence = 0;

export function useReminderDue(): void {
  const enabled = useFeatureEnabled("notes");
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const stops: Unlisten[] = [];
    let waiting: Reminder[] = [];
    let active: Reminder | undefined;
    const display = (item: Reminder) => {
      if (disposed || !isFeatureEnabled("notes") || item.done) return;
      const store = useIslandStore.getState();
      active = item;
      const id = --sequence;
      const action = async (patch: { done: true } | { dueAt: number }) => {
        if (!isFeatureEnabled("notes")) return;
        try {
          await invoke("reminders_update", { id: item.id, patch });
          if (useIslandStore.getState().toast?.id === id) useIslandStore.getState().setToast(null);
        } catch {
          if (useIslandStore.getState().toast?.id === id) useIslandStore.getState().setToast({ ...useIslandStore.getState().toast!, label: t("reminders.error") });
        }
      };
      // Intentional DND exception: keep the reminder visible, suppress only the sound.
      store.setToast({ id, reminderId: item.id, holdMs: 10_000, label: t("reminders.title"), preview: item.text, title: item.text,
        actions: [
          { label: t("reminders.done"), icon: "file", text: true, onClick: () => { void action({ done: true }); } },
          { label: t("reminders.snooze"), icon: "folder", text: true, onClick: () => { void action({ dueAt: Date.now() + 600_000 }); } },
        ],
      });
      if (!store.doNotDisturb) playChime();
    };
    const pump = () => {
      if (disposed || !isFeatureEnabled("notes") || useIslandStore.getState().toast?.reminderId) return;
      const item = waiting.shift();
      if (item) display(item);
    };
    const show = (item: Reminder) => {
      if (disposed || item.done || !isFeatureEnabled("notes")) return;
      if (active?.id === item.id && active.dueAt === item.dueAt) return;
      if (!waiting.some(r => r.id === item.id && r.dueAt === item.dueAt)) waiting.push(item);
      pump();
    };
    // Simultaneous future deadlines must each get a visible toast, rather than
    // replacing one another in the same frame. Reuse the shell's hold timer.
    stops.push(useIslandStore.subscribe((state, previous) => {
      if (state.toast !== previous.toast && !state.toast?.reminderId) { active = undefined; pump(); }
    }));
    // Install changed first; due subscription tells Rust that startup delivery is safe.
    void (async () => {
      const changed = await listen("reminders://changed", items => {
        if (disposed || !isFeatureEnabled("notes")) return;
        waiting = waiting.filter(queued => items.some(r => r.id === queued.id && r.dueAt === queued.dueAt && !r.done));
        const toast = useIslandStore.getState().toast;
        if (toast?.reminderId && !items.some(r => r.id === toast.reminderId && !r.done && r.dueAt <= Date.now())) useIslandStore.getState().setToast(null);
      });
      if (disposed) { changed(); return; }
      stops.push(changed);
      const due = await listen("reminders://due", show);
      if (disposed) due(); else stops.push(due);
    })().catch(() => { stops.splice(0).forEach(stop => stop()); });
    return () => {
      disposed = true;
      stops.forEach(stop => stop());
      if (useIslandStore.getState().toast?.reminderId) useIslandStore.getState().setToast(null);
    };
  }, [enabled]);
}
