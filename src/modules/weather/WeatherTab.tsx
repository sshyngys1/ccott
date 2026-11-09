import { useState } from "react";
import { getLocale, useT } from "../../i18n";
import { useFeatureEnabled } from "../../lib/features";
import { useNow } from "../../lib/useNow";
import { patchSettings } from "../../shell/settings/patchSettings";
import { useIslandStore } from "../../store";
import { temperature, wind } from "./format";
import { WeatherIcon } from "./icons";
import { LocationPicker } from "./LocationPicker";
import { refreshWeather, useWeatherStore, useWeatherSync } from "./store";
import "./weather.css";

function Forecast() {
  const t = useT();
  const units = useIslandStore(s => s.settings.weatherUnits);
  const { report, error } = useWeatherStore();
  const now = useNow(60_000);
  if (!report) return <div className="ig-empty" role={error ? "alert" : "status"}>{t(error ? "weather.loadError" : "weather.loading")}
    {error && <button className="ig-glass-control" onClick={() => void refreshWeather(true)}>{t("weather.retry")}</button>}</div>;
  return <>
    <div className="weather-now">
      <WeatherIcon code={report.now.code} isDay={report.now.isDay} size={48} />
      <strong className="weather-now__temp ig-num">{temperature(report.now.tempC, units)}</strong>
      <div className="weather-now__details"><span>{t(`weather.code.${report.now.code}`)}</span>
        <span>{t("weather.feels", { temp: temperature(report.now.feelsLikeC, units) })}</span>
        <span>{t("weather.wind", { speed: wind(report.now.windKmh, units), unit: t(units === "f" ? "weather.mph" : "weather.kmh") })} · {t("weather.humidity", { value: Math.round(report.now.humidity) })}</span>
      </div>
      <div className="weather-now__stamp"><span>{t("weather.updated", { minutes: Math.max(0, Math.floor((now - report.updatedAt) / 60_000)) })}</span>
        {(report.stale || error) && <span role="status">{t("weather.offline")}</span>}
      </div>
    </div>
    <div className="weather-hours ig-scroll" role="region" tabIndex={0} aria-label={t("weather.hours")}
      onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
      {report.hours.map(hour => <div className="weather-hour ig-num" key={hour.time}>
        <time title={t("weather.computerTime")} dateTime={new Date(hour.time).toISOString()}>{new Date(hour.time).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}</time>
        <WeatherIcon code={hour.code} /><strong>{temperature(hour.tempC, units)}</strong>
        <small>{hour.precipProb === null ? "—" : `${hour.precipProb}%`}</small>
      </div>)}
    </div>
    <div className="weather-days" aria-label={t("weather.days")}>{report.days.map(day => <div className="weather-day" key={day.date}>
      <time dateTime={day.date}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(getLocale(), { weekday: "short", timeZone: "UTC" })}</time>
      <WeatherIcon code={day.code} /><span className="ig-num">{temperature(day.minC, units)} / <strong>{temperature(day.maxC, units)}</strong></span>
    </div>)}</div>
    <a className="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">{t("weather.credit")}</a>
  </>;
}

export function WeatherTab() {
  const t = useT();
  const enabled = useFeatureEnabled("weather");
  const location = useIslandStore(s => s.settings.weatherLocation);
  const loading = useWeatherStore(s => s.loading);
  const [choosing, setChoosing] = useState(false);
  useWeatherSync();
  if (!enabled) return null;
  return <section className="weather ig-scroll" aria-label={t("weather.title")}>
    <header className="weather-header"><strong className="ig-truncate">{location?.name ?? t("weather.choose")}</strong>
      {location && <span className="weather-header__actions"><button type="button" className="ig-glass-control ig-glass-control--sm" disabled={loading} onClick={() => void refreshWeather(true)}>{t("weather.refresh")}</button>
        <button type="button" className="ig-glass-control ig-glass-control--sm" onClick={() => setChoosing(!choosing)}>{t(choosing ? "weather.back" : "weather.change")}</button></span>}</header>
    {!location || choosing ? <LocationPicker onSelect={async weatherLocation => { const error = await patchSettings({ weatherLocation }); if (!error) setChoosing(false); return error; }} /> : <Forecast />}
  </section>;
}
