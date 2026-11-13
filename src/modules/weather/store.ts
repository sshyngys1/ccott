import { useEffect } from "react";
import { create } from "zustand";
import { invoke, listen } from "../../ipc";
import { useFeatureEnabled } from "../../lib/features";
import type { WeatherLocation, WeatherReport } from "../../shared/types";
import { useIslandStore } from "../../store";

export const locationKey = (l: WeatherLocation | null) => l ? JSON.stringify(l) : "";
export const useWeatherStore = create<{ report: WeatherReport | null; error: boolean; loading: boolean }>(() => ({ report: null, error: false, loading: false }));
let users = 0;
let release: (() => void) | undefined;
let generation = 0;

export async function refreshWeather(force = false) {
  const version = generation;
  useWeatherStore.setState({ loading: true, error: false });
  try {
    const report = await invoke("weather_get", { force });
    if (version === generation) useWeatherStore.setState({ report, loading: false });
  } catch {
    if (version === generation) useWeatherStore.setState({ error: true, loading: false });
  }
}

/** Reference-counted: pill and tab share a single subscription. Disabled = no subscription or timers. */
export function useWeatherSync() {
  const enabled = useFeatureEnabled("weather");
  const key = useIslandStore(s => locationKey(s.settings.weatherLocation));
  useEffect(() => {
    if (!enabled || !key) return;
    users++;
    if (users === 1) {
      let disposed = false;
      const version = ++generation;
      let off: (() => void) | undefined;
      useWeatherStore.setState({ report: null, error: false });
      release = () => { disposed = true; off?.(); generation++; useWeatherStore.setState({ report: null, loading: false, error: false }); };
      void listen("weather://changed", report => {
        if (!disposed && version === generation && locationKey(report.location) === key) useWeatherStore.setState({ report, error: false, loading: false });
      }).then(stop => { if (disposed) stop(); else { off = stop; void refreshWeather(); } }, () => {
        if (!disposed) useWeatherStore.setState({ error: true, loading: false });
      });
    }
    return () => { if (--users === 0) { release?.(); release = undefined; } };
  }, [enabled, key]);
}
