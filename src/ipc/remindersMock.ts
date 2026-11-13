import type { Reminder } from "../shared/types";

type Emit = (event: "reminders://changed", value: Reminder[]) => void;
/** The same one-deadline, once-per-dueAt, paced delivery as the native service. */
export function createReminderMock(changed: Emit, due: (item: Reminder) => void) {
  let items: Reminder[] = [];
  let sequence = 0;
  let enabled = true;
  let subscribers = 0;
  let nextDelivery = 0;
  const delivered = new Map<string, number>();
  const upcoming = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const list = () => structuredClone([...items].sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt - b.dueAt || a.id.localeCompare(b.id)));
  const schedule = () => {
    clearTimeout(timer); timer = undefined;
    for (const [id, date] of delivered) if (!items.some(r => r.id === id && !r.done && r.dueAt === date)) delivered.delete(id);
    for (const [id, date] of upcoming) if (!items.some(r => r.id === id && !r.done && r.dueAt === date)) upcoming.delete(id);
    if (!enabled || !subscribers) { upcoming.clear(); return; }
    for (const item of items) if (!item.done && item.dueAt > Date.now()) upcoming.set(item.id, item.dueAt);
    const candidate = list().filter(r => !r.done && delivered.get(r.id) !== r.dueAt)
      .map(item => ({ item, deadline: upcoming.get(item.id) === item.dueAt ? item.dueAt : Math.max(item.dueAt, nextDelivery) }))
      .sort((a, b) => a.deadline - b.deadline || a.item.dueAt - b.item.dueAt)[0];
    if (!candidate) return;
    const { item: next, deadline } = candidate;
    timer = setTimeout(() => {
      if (Date.now() >= deadline) {
        delivered.set(next.id, next.dueAt);
        nextDelivery = Date.now() + 10_000;
        due(next);
      }
      schedule();
    }, Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
  };
  const validate = (text: string, dueAt: number) => {
    if (!text.trim() || [...text].length > 500) throw new Error("Reminder text must contain 1–500 characters");
    if (!Number.isFinite(dueAt)) throw new Error("Reminder dueAt must be finite");
  };
  const notify = () => { changed("reminders://changed", list()); schedule(); };
  return {
    list,
    add({ text, dueAt }: { text: string; dueAt: number }) {
      validate(text, dueAt);
      const item: Reminder = { id: `r${++sequence}`, text: text.trim(), dueAt, createdAt: Date.now(), done: false };
      items.push(item); notify(); return structuredClone(item);
    },
    update({ id, patch }: { id: string; patch: Partial<Pick<Reminder, "text" | "dueAt" | "done">> }) {
      const item = items.find(r => r.id === id);
      if (!item) throw new Error("Reminder not found");
      const next = { ...item, ...patch };
      validate(next.text, next.dueAt); next.text = next.text.trim();
      Object.assign(item, next); notify(); return structuredClone(item);
    },
    delete({ id }: { id: string }) {
      if (!items.some(r => r.id === id)) throw new Error("Reminder not found");
      items = items.filter(r => r.id !== id); notify();
    },
    setEnabled(value: boolean) { enabled = value; schedule(); },
    subscribe() { subscribers++; schedule(); return () => { subscribers--; schedule(); }; },
    reset() { clearTimeout(timer); timer = undefined; items = []; sequence = 0; nextDelivery = 0; delivered.clear(); upcoming.clear(); enabled = true; },
  };
}
