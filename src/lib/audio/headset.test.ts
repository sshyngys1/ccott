import { describe, expect, it } from "vitest";
import { detectHeadsetConnect, isHeadsetName } from "./headset";

const speakers = { id: "speaker", name: "Speakers", isDefault: true };
const headset = { id: "headset", name: "AirPods Pro", isDefault: true };

describe("headset detection", () => {
  it("recognizes names without requiring transport fields", () => {
    for (const name of [
      "BLUETOOTH",
      "BT Audio",
      "AirPods Pro",
      "Galaxy Buds",
      "Headset",
      "Headphones",
      "Hands-Free",
      "Sony WH-1000XM5",
      "WF-1000XM5",
      "JBL Tune",
      "Наушники",
      "Гарнитура",
    ]) {
      expect(isHeadsetName(name)).toBe(true);
    }
    for (const name of ["", "Speakers", "Monitor HDMI", "BTower"]) {
      expect(isHeadsetName(name)).toBe(false);
    }
  });

  it("requires a default output switch and ignores initial or repeated snapshots", () => {
    // базовая линия (первое состояние после запуска)
    expect(detectHeadsetConnect(undefined, headset)).toBeNull();

    // смена на наушники
    expect(detectHeadsetConnect(speakers, headset)).toBe(headset);
    expect(detectHeadsetConnect(null, headset)).toBe(headset);

    // смена на динамики
    expect(detectHeadsetConnect(headset, speakers)).toBeNull();
    expect(detectHeadsetConnect(headset, null)).toBeNull();

    // то же устройство
    expect(detectHeadsetConnect(headset, { ...headset, name: "Headphones" })).toBeNull();
    expect(detectHeadsetConnect(headset, headset)).toBeNull();

    // устройство не default
    expect(detectHeadsetConnect(speakers, { ...headset, isDefault: false })).toBeNull();
  });
});
