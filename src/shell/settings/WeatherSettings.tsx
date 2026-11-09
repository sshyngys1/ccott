import { useState } from "react";
import { useT } from "../../i18n";
import { LocationPicker } from "../../modules/weather/LocationPicker";
import { useIslandStore } from "../../store";
import { Segmented } from "./controls";
import { patchSettings } from "./patchSettings";

export function WeatherSettings() {
  const t = useT();
  const location = useIslandStore(s => s.settings.weatherLocation);
  const units = useIslandStore(s => s.settings.weatherUnits);
  const [error, setError] = useState<string | null>(null);
  return <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-weather">
    <h4 id="ig-set-weather" className="ig-section-label ig-settings-label">{t("weather.title")}</h4>
    {location && <div className="ig-setting-row"><span>{location.name}</span><button className="ig-glass-control" onClick={() => void patchSettings({ weatherLocation: null }).then(setError)}>{t("weather.reset")}</button></div>}
    <LocationPicker onSelect={weatherLocation => patchSettings({ weatherLocation })} />
    <div className="ig-setting-row"><span>{t("weather.units")}</span><Segmented label={t("weather.units")} value={units} options={[{ value: "c", label: "°C" }, { value: "f", label: "°F" }]}
      onChange={weatherUnits => void patchSettings({ weatherUnits }).then(setError)} /></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
