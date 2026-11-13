import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { create } from "zustand";
import { IconHeadphones } from "../../design/icons";
import { durations, easings } from "../../design/motion";
import { useT } from "../../i18n";
import { useIslandStore } from "../../store";
import type { AudioDevice } from "../../shared/types";
import { retainAudio, useAudioStore } from "./store";
import { detectHeadsetConnect } from "./headset";

export const HEADSET_DISPLAY_MS = 2500;

interface HeadsetStore {
  device: AudioDevice | null;
  setDevice: (device: AudioDevice | null) => void;
  reset: () => void;
}

let activeTimer: ReturnType<typeof setTimeout> | undefined;

export const useHeadsetStore = create<HeadsetStore>((set) => ({
  device: null,
  setDevice: (device) => {
    if (!device && activeTimer !== undefined) {
      clearTimeout(activeTimer);
      activeTimer = undefined;
    }
    set({ device });
  },
  reset: () => {
    if (activeTimer !== undefined) {
      clearTimeout(activeTimer);
      activeTimer = undefined;
    }
    set({ device: null });
  },
}));

export function useHeadsetConnect(): AudioDevice | null {
  const device = useHeadsetStore((s) => s.device);

  useEffect(() => {
    const release = retainAudio();
    let previous = useAudioStore.getState().ready ? useAudioStore.getState().audio.device : undefined;

    const off = useAudioStore.subscribe(({ audio, ready }) => {
      if (!ready) {
        previous = undefined;
        return;
      }
      const connected = detectHeadsetConnect(previous, audio.device);
      previous = audio.device;
      if (connected && !useIslandStore.getState().doNotDisturb) {
        if (activeTimer !== undefined) clearTimeout(activeTimer);
        useHeadsetStore.getState().setDevice(connected);
        activeTimer = setTimeout(() => {
          activeTimer = undefined;
          useHeadsetStore.getState().setDevice(null);
        }, HEADSET_DISPLAY_MS);
      }
    });

    return () => {
      off();
      release();
      if (activeTimer !== undefined) {
        clearTimeout(activeTimer);
        activeTimer = undefined;
      }
      useHeadsetStore.getState().setDevice(null);
    };
  }, []);

  return device;
}

export interface HeadsetPillProps {
  device?: AudioDevice | null;
  batteryPercent?: number | null;
}

export function HeadsetPill({ device, batteryPercent = null }: HeadsetPillProps) {
  const t = useT();
  const storeDevice = useHeadsetStore((s) => s.device);
  const activeDevice = device ?? storeDevice;
  const reduced = useReducedMotion();

  if (!activeDevice) return null;

  return (
    <motion.div
      className="ig-pill-row mod-pill ig-headset-pill"
      role="status"
      aria-label={t("headset.connectedLabel", { name: activeDevice.name })}
      initial={{ opacity: 0, y: reduced ? 0 : 2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -2 }}
      transition={{ duration: reduced ? durations.instant : durations.med, ease: easings.out }}
    >
      <span className="ig-art ig-art--pill ig-headset-symbol" aria-hidden="true">
        <IconHeadphones size={16} />
      </span>
      <span className="ig-headset-copy">
        <b className="ig-truncate">{activeDevice.name}</b>
        <span className="ig-truncate">{t("headset.connected")}</span>
      </span>
      {batteryPercent !== null && Number.isFinite(batteryPercent) && (
        <span className="ig-num">{Math.round(Math.max(0, Math.min(100, batteryPercent)))}%</span>
      )}
    </motion.div>
  );
}
