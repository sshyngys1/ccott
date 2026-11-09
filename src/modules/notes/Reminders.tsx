import { useEffect, useMemo, useRef, useState } from "react";
import { t, useT } from "../../i18n";
import { invoke, listen, type Unlisten } from "../../ipc";
import { isFeatureEnabled, useFeatureEnabled } from "../../lib/features";
import { parseReminder } from "../../lib/reminders/parse";
import { formatReminderTime, reminderPreview } from "../../lib/reminders/format";
import { primeAudio } from "../../lib/timer/chime";
import { requestShell } from "../../shared/shellBus";
import type { Reminder } from "../../shared/types";

export function Reminders() {
  useT();
  const enabled = useFeatureEnabled("notes");
  const [items, setItems] = useState<Reminder[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<"reminders.error" | "reminders.invalid" | "reminders.loadError" | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const parsed = useMemo(() => parseReminder(input), [input]);
  useEffect(() => {
    setItems([]);
    if (!enabled) { setInput(""); return; }
    let cancelled = false;
    let stop: Unlisten | undefined;
    let revision = 0;
    void (async () => {
      stop = await listen("reminders://changed", fresh => { if (!cancelled) { revision++; setItems(fresh); } });
      if (cancelled) { stop(); return; }
      const before = revision;
      const fresh = await invoke("reminders_list");
      if (!cancelled && before === revision) setItems(fresh);
    })().catch(() => { if (!cancelled) setError("reminders.loadError"); });
    return () => { cancelled = true; stop?.(); };
  }, [enabled]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy.current || !isFeatureEnabled("notes")) return;
    busy.current = true; setPending(true); setError(null);
    try { await action(); }
    catch { setError("reminders.error"); }
    finally { busy.current = false; setPending(false); }
  };
  const create = () => {
    if (!parsed) { setError("reminders.invalid"); return; }
    primeAudio();
    void run(async () => {
      await invoke("reminders_add", parsed); setInput("");
      if (isFeatureEnabled("notes")) void requestShell({ type: "toast", text: t("reminders.created") });
    });
  };
  if (!enabled) return null;
  return <section className="nt-reminders ig-glass-card" aria-label={t("reminders.title")}>
    <h3>{t("reminders.title")}</h3>
    <form onSubmit={e => { e.preventDefault(); create(); }}>
      <input className="ig-glass-input nt-reminder-input" aria-label={t("reminders.new")} placeholder={t("reminders.hint")} value={input}
        onChange={e => { setInput(e.target.value); setError(null); }} />
      {parsed && <p className="nt-reminder-preview" role="status">{reminderPreview(parsed)}</p>}
      <button className="ig-glass-control ig-glass-control--sm" type="submit" disabled={pending || !parsed}>{t("reminders.create")}</button>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    <div className="nt-reminder-list ig-scroll">
      {!items.length && <p>{t("reminders.empty")}</p>}
      {[...items].sort((a,b) => Number(a.done) - Number(b.done) || a.dueAt - b.dueAt).map(item => <div className="nt-reminder" key={item.id} data-done={item.done}>
        <label><input type="checkbox" checked={item.done} disabled={pending} aria-label={`${t("reminders.done")}: ${item.text}`}
          onChange={e => { const done = e.target.checked; void run(() => invoke("reminders_update", { id: item.id, patch: { done } })); }} />
          <span>{item.text}<time dateTime={Number.isFinite(new Date(item.dueAt).getTime()) ? new Date(item.dueAt).toISOString() : undefined}>{Number.isFinite(new Date(item.dueAt).getTime()) ? formatReminderTime(item.dueAt) : String(item.dueAt)}</time></span>
        </label>
        <button className="ig-glass-control ig-glass-control--sm" type="button" disabled={pending} aria-label={`${t("reminders.delete")}: ${item.text}`}
          onClick={() => { void run(() => invoke("reminders_delete", { id: item.id })); }}>×</button>
      </div>)}
    </div>
  </section>;
}
