// Owner: F1. Pure helpers of the settings view.
import type { MonitorInfo } from "../../shared/types";

export interface MonitorOption {
  value: string;
  label: string;
}

const size = (m: MonitorInfo) => `${m.width}×${m.height}`;

/** «Основной · 2560×1600», then every monitor as «Name · W×H». */
export function monitorOptions(monitors: readonly MonitorInfo[]): MonitorOption[] {
  const primary = monitors.find((m) => m.isPrimary) ?? monitors[0];
  return [
    { value: "primary", label: primary ? `Основной · ${size(primary)}` : "Основной" },
    ...monitors.map((m) => ({ value: m.id, label: `${m.name} · ${size(m)}` })),
  ];
}

/** An unknown saved id (monitor unplugged) shows as «Основной». */
export function selectedMonitor(options: readonly MonitorOption[], saved: string): string {
  return options.some((o) => o.value === saved) ? saved : "primary";
}

/** `--ig-value` of `.ig-glass-slider`: fill percentage. */
export function sliderPercent(value: number, min: number, max: number): string {
  if (max <= min) return "0%";
  const p = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, p))}%`;
}
