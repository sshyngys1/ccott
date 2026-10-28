import { afterEach, beforeEach, expect, it } from "vitest";
import { resetIslandStore, useIslandStore } from "./index";

beforeEach(resetIslandStore);
afterEach(resetIslandStore);

it("prepares Home atomically with collapse and keeps user tab changes while expanded", () => {
  const store = useIslandStore.getState();
  store.setMode("expanded");
  store.setActiveTab("text");
  store.setMode("expanded");
  expect(useIslandStore.getState().activeTab).toBe("text");
  const observed: string[] = [];
  const off = useIslandStore.subscribe((state) => observed.push(`${state.mode}:${state.activeTab}`));
  store.setMode("collapsed");
  store.setMode("expanded");
  off();
  expect(observed).toEqual(["collapsed:home", "expanded:home"]);
});

it("preserves explicit settings and module destinations when opening from the pill", () => {
  const store = useIslandStore.getState();
  store.setMode("collapsed");
  store.setView("settings");
  store.setMode("expanded");
  expect(useIslandStore.getState().view).toBe("settings");
  store.setMode("collapsed");
  store.setActiveTab("notes");
  store.setMode("expanded");
  expect(useIslandStore.getState().activeTab).toBe("notes");
});
