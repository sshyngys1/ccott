import { beforeEach, expect, it, vi } from "vitest";
import { invoke, listen } from ".";
import { resetMock, weatherMockConfig } from "./mock";
const location = { name: "City", lat: 0, lon: 0 };
beforeEach(() => resetMock());

it("searches multiple cities in both languages and supports locate success/failure", async () => {
  expect((await invoke("weather_search_location", { query: "almaty", lang: "en" }))[0].name).toContain("Almaty");
  expect((await invoke("weather_search_location", { query: "Москва", lang: "ru" }))[0].name).toContain("Москва");
  expect((await invoke("weather_search_location", { query: "Казахстан", lang: "ru" })).length).toBe(3);
  expect(await invoke("weather_search_location", { query: "unknown", lang: "en" })).toEqual([]);
  await expect(invoke("weather_locate")).rejects.toThrow();
  weatherMockConfig.locateError = false;
  expect((await invoke("weather_locate")).lat).toBe(43.25);
});

it("returns a report, fresh cache, forced stale fallback and emits after location changes", async () => {
  expect(await invoke("weather_get", {})).toBeNull();
  const changed = vi.fn(); const off = await listen("weather://changed", changed);
  await invoke("settings_set", { patch: { weatherLocation: location } });
  expect(changed).toHaveBeenCalledOnce();
  const report = await invoke("weather_get", {});
  expect(report?.hours).toHaveLength(24); expect(report?.days).toHaveLength(7);
  weatherMockConfig.offline = true;
  expect((await invoke("weather_get", {}))?.stale).toBe(false);
  expect((await invoke("weather_get", { force: true }))?.stale).toBe(true);
  await invoke("settings_set", { patch: { weatherLocation: { ...location, lat: 1 } } });
  await expect(invoke("weather_get", {})).rejects.toThrow();
  await invoke("settings_set", { patch: { disabledFeatures: ["weather"] } });
  expect(await invoke("weather_get", { force: true })).toBeNull();
  off();
});

it("rejects malformed weather settings", async () => {
  await expect(invoke("settings_set", { patch: { weatherLocation: { ...location, lat: 91 } } })).rejects.toThrow();
  await expect(invoke("settings_set", { patch: { weatherLocation: { ...location, name: "a".repeat(121) } } })).rejects.toThrow();
  await expect(invoke("settings_set", { patch: { weatherUnits: "x" as "c" } })).rejects.toThrow();
});
