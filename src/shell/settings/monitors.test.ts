import { describe, expect, it } from "vitest";
import type { MonitorInfo } from "../../shared/types";
import { monitorOptions, selectedMonitor, sliderPercent } from "./monitors";

const monitors: MonitorInfo[] = [
  { id: "m2", name: "Второй монитор", width: 1920, height: 1080, scaleFactor: 1, isPrimary: false },
  { id: "m1", name: "Основной монитор", width: 2560, height: 1600, scaleFactor: 1.5, isPrimary: true },
];

describe("monitorOptions", () => {
  it("starts with «Основной» sized like the primary monitor, then lists every monitor", () => {
    const options = monitorOptions(monitors);
    expect(options[0]).toEqual({ value: "primary", label: "Основной · 2560×1600" });
    expect(options.slice(1).map((o) => o.label)).toEqual(["Второй монитор · 1920×1080", "Основной монитор · 2560×1600"]);
    expect(options.slice(1).map((o) => o.value)).toEqual(["m2", "m1"]);
  });

  it("works without monitors (backend unavailable)", () => {
    expect(monitorOptions([])).toEqual([{ value: "primary", label: "Основной" }]);
  });

  it("falls back to «primary» for a monitor that is gone", () => {
    const options = monitorOptions(monitors);
    expect(selectedMonitor(options, "m2")).toBe("m2");
    expect(selectedMonitor(options, "gone")).toBe("primary");
  });
});

describe("sliderPercent", () => {
  it("maps the value into 0–100 %", () => {
    expect(sliderPercent(150, 0, 1000)).toBe("15%");
    expect(sliderPercent(400, 0, 2000)).toBe("20%");
    expect(sliderPercent(5000, 0, 1000)).toBe("100%");
    expect(sliderPercent(1, 1, 1)).toBe("0%");
  });
});
