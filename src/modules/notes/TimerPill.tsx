// Compact live activity of «Заметки»: the timer in the collapsed pill (spec §6.7), above the media activity in priority.
import { ProgressRing, type RingState } from "../../design/ProgressRing";
import { remainingAt, ringValue } from "../../lib/timer/machine";
import { useTimerStore } from "../../lib/timer/store";
import { formatTimerPill } from "../../lib/time/format";
import { requestShell } from "../../shared/shellBus";
import "../../lib/ui.css";
import "./notes.css";

export function TimerPill() {
  const timer = useTimerStore((s) => s.timer);
  const now = useTimerStore((s) => s.now);
  const done = timer.status === "done";
  const state: RingState = timer.status;
  const dataState = done ? "done" : timer.status === "paused" ? "paused" : "running";

  return (
    <button
      type="button"
      className="ig-pill-row mod-pill"
      data-state={dataState}
      onClick={() => {
        // «Готово» is acknowledged by the click (it would otherwise hold for 10 s).
        if (done) useTimerStore.getState().dismissDone();
        requestShell({ type: "openTab", tab: "notes" });
      }}
      aria-label={done ? "Время вышло. Открыть таймер" : `Таймер: осталось ${formatTimerPill(remainingAt(timer, now))}. Открыть таймер`}
    >
      <span className="nt-pill-ring">
        <ProgressRing value={ringValue(timer, now)} size={22} stroke={2.5} state={state} />
      </span>
      <span className="ig-pill-title">{done ? "Время вышло" : "Таймер"}</span>
      <span className="ig-pill-time ig-num">{done ? "0:00" : formatTimerPill(remainingAt(timer, now))}</span>
    </button>
  );
}
