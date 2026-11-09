import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { invoke } from "../../ipc";
import { mockEmit, mockListenerCount, resetMock, weatherMockConfig } from "../../ipc/mock";
import { sampleWeather } from "../../ipc/weatherMock";
import { isModuleEnabled } from "../../lib/features";
import { resetIslandStore, useIslandStore } from "../../store";
import { WeatherSettings } from "../../shell/settings/WeatherSettings";
import { temperature, wind } from "./format";
import { useWeatherStore, useWeatherSync } from "./store";
import { WeatherTab } from "./WeatherTab";

const location = { name: "Almaty", lat: 43.25, lon: 76.95 };
beforeEach(() => { resetMock(); resetIslandStore(); useWeatherStore.setState({ report: null, error: false, loading: false }); });
afterEach(() => { cleanup(); resetIslandStore(); vi.restoreAllMocks(); });
async function chooseLocation() {
  useIslandStore.getState().applySettings(await invoke("settings_set", { patch: { weatherLocation: location } }));
}

it("searches with suggestions, chooses a city with the keyboard and renders 24 hours and 7 days", async () => {
  render(<WeatherTab />);
  expect(mockListenerCount("weather://changed")).toBe(0);
  const input = screen.getByRole("combobox", { name: t("weather.search") });
  fireEvent.change(input, { target: { value: "Almaty" } });
  await screen.findByRole("option");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText(t("weather.feels", { temp: "17°" }))).toBeInTheDocument();
  expect(document.querySelectorAll(".weather-hour")).toHaveLength(24);
  expect(document.querySelectorAll(".weather-day")).toHaveLength(7);
  expect((await invoke("settings_get")).weatherLocation?.lat).toBe(location.lat);
  const hours = screen.getByRole("region", { name: t("weather.hours") });
  fireEvent.wheel(hours, { deltaY: 120 }); expect(hours.scrollLeft).toBe(120);
});

it("converts temperatures and wind to Fahrenheit/mph and shows offline cached data", async () => {
  await chooseLocation();
  render(<WeatherTab />);
  await screen.findByText(t("weather.feels", { temp: "17°" }));
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, weatherUnits: "f" }));
  expect(screen.getByText(t("weather.feels", { temp: "63°" }))).toBeInTheDocument();
  expect(document.querySelector(".weather-now__temp")).toHaveTextContent("64°");
  expect(screen.getByText(/10 mph|10 миль\/ч/)).toBeInTheDocument();
  act(() => mockEmit("weather://changed", { ...sampleWeather(location), stale: true }));
  expect(screen.getByText(t("weather.offline"))).toBeInTheDocument();
  expect(temperature(-40, "f")).toBe("-40°"); expect(wind(16.09344, "f")).toBe(10);
});

it("shares the listener, ignores another location, and tears down when disabled or unmounted", async () => {
  await chooseLocation();
  function PillSync() { useWeatherSync(); return null; }
  const view = render(<><WeatherTab /><PillSync /></>);
  await waitFor(() => expect(useWeatherStore.getState().report).not.toBeNull());
  expect(mockListenerCount("weather://changed")).toBe(1);
  act(() => mockEmit("weather://changed", sampleWeather({ ...location, lon: -1 })));
  expect(useWeatherStore.getState().report?.location.lon).toBe(location.lon);
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["weather"] }));
  expect(mockListenerCount("weather://changed")).toBe(0);
  expect(useWeatherStore.getState().report).toBeNull();
  expect(screen.queryByRole("region", { name: t("weather.title") })).toBeNull();
  expect(isModuleEnabled("weather", ["weather"])).toBe(false);
  view.unmount(); expect(mockListenerCount("weather://changed")).toBe(0);
});

it("changes the selected location immediately and retains no old report after reset", async () => {
  await chooseLocation();
  render(<WeatherTab />);
  await waitFor(() => expect(useWeatherStore.getState().report?.location.name).toBe("Almaty"));
  const next = { name: "London", lat: 51.5, lon: -0.12 };
  await act(async () => useIslandStore.getState().applySettings(await invoke("settings_set", { patch: { weatherLocation: next } })));
  await waitFor(() => expect(useWeatherStore.getState().report?.location.name).toBe("London"));
  act(() => mockEmit("weather://changed", sampleWeather(location)));
  expect(useWeatherStore.getState().report?.location.name).toBe("London");
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, weatherLocation: null }));
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(useWeatherStore.getState().report).toBeNull();
  expect(mockListenerCount("weather://changed")).toBe(0);
});

it("keeps manual search usable after geolocation denial and reports a network error without cache", async () => {
  render(<WeatherTab />);
  fireEvent.click(screen.getByRole("button", { name: t("weather.locate") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(t("weather.locateError"));
  expect(screen.getByRole("combobox")).toBeEnabled();
  weatherMockConfig.offline = true;
  await act(async () => chooseLocation());
  expect(await screen.findByRole("alert")).toHaveTextContent(t("weather.loadError"));
});

it.each(["ru", "en"] as const)("settings %s supports auto location, units and reset", async language => {
  useIslandStore.getState().applySettings(await invoke("settings_set", { patch: { language } }));
  weatherMockConfig.locateError = false;
  render(<WeatherSettings />);
  fireEvent.click(screen.getByRole("button", { name: t("weather.locate") }));
  await screen.findByRole("button", { name: t("weather.reset") });
  fireEvent.click(screen.getByRole("radio", { name: "°F" }));
  await waitFor(async () => expect((await invoke("settings_get")).weatherUnits).toBe("f"));
  fireEvent.click(screen.getByRole("button", { name: t("weather.reset") }));
  await waitFor(async () => expect((await invoke("settings_get")).weatherLocation).toBeNull());
});
