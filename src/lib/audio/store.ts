// System volume / mute / output device. One subscription to `audio://changed`.
import { useEffect } from "react";
import { create } from "zustand";
import { invoke } from "../../ipc";
import type { AudioDevice, AudioState } from "../../shared/types";
import { createEventSync } from "../ipcSync";

/** Slider drags and wheel ticks are coalesced: at most one `audio_set_volume` per interval (the last value always goes out). */
export const VOLUME_SEND_INTERVAL_MS = 60;

/** Volume change per normalized mouse-wheel step (in percentage points). */
export const VOLUME_WHEEL_STEP = 2;

/** Pixel delta threshold below which wheel events are treated as fine touchpad scrolling and accumulated. */
export const WHEEL_TOUCHPAD_THRESHOLD_PX = 40;

export const EMPTY_AUDIO: AudioState = { volume: 0, muted: false, device: null };

export interface AudioStore {
  audio: AudioState;
  /** false until the first snapshot arrives. */
  ready: boolean;
  devices: AudioDevice[];
  applyState: (next: AudioState) => void;
  /** Optimistic; moving the slider also un-mutes (spec §6.2). */
  setVolume: (volume: number) => void;
  /** Optimistic relative step (e.g. ±2% from mouse wheel); un-mutes only when `delta > 0`. */
  stepVolume: (delta: number) => void;
  toggleMute: () => Promise<void>;
  loadDevices: () => Promise<void>;
  setDevice: (id: string) => Promise<void>;
}

/**
 * Normalizes `WheelEvent.deltaY` across discrete mouse wheels and continuous touchpads.
 * Returns the signed number of volume steps (+1 = up / louder, -1 = down / quieter).
 */
export class WheelDeltaAccumulator {
  private remainder = 0;

  reset(): void {
    this.remainder = 0;
  }

  consume(deltaY: number, deltaMode = 0): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    // Wheel up is negative deltaY → positive volume step (+1).
    const direction = -Math.sign(deltaY);
    if (this.remainder !== 0 && Math.sign(this.remainder) !== direction) {
      this.remainder = 0;
    }

    const abs = Math.abs(deltaY);
    if (deltaMode === 1 || deltaMode === 2) {
      this.remainder = 0;
      return direction * Math.max(1, Math.round(abs / 3));
    }

    if (abs >= WHEEL_TOUCHPAD_THRESHOLD_PX) {
      this.remainder = 0;
      const notches = abs <= 160 ? 1 : Math.max(1, Math.round(abs / 100));
      return direction * notches;
    }

    this.remainder += direction * (abs / WHEEL_TOUCHPAD_THRESHOLD_PX);
    const steps = Math.trunc(this.remainder);
    if (steps !== 0) {
      this.remainder -= steps;
      return steps;
    }
    return 0;
  }
}

let sendTimer: number | null = null;
let pendingVolume: number | null = null;
let lastSentAt = 0;

const clampVolume = (v: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(v) ? v : 0)));

function flushVolume(): void {
  sendTimer = null;
  if (pendingVolume === null) return;
  const volume = pendingVolume;
  pendingVolume = null;
  lastSentAt = Date.now();
  invoke("audio_set_volume", { volume }).catch((err: unknown) => {
    console.warn("[island] audio_set_volume failed", err);
    void sync.init();
  });
}

function scheduleVolumeSend(volume: number): void {
  pendingVolume = volume;
  if (sendTimer !== null) return;
  const wait = Math.max(0, VOLUME_SEND_INTERVAL_MS - (Date.now() - lastSentAt));
  if (wait === 0) flushVolume();
  else sendTimer = window.setTimeout(flushVolume, wait);
}

export const useAudioStore = create<AudioStore>()((set, get) => ({
  audio: EMPTY_AUDIO,
  ready: false,
  devices: [],

  applyState: (next) => {
    // While a drag is still being sent, events echo older values: keep the local one.
    if (pendingVolume !== null) set({ audio: { ...next, volume: get().audio.volume }, ready: true });
    else set({ audio: next, ready: true });
  },

  setVolume: (raw) => {
    const volume = clampVolume(raw);
    const { audio } = get();
    set({ audio: { ...audio, volume, muted: false } });
    if (audio.muted) {
      invoke("audio_set_muted", { muted: false }).catch((err: unknown) => console.warn("[island] audio_set_muted failed", err));
    }
    scheduleVolumeSend(volume);
  },

  stepVolume: (delta) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    const { audio } = get();
    const volume = clampVolume(audio.volume + delta);
    const shouldUnmute = audio.muted && delta > 0;
    const muted = shouldUnmute ? false : audio.muted;
    set({ audio: { ...audio, volume, muted } });
    if (shouldUnmute) {
      invoke("audio_set_muted", { muted: false }).catch((err: unknown) => console.warn("[island] audio_set_muted failed", err));
    }
    scheduleVolumeSend(volume);
  },

  toggleMute: async () => {
    const muted = !get().audio.muted;
    set({ audio: { ...get().audio, muted } });
    try {
      await invoke("audio_set_muted", { muted });
    } catch (err) {
      console.warn("[island] audio_set_muted failed", err);
      void sync.init();
    }
  },

  loadDevices: async () => {
    try {
      set({ devices: await invoke("audio_list_devices") });
    } catch (err) {
      console.warn("[island] audio_list_devices failed", err);
    }
  },

  setDevice: async (id) => {
    try {
      await invoke("audio_set_device", { id });
    } catch (err) {
      console.warn("[island] audio_set_device failed", err);
    }
  },
}));

const sync = createEventSync({
  event: "audio://changed",
  load: () => invoke("audio_get_state"),
  apply: (state) => useAudioStore.getState().applyState(state),
});

let audioConsumers = 0;
let pinnedAudio = false;
export const initAudio = (): Promise<void> => { pinnedAudio = true; return sync.init(); };

/** Eq needs real mute/volume before Home mounts, with a releasable subscription. */
export function retainAudio(): () => void {
  audioConsumers++;
  void sync.init();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    audioConsumers = Math.max(0, audioConsumers - 1);
    if (!audioConsumers && !pinnedAudio) sync.reset();
  };
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  sync.reset();
  if (sendTimer !== null) window.clearTimeout(sendTimer);
});

/** Tests: drop the subscription, timers and state. */
export function resetAudioStore(): void {
  audioConsumers = 0;
  pinnedAudio = false;
  sync.reset();
  if (sendTimer !== null) window.clearTimeout(sendTimer);
  sendTimer = null;
  pendingVolume = null;
  lastSentAt = 0;
  useAudioStore.setState({ audio: EMPTY_AUDIO, ready: false, devices: [] });
}

export function useAudio(): AudioStore {
  useEffect(() => {
    void initAudio();
  }, []);
  return useAudioStore();
}
