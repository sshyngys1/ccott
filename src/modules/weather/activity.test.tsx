import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { sampleWeather } from "../../ipc/weatherMock";
import { DOWNLOADS_PRIORITY } from "../../lib/downloads/store";
import home from "../home";
import { pickCompact } from "../../shell/compact";
import { resetIslandStore, useIslandStore } from "../../store";
import weather from ".";
import { precipitationMinutes, resetWeatherActivity, useWeatherActive, wantsWeather, WeatherPill, WEATHER_PRIORITY } from "./activity";
import { useWeatherStore } from "./store";

const report = () => sampleWeather({ name: "City", lat: 1, lon: 2 });
beforeEach(() => { resetIslandStore(); resetWeatherActivity(); useWeatherStore.setState({ report: null, loading: false, error: false }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("gates precipitation by 30-minute threshold, DND, feature, stale data and age", () => {
  const value = report(); const now = value.updatedAt;
  for (const minutes of [0, 20, 30]) expect(wantsWeather({ ...value, precipInMin: minutes }, true, false, now)).toBe(true);
  expect(wantsWeather({ ...value, precipInMin: 31 }, true, false, now)).toBe(false);
  expect(wantsWeather(value, true, true, now)).toBe(false);
  expect(wantsWeather(value, false, false, now)).toBe(false);
  expect(wantsWeather({ ...value, stale: true }, true, false, now)).toBe(false);
  expect(wantsWeather(value, true, false, now + 31 * 60_000)).toBe(false);
  expect(wantsWeather({ ...value, precipInMin: null }, true, false, now)).toBe(false);
  expect(precipitationMinutes(value, now + 5 * 60_000)).toBe(15);
});

it("has lower priority than media, downloads and a headphones activity", () => {
  const headphones = { ...home, id: "control" as const, compact: { ...home.compact!, priority: 8 } };
  expect(WEATHER_PRIORITY).toBeLessThan(DOWNLOADS_PRIORITY);
  expect(pickCompact([weather, home], [true, true])).toBe(home);
  expect(pickCompact([weather, headphones], [true, true])).toBe(headphones);
  expect(pickCompact([weather, home], [true, false])).toBe(weather);
});

it("shows a wet spell once, survives report updates, and allows a new event after dry weather", async () => {
  vi.useFakeTimers();
  const value = report();
  useWeatherStore.setState({ report: value });
  function Harness() { return useWeatherActive() ? <WeatherPill /> : null; }
  render(<Harness />);
  expect(screen.getByRole("status")).toHaveTextContent(t("weather.rainSoon", { minutes: 20 }));
  act(() => useWeatherStore.setState({ report: { ...value } }));
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(15_001));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => useWeatherStore.setState({ report: { ...value, updatedAt: Date.now(), precipInMin: 0 } }));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => useWeatherStore.setState({ report: { ...value, precipInMin: null, precipKind: null } }));
  act(() => useWeatherStore.setState({ report: { ...value, updatedAt: Date.now(), precipKind: "snow" } }));
  expect(screen.getByRole("status")).toHaveTextContent(t("weather.snowSoon", { minutes: 20 }));
});

it("turns the activity off immediately for DND or a disabled feature", () => {
  useWeatherStore.setState({ report: report() });
  const hook = renderHook(() => useWeatherActive());
  expect(hook.result.current).toBe(true);
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, doNotDisturb: true }));
  expect(hook.result.current).toBe(false);
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, doNotDisturb: false, disabledFeatures: ["weather"] }));
  expect(hook.result.current).toBe(false);
});
