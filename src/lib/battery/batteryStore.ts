// Owner: F2 (Frontend-Modules). Laptop battery store & formatting.
import { create } from "zustand";
import type { BatteryState } from "../../shared/types";
import { invoke } from "../../ipc";

import { createEventSync } from "../ipcSync";
import type { t as translate } from "../../i18n";

export interface BatteryStoreState {
  battery: BatteryState;
  setBattery: (battery: BatteryState) => void;
}

const initialBattery: BatteryState = {
  hasBattery: null,
  percent: null,
  charging: null,
  acConnected: null,
  saver: null,
  remainingSeconds: null,
};

export const useBatteryStore = create<BatteryStoreState>()((set) => ({
  battery: initialBattery,
  setBattery: (battery) => set({ battery }),
}));

const sync = createEventSync({
  event: "system://battery",
  load: () => invoke("system_get_battery"),
  apply: battery => useBatteryStore.getState().setBattery(battery),
});
let consumers = 0;

export function initBatteryStore(): () => void {
  consumers++;
  void sync.init();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0) sync.reset();
  };
}

export function batteryPercent(state: BatteryState): number | null {
  return state.percent !== null && Number.isInteger(state.percent) && state.percent >= 0 && state.percent <= 100
    ? state.percent : null;
}

export function batteryFillFraction(state: BatteryState): number | null {
  const percent = batteryPercent(state);
  return percent !== null ? percent / 100 : null;
}

export function batteryTone(state: BatteryState): "charging" | "critical" | "low" | "normal" | "unknown" {
  if (state.charging === true) return "charging";
  const percent = batteryPercent(state);
  if (percent === null) return "unknown";
  return percent <= 15 ? "critical" : percent <= 25 ? "low" : "normal";
}

if (import.meta.hot) import.meta.hot.dispose(() => { consumers = 0; sync.reset(); });

export function formatBatteryLabel(
  state: BatteryState,
  t: typeof translate,
): string | null {
  if (state.hasBattery !== true) {
    return null;
  }

  const percent = batteryPercent(state);
  const status = state.charging === true ? t("battery.charging")
    : state.charging === false ? t("battery.notCharging") : t("battery.chargingUnknownStatus");
  const level = percent === null ? t("battery.unknown")
    : state.saver === true && state.charging !== true ? t("battery.saverPercent", { percent }) : t("battery.percent", { percent });
  return level + " · " + status;
}
