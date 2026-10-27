import { motion } from "motion/react";
import { IconCheck, IconPause, IconPlay, IconReset, IconTimer } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { ProgressRing, type RingState } from "../../design/ProgressRing";
import { MINUTE_MS, TIMER_PRESETS_MIN, remainingAt, ringValue } from "../../lib/timer/machine";
import { useTimerStore } from "../../lib/timer/store";
import { formatTimerFace } from "../../lib/time/format";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

const STATUS_TEXT = { idle: "Готов к запуску", running: "Идёт", paused: "Пауза", done: "Готово" } as const;

export function TimerCard() {
  const timer = useTimerStore((s) => s.timer);
  const now = useTimerStore((s) => s.now);
  const { toggle, reset, selectPreset, addMinute } = useTimerStore.getState();

  const done = timer.status === "done";
  const running = timer.status === "running";
  const remaining = remainingAt(timer, now);
  const ringState: RingState = timer.status;
  const totalMin = Math.round(timer.totalMs / MINUTE_MS);

  return (
    <section className={done ? "ig-glass-card ig-glass-card--success nt-timer" : "ig-glass-card nt-timer"} aria-label="Таймер">
      <header className="nt-timer-head">
        <span className="nt-timer-title">
          <IconTimer size={16} />
          Таймер
        </span>
        <span className="mod-caption" role="status">
          {STATUS_TEXT[timer.status]}
        </span>
      </header>

      <div className="nt-timer-face">
        <ProgressRing value={ringValue(timer, now)} state={ringState} label={done ? "Время вышло" : `Осталось ${formatTimerFace(remaining)}`} />
        <div className="nt-timer-readout">
          {done ? (
            <>
              <IconCheck size={22} className="nt-success-icon" />
              <span className="nt-timer-done">Время вышло</span>
            </>
          ) : (
            <>
              <span className="nt-timer-time ig-num">{formatTimerFace(remaining)}</span>
              <span className="mod-caption">из {totalMin} мин</span>
            </>
          )}
        </div>
      </div>

      <div className="nt-presets" role="group" aria-label="Длительность">
        {TIMER_PRESETS_MIN.map((m) => (
          <button key={m} type="button" className="ig-chip nt-preset" aria-pressed={timer.totalMs === m * MINUTE_MS} aria-label={`${m} мин`} onClick={() => selectPreset(m)}>
            {m}
          </button>
        ))}
      </div>

      <div className="nt-timer-controls">
        <motion.button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} aria-label="Сбросить" title="Сбросить" onClick={reset}>
          <IconReset size={18} />
        </motion.button>
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg ig-glass-control--accent"
          {...tap}
          aria-label={running ? "Пауза" : done ? "Запустить снова" : "Старт"}
          onClick={toggle}
        >
          {running ? <IconPause size={18} /> : <IconPlay size={18} />}
        </motion.button>
        <motion.button type="button" className="ig-glass-control ig-glass-control--sm" {...tap} onClick={addMinute}>
          +1 мин
        </motion.button>
      </div>
    </section>
  );
}
