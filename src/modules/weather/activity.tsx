import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useFeatureEnabled } from "../../lib/features";
import type { WeatherReport } from "../../shared/types";
import { requestShell } from "../../shared/shellBus";
import { useIslandStore } from "../../store";
import { WeatherIcon } from "./icons";
import { useWeatherStore, useWeatherSync } from "./store";

export const WEATHER_PRIORITY = 5;
export function precipitationMinutes(report: WeatherReport | null, now = Date.now()): number | null {
  if (!report || report.stale || report.precipInMin === null || !report.precipKind || now - report.updatedAt > 30 * 60_000) return null;
  return Math.max(0, Math.ceil((report.updatedAt + report.precipInMin * 60_000 - now) / 60_000));
}
export function wantsWeather(report: WeatherReport | null, enabled: boolean, dnd: boolean, now = Date.now()) {
  const minutes = precipitationMinutes(report, now);
  return enabled && !dnd && minutes !== null && minutes <= 30;
}

// A continuous wet spell is one event. Remounting or a refreshed forecast never replays it.
let shownEvent: string | null = null;
let displayUntil = 0;
export function resetWeatherActivity() { shownEvent = null; displayUntil = 0; }
export function useWeatherActive() {
  useWeatherSync();
  const enabled = useFeatureEnabled("weather");
  const dnd = useIslandStore(s => s.settings.doNotDisturb);
  const report = useWeatherStore(s => s.report);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (report && report.precipInMin === null && !report.stale) resetWeatherActivity();
    if (!wantsWeather(report, enabled, dnd) || !report) {
      if ((!enabled || dnd) && shownEvent) displayUntil = 0;
      setActive(false); return;
    }
    const event = `${report.location.lat}:${report.location.lon}:${report.precipKind}`;
    if (shownEvent === event && displayUntil <= Date.now()) { setActive(false); return; }
    if (shownEvent !== event) displayUntil = Date.now() + 15_000;
    setActive(true);
    const timeout = window.setTimeout(() => setActive(false), displayUntil - Date.now());
    return () => window.clearTimeout(timeout);
  }, [enabled, dnd, report]);
  return active && wantsWeather(report, enabled, dnd);
}
export function WeatherPill() {
  const t = useT();
  const report = useWeatherStore(s => s.report);
  useEffect(() => {
    if (report) shownEvent = `${report.location.lat}:${report.location.lon}:${report.precipKind}`;
  }, [report]);
  if (!report) return null;
  return <button type="button" className="ig-pill-row mod-pill" aria-label={t("weather.open")}
    onClick={() => void requestShell({ type: "openTab", tab: "weather" })}><WeatherIcon code={report.precipKind === "snow" ? "snow" : "rain"} />
    <span role="status" className="ig-pill-label ig-pill-label--solo ig-truncate">{t(report.precipKind === "snow" ? "weather.snowSoon" : "weather.rainSoon", { minutes: precipitationMinutes(report) ?? 0 })}</span>
  </button>;
}
