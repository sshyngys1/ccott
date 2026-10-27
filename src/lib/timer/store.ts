// The timer lives here (not in the tab component): it keeps running when the tab unmounts or the island collapses,
// and the pill activity reads the same state. Time is always derived from timestamps (see machine.ts).
import { create } from "zustand";
import { playChime, primeAudio } from "./chime";
import * as machine from "./machine";
import type { TimerState } from "./machine";

export interface TimerStore {
  timer: TimerState;
  /** Epoch ms of the latest tick / action; components derive the remainder from it. */
  now: number;
  /** The «Время вышло» pill was dismissed (click or the 10 s hold ran out). */
  doneDismissed: boolean;

  toggle: () => void;
  reset: () => void;
  selectPreset: (minutes: number) => void;
  addMinute: () => void;
  /** Hides the «done» activity in the pill; the tab still shows the finished state. */
  dismissDone: () => void;
}

let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function clearWake(): void {
  if (wakeTimer !== null) clearTimeout(wakeTimer);
  wakeTimer = null;
}

/** One precisely aimed timeout instead of an accumulating interval. */
function schedule(): void {
  clearWake();
  const { timer, doneDismissed } = useTimerStore.getState();
  const delay = machine.nextWakeMs(timer, Date.now(), doneDismissed);
  if (delay === null) return;
  // A timeout that fires a hair early just reschedules itself (remaining is still > 0), so no safety margin is needed.
  wakeTimer = setTimeout(onWake, delay);
}

function onWake(): void {
  wakeTimer = null;
  const now = Date.now();
  const s = useTimerStore.getState();
  const next = machine.tick(s.timer, now);
  const finished = next !== s.timer;
  let doneDismissed = s.doneDismissed;
  if (finished) doneDismissed = false;
  else if (next.status === "done" && next.finishedAt !== null && now - next.finishedAt >= machine.DONE_HOLD_MS) doneDismissed = true;
  useTimerStore.setState({ timer: next, now, doneDismissed });
  if (finished) playChime();
  schedule();
}

function commit(timer: TimerState, extra: Partial<TimerStore> = {}): void {
  useTimerStore.setState({ timer, now: Date.now(), ...extra });
  schedule();
}

export const useTimerStore = create<TimerStore>()((_set, get) => ({
  timer: machine.createTimer(),
  now: Date.now(),
  doneDismissed: false,

  toggle: () => {
    primeAudio(); // user gesture: lets the chime play later
    const next = machine.toggle(get().timer, Date.now());
    commit(next, { doneDismissed: false });
  },
  reset: () => commit(machine.reset(get().timer), { doneDismissed: false }),
  selectPreset: (minutes) => commit(machine.selectPreset(get().timer, minutes), { doneDismissed: false }),
  addMinute: () => {
    primeAudio();
    commit(machine.addMinute(get().timer, Date.now()), { doneDismissed: false });
  },
  dismissDone: () => {
    if (get().timer.status === "done") commit(get().timer, { doneDismissed: true });
  },
}));

/** Tests. */
export function resetTimerStore(): void {
  clearWake();
  useTimerStore.setState({ timer: machine.createTimer(), now: Date.now(), doneDismissed: false });
}

/** Remaining ms for display (re-rendered by the store's own ticks). */
export function useTimerRemaining(): number {
  return useTimerStore((s) => machine.remainingAt(s.timer, s.now));
}

/** `compact.useIsActive` of the timer activity. */
export function useIsTimerActive(): boolean {
  return useTimerStore((s) => machine.isPillActive(s.timer, s.now, s.doneDismissed));
}
