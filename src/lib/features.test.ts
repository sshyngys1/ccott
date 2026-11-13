import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FeatureId } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import {
  disableFeatureList,
  enableFeatureList,
  isFeatureEnabled,
  isModuleEnabled,
  resetTabFeatures,
  useFeatureEnabled,
} from "./features";

describe("features selector & helpers", () => {
  beforeEach(() => {
    resetIslandStore();
  });

  afterEach(() => {
    resetIslandStore();
  });

  it("checks enabled state from explicit list or store", () => {
    expect(isFeatureEnabled("clipboard", [])).toBe(true);
    expect(isFeatureEnabled("clipboard", ["clipboard"])).toBe(false);
    expect(isModuleEnabled("home", ["home" as unknown as FeatureId])).toBe(true);
    expect(isModuleEnabled("notes", ["notes"])).toBe(false);
    expect(isModuleEnabled("notes", ["clipboard"])).toBe(true);
    expect(isModuleEnabled("agents", ["agents"])).toBe(false);
  });

  it("reacts to store updates via useFeatureEnabled", () => {
    const { result } = renderHook(() => useFeatureEnabled("battery"));
    expect(result.current).toBe(true);

    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: ["battery"],
      });
    });
    expect(result.current).toBe(false);

    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: [],
      });
    });
    expect(result.current).toBe(true);
  });

  it("adds, removes, and resets tab features without touching non-tab features", () => {
    const d1 = disableFeatureList([], "notes");
    expect(d1).toEqual(["notes"]);
    expect(disableFeatureList(d1, "notes")).toEqual(["notes"]);

    const d2 = disableFeatureList(d1, "dock");
    const d3 = disableFeatureList(d2, "battery");
    expect(enableFeatureList(d3, "notes")).toEqual(["dock", "battery"]);
    expect(resetTabFeatures(["clipboard", "text", "notes", "shelf", "weather", "control", "agents", "dock", "battery", "audioMeter"])).toEqual([
      "dock",
      "battery",
      "audioMeter",
    ]);
  });
});
