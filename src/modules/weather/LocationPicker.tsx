import { useEffect, useId, useRef, useState } from "react";
import { getLanguage, useT } from "../../i18n";
import { invoke } from "../../ipc";
import type { WeatherLocation } from "../../shared/types";
import "./weather.css";

export function LocationPicker({ onSelect }: { onSelect: (location: WeatherLocation) => Promise<string | null> }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<WeatherLocation[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const id = useId();
  const language = getLanguage();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const version = ++sequence.current;
    setCities([]); setSelected(0); setSearched(false); setError(null);
    if (query.trim().length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void invoke("weather_search_location", { query, lang: language }).then(list => {
        if (!cancelled && version === sequence.current) { setCities(list); setSearched(true); setSearching(false); }
      }, () => { if (!cancelled && version === sequence.current) { setError(t("weather.searchError")); setSearching(false); } });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, language, t]);
  const choose = async (location?: WeatherLocation) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const value = location ?? await invoke("weather_locate");
      if (!alive.current) return;
      const error = await onSelect(value);
      if (alive.current) { setError(error); if (!error) { setQuery(""); setCities([]); } }
    } catch { if (alive.current) setError(t("weather.locateError")); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="weather-picker">
    <label htmlFor={id}>{t("weather.search")}</label>
    <input id={id} className="ig-input" role="combobox" aria-autocomplete="list" aria-expanded={cities.length > 0}
      aria-controls={`${id}-list`} aria-activedescendant={cities.length ? `${id}-${selected}` : undefined}
      value={query} maxLength={120} placeholder={t("weather.searchPlaceholder")} disabled={busy}
      data-island-keyboard="true"
      onChange={e => setQuery(e.target.value)} onKeyDown={e => {
        if (e.key === "Escape") {
          // Claim Escape only while there is something to clear; an empty field lets the island collapse as usual.
          if (query || cities.length) { e.preventDefault(); setQuery(""); setCities([]); }
          return;
        }
        if (!cities.length) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((selected + (e.key === "ArrowDown" ? 1 : -1) + cities.length) % cities.length); }
        if (e.key === "Enter") { e.preventDefault(); void choose(cities[selected]); }
      }} />
    <ul id={`${id}-list`} role="listbox" aria-label={t("weather.search")} className="weather-picker__results ig-scroll">
      {cities.map((city, i) => <li id={`${id}-${i}`} key={`${city.lat}:${city.lon}`} role="option" aria-selected={i === selected}>
        <button className="ig-glass-control" type="button" disabled={busy} onClick={() => void choose(city)}>{city.name}</button>
      </li>)}
    </ul>
    {(busy || searching) && <span role="status">{t("weather.loading")}</span>}
    {searched && !cities.length && <span role="status">{t("weather.noResults")}</span>}
    <button type="button" className="ig-glass-control" disabled={busy} onClick={() => void choose()}>{t("weather.locate")}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
