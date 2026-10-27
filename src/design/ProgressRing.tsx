// Owner: Designer. Circular progress for the timer (panel and pill). Styling: .ig-ring in glass.css, spec §6.6 / §6.7.
import type { CSSProperties } from "react";

export type RingState = "idle" | "running" | "paused" | "done";

export interface ProgressRingProps {
  /** 0..1 — fraction of the ring that is filled (timer: remaining / total, or elapsed / total — see spec §6.6). */
  value: number;
  /** Outer diameter in px. Panel: 120 (--ig-ring-size), pill: 22 (--ig-ring-size-pill). */
  size?: number;
  /** Stroke width in px. Panel: 6, pill: 2.5. */
  stroke?: number;
  state?: RingState;
  className?: string;
  /** Accessible label, e.g. «Осталось 4 минуты 12 секунд». Omit when the time is printed next to the ring. */
  label?: string;
}

/** Radius of a circle whose stroke fits inside `size` (stroke is centred on the path). */
export function ringRadius(size: number, stroke: number): number {
  return Math.max(0, (size - stroke) / 2);
}

/** Clamp to 0..1; NaN → 0. */
export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ProgressRing({ value, size = 120, stroke = 6, state = "running", className, label }: ProgressRingProps) {
  const r = ringRadius(size, stroke);
  const c = size / 2;
  return (
    <svg
      className={className ? `ig-ring ${className}` : "ig-ring"}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      data-state={state}
      style={{ "--ig-progress": clampProgress(value) } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <circle className="ig-ring__track" cx={c} cy={c} r={r} strokeWidth={stroke} />
      {/* pathLength=100 → stroke-dasharray/offset in percent, so CSS needs no geometry. */}
      <circle className="ig-ring__value" cx={c} cy={c} r={r} strokeWidth={stroke} pathLength={100} />
    </svg>
  );
}
