// Owner: F2 (Frontend-Modules). Battery Indicator component for panel head and idle pill.
import { useId, useEffect } from "react";
import type { BatteryState } from "../../shared/types";
import { useT } from "../../i18n";
import { IconBattery, IconBatteryCharging, IconBatterySaver } from "../../design/icons";
import {
  batteryFillFraction,
  batteryPercent,
  batteryTone,
  formatBatteryLabel,
  initBatteryStore,
  useBatteryStore,
} from "./batteryStore";

interface BatteryIndicatorProps {
  variant: "head" | "pill";
}

export function BatteryIndicator({ variant }: BatteryIndicatorProps) {
  const battery = useBatteryStore((s) => s.battery);

  useEffect(() => {
    return initBatteryStore();
  }, []);

  return <BatteryIndicatorView variant={variant} battery={battery} />;
}

/** Same presentation for live snapshots and explicitly injected QA states. */
export function BatteryIndicatorView({ variant, battery }: BatteryIndicatorProps & { battery: BatteryState }) {
  const t = useT();
  const rawId = useId();
  const id = rawId.replace(/:/g, "");

  if (battery.hasBattery !== true) {
    return null;
  }

  const label = formatBatteryLabel(battery, t) ?? "";
  const percent = batteryPercent(battery);
  const percentText = percent !== null ? `${percent}%` : "—%";

  const Icon = battery.charging
    ? IconBatteryCharging
    : battery.saver
      ? IconBatterySaver
      : IconBattery;

  if (variant === "head") {
    return (
      <span
        className="ig-head-battery"
        title={label}
        aria-label={label}
        role="status"
      >
        <Icon size={16} />
        <span className="ig-num ig-head-battery-pct">{percentText}</span>
      </span>
    );
  }

  const tone = batteryTone(battery);
  const isCharging = battery.charging === true;
  const fillFraction = batteryFillFraction(battery) ?? 0;
  const fillWidth = fillFraction * 36;
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
      className="ig-pill-battery"
      title={label}
      aria-label={label}
      role="status"
    >
      <svg
        className="ig-battery-symbol"
        viewBox="0 0 42 24"
        aria-hidden="true"
        data-tone={tone}
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

        {fillWidth > 0 && (
          <g clipPath={`url(#${bodyClipId})`}>
            <rect x="0" y="1" width={fillWidth} height="22" fill="currentColor" />
          </g>
        )}

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

        {isCharging ? (
          <path
            className="ig-battery-ink"
            d="M19.5 4 11.5 13h6l-2 7 9-11h-6Z"
            fill={`url(#${inkGradId})`}
          />
        ) : (
          <text
            className="ig-battery-ink"
            x="18"
            y="12"
            textAnchor="middle"
            dominantBaseline="central"
            fill={`url(#${inkGradId})`}
          >
            {percentText}
          </text>
        )}
      </svg>
    </span>
  );
}
