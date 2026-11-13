// Owner: F2 (Frontend-Modules). Battery Indicator component for panel head and idle pill.
import { useId, useEffect, useRef, useState } from "react";
import type { BatteryState } from "../../shared/types";
import { useT } from "../../i18n";
import {
  batteryFillFraction,
  batteryPercent,
  batteryTone,
  formatBatteryLabel,
  initBatteryStore,
  useBatteryStore,
} from "./batteryStore";
import { durations } from "../../design/motion";
import { useFeatureEnabled } from "../features";
import { chargeTransition } from "./chargeTransition";

interface BatteryIndicatorProps {
  variant: "head" | "pill";
}

export function BatteryIndicator({ variant }: BatteryIndicatorProps) {
  const enabled = useFeatureEnabled("battery");
  const battery = useBatteryStore((s) => s.battery);

  useEffect(() => {
    if (!enabled) return;
    return initBatteryStore();
  }, [enabled]);

  if (!enabled) return null;
  return <BatteryIndicatorView variant={variant} battery={battery} />;
}

/** Same presentation for live snapshots and explicitly injected QA states. */
export function BatteryIndicatorView({ variant, battery }: BatteryIndicatorProps & { battery: BatteryState }) {
  const t = useT();
  const rawId = useId();
  const id = rawId.replace(/:/g, "");

  const previous = useRef(battery.charging);
  const [transition, setTransition] = useState<"plug" | "unplug" | null>(null);
  useEffect(() => {
    const change = chargeTransition(previous.current, battery.charging);
    previous.current = battery.charging;
    setTransition(change);
    if (!change) return;
    const timer = setTimeout(() => setTransition(null), durations.slow * (change === "plug" ? 3 : 1) * 1000);
    return () => clearTimeout(timer);
  }, [battery.charging]);

  if (battery.hasBattery !== true) {
    return null;
  }

  const label = formatBatteryLabel(battery, t) ?? "";
  const percent = batteryPercent(battery);
  const percentText = percent !== null ? `${percent}%` : "—%";

  const tone = batteryTone(battery);
  const isCharging = battery.charging === true;
  const fillFraction = batteryFillFraction(battery) ?? 0;
  const fillPercent = fillFraction * 100;

  const bodyClipId = `ig-bat-body-${id}`;
  const inkGradId = `ig-bat-ink-${id}`;

  const unfilledInkColor = isCharging
    ? "var(--ig-battery-charging)"
    : "var(--ig-battery-unfilled-text)";

  const inkStops =
    fillPercent <= 0 ? (
      <>
        <stop offset="0%" stopColor={unfilledInkColor} />
        <stop offset="100%" stopColor={unfilledInkColor} />
      </>
    ) : fillPercent >= 100 ? (
      <>
        <stop offset="0%" stopColor="var(--ig-battery-ink)" />
        <stop offset="100%" stopColor="var(--ig-battery-ink)" />
      </>
    ) : (
      <>
        <stop offset={`${fillPercent}%`} stopColor="var(--ig-battery-ink)" />
        <stop offset={`${fillPercent}%`} stopColor={unfilledInkColor} />
      </>
    );

  return (
    <span
      className={variant === "head" ? "ig-head-battery" : "ig-pill-battery"}
      data-charge-transition={transition ?? undefined}
      title={label}
      aria-label={label}
      role="status"
    >
      <svg
        className="ig-battery-symbol"
        viewBox="0 0 42 24"
        aria-hidden="true"
        data-tone={tone === "charging" ? batteryTone({ ...battery, charging: false }) : tone}
        data-charging={isCharging}
      >
        <defs>
          <clipPath id={bodyClipId}>
            <rect x="0" y="1" width="36" height="22" rx="6" />
          </clipPath>
          <linearGradient
            id={inkGradId}
            x1="0"
            y1="0"
            x2="36"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            {inkStops}
          </linearGradient>
        </defs>

        <rect className="ig-battery-track" x="0" y="1" width="36" height="22" rx="6" />

        <g clipPath={`url(#${bodyClipId})`}>
          <g className="ig-battery-fill" style={{ transform: `translateX(${(fillFraction - 1) * 36}px)` }}>
            <rect x="0" y="1" width="36" height="22" fill="currentColor" />
            <rect className="ig-battery-charge-fill" x="0" y="1" width="36" height="22" />
          </g>
        </g>

        <rect
          className="ig-battery-border"
          x="0.5"
          y="1.5"
          width="35"
          height="21"
          rx="5.5"
          fill="none"
        />

        <rect
          className="ig-battery-terminal"
          x="38"
          y="8"
          width="4"
          height="8"
          rx="1.5"
        />

        <rect className="ig-battery-flash" x="0" y="1" width="36" height="22" rx="6" />
        <g className="ig-battery-bolt">
          <path
            className="ig-battery-ink"
            d="M19.5 4 11.5 13h6l-2 7 9-11h-6Z"
            fill={`url(#${inkGradId})`}
          />
        </g>
        <g className="ig-battery-number">
          <text
            className="ig-battery-ink"
            x="18"
            y="12"
            textAnchor="middle"
            dominantBaseline="central"
            fill={`url(#${inkGradId})`}
          >
            {variant === "pill" ? percent ?? "\u2014" : null}
          </text>
        </g>
      </svg>
      {variant === "head" && <span className="ig-num ig-head-battery-pct">{percentText}</span>}
    </span>
  );
}
