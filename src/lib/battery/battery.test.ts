import { describe, expect, it } from "vitest";
import { batteryFillFraction, batteryTone, formatBatteryLabel, useBatteryStore } from "./batteryStore";
import type { BatteryState } from "../../shared/types";
import { t } from "../../i18n";

describe("Battery logic & formatting", () => {
  it.each([[0, "critical"], [15, "critical"], [16, "low"], [25, "low"], [26, "normal"], [100, "normal"], [null, "unknown"]] as const)(
    "uses explicit battery thresholds for %s", (percent, tone) => {
      const battery: BatteryState = { hasBattery: true, percent, charging: false, acConnected: true, saver: false, remainingSeconds: null };
      expect(batteryTone(battery)).toBe(tone);
      expect(batteryTone({ ...battery, charging: true })).toBe("charging");
      expect(formatBatteryLabel(battery, t)).toContain("Не заряжается");
      expect(formatBatteryLabel({ ...battery, charging: null }, t)).toContain("Статус зарядки неизвестен");
    },
  );
  it("returns null when system has no battery or unknown status", () => {
    const noBattery: BatteryState = {
      hasBattery: false,
      percent: null,
      charging: null,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    };
    expect(formatBatteryLabel(noBattery, t)).toBeNull();

    const unknownBattery: BatteryState = {
      hasBattery: null,
      percent: null,
      charging: null,
      acConnected: null,
      saver: null,
      remainingSeconds: null,
    };
    expect(formatBatteryLabel(unknownBattery, t)).toBeNull();
  });

  it("handles 0% valid battery charge", () => {
    const deadBattery: BatteryState = {
      hasBattery: true,
      percent: 0,
      charging: false,
      acConnected: false,
      saver: true,
      remainingSeconds: 0,
    };
    const label = formatBatteryLabel(deadBattery, t);
    expect(label).toContain("0%");
    expect(label).toContain("Экономия");
  });

  it("formats charging battery with percentage", () => {
    const chargingBattery: BatteryState = {
      hasBattery: true,
      percent: 88,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    };
    const label = formatBatteryLabel(chargingBattery, t);
    expect(label).toContain("88%");
    expect(label).toContain("Заряжается");
  });

  it("formats known battery with unknown percent honestly", () => {
    const unknownPct: BatteryState = {
      hasBattery: true,
      percent: null,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: null,
    };
    const label = formatBatteryLabel(unknownPct, t);
    expect(label).toContain("уровень неизвестен");
  });

  it("updates store correctly", () => {
    const testState: BatteryState = {
      hasBattery: true,
      percent: 95,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    };
    useBatteryStore.getState().setBattery(testState);
    expect(useBatteryStore.getState().battery).toEqual(testState);
  });

  it.each([
    [0, 0],
    [15, 0.15],
    [16, 0.16],
    [25, 0.25],
    [26, 0.26],
    [50, 0.5],
    [75, 0.75],
    [100, 1.0],
    [null, null],
    [-1, null],
    [101, null],
    [NaN, null],
    [50.5, null],
  ] as const)("calculates pure batteryFillFraction for %s -> %s", (percent, expected) => {
    const battery: BatteryState = {
      hasBattery: true,
      percent,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: null,
    };
    expect(batteryFillFraction(battery)).toBe(expected);
  });

  it("calculates fill fraction when charging with known and unknown level", () => {
    const chargingKnown: BatteryState = {
      hasBattery: true,
      percent: 50,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    };
    expect(batteryFillFraction(chargingKnown)).toBe(0.5);

    const chargingUnknown: BatteryState = {
      hasBattery: true,
      percent: null,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    };
    expect(batteryFillFraction(chargingUnknown)).toBeNull();
  });
});
