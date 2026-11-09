import { t } from "../i18n";
import { ru } from "../i18n/ru";
import { en } from "../i18n/en";
import type { WeatherLocation, WeatherReport } from "../shared/types";

const cities = [
  { lat: 43.25, lon: 76.95, key: "almaty" },
  { lat: 51.17, lon: 71.43, key: "astana" },
  { lat: 44.85, lon: 65.5, key: "kyzylorda" },
  { lat: 55.75, lon: 37.62, key: "moscow" },
  { lat: 51.5, lon: -0.12, key: "london" },
] as const;
export const weatherMockConfig = { offline: false, stale: false, locateError: true };
let cache: { fetched: number; report: WeatherReport } | null = null;
export function resetWeatherMock() {
  cache = null; Object.assign(weatherMockConfig, { offline: false, stale: false, locateError: true });
}
export function validWeatherLocation(value: WeatherLocation | null): boolean {
  return value === null || !!value && typeof value.name === "string" && value.name.trim().length > 0 && [...value.name].length <= 120
    && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;
}
export function sampleWeather(location: WeatherLocation, now = Date.now()): WeatherReport {
  return {
    location, updatedAt: now, stale: false,
    now: { tempC: 18, feelsLikeC: 17, code: "partly", isDay: true, windKmh: 16, humidity: 68 },
    hours: Array.from({ length: 24 }, (_, i) => ({ time: Math.floor(now / 3600_000) * 3600_000 + i * 3600_000,
      tempC: 18 + Math.round(Math.sin(i / 4) * 5), code: i < 3 ? "rain" : "partly", precipProb: i < 3 ? 75 : 10 })),
    days: Array.from({ length: 7 }, (_, i) => ({ date: new Date(now + i * 86400_000).toISOString().slice(0, 10),
      minC: 9 + i, maxC: 20 + i, code: i === 0 ? "rain" : "partly", precipProb: i === 0 ? 75 : 15 })),
    precipInMin: 20, precipKind: "rain",
  };
}
export function getMockWeather(location: WeatherLocation | null, disabled: boolean, force = false): WeatherReport | null {
  if (!location || disabled) return null;
  const same = cache && JSON.stringify(cache.report.location) === JSON.stringify(location);
  const now = Date.now();
  if (same && cache && !force && !weatherMockConfig.stale && now - cache.fetched < 30 * 60_000) return structuredClone(cache.report);
  if (weatherMockConfig.offline || weatherMockConfig.stale) {
    if (same && cache) return { ...structuredClone(cache.report), stale: true };
    throw new Error(t("weather.loadError"));
  }
  const report = sampleWeather(location, now);
  cache = { fetched: now, report };
  return structuredClone(report);
}
export function searchMockWeather(query: string, lang: "ru" | "en"): WeatherLocation[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  if (weatherMockConfig.offline) throw new Error(t("weather.searchError"));
  return cities.filter(c => `${ru[`weather.city.${c.key}`]} ${en[`weather.city.${c.key}`]}`.toLocaleLowerCase().includes(needle)).slice(0, 8)
    .map(c => ({ name: (lang === "ru" ? ru : en)[`weather.city.${c.key}`], lat: c.lat, lon: c.lon }));
}
export function locateMockWeather(): WeatherLocation {
  if (weatherMockConfig.locateError) throw new Error(t("weather.locateError"));
  return { name: t("weather.city.almaty"), lat: cities[0].lat, lon: cities[0].lon };
}
