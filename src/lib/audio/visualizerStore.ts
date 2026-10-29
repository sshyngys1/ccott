// A lifecycle-owned, lightweight spectrum store. Only Eq subscribes to 20 Hz bands.
import { useSyncExternalStore, useEffect } from "react";
import type { AudioSpectrum } from "../../shared/types";
import { invoke, listen, type Unlisten } from "../../ipc";
import { retainAudio, useAudioStore } from "./store";

export type SpectrumBands = [number, number, number, number];
const SILENCE_BANDS: SpectrumBands = [0, 0, 0, 0];
interface CaptureQueue { tail: Promise<void> }
const captureQueue: CaptureQueue = import.meta.hot?.data.captureQueue ?? { tail: Promise.resolve() };

export class VisualizerManager {
  private currentBands = SILENCE_BANDS;
  private listeners = new Set<() => void>();
  private consumers = new Set<number>();
  private nextConsumer = 0;
  private generation = 0;
  private unlisten: Unlisten | null = null;
  private listening = false;
  private captureAcknowledged = false;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSampledAt = 0;
  private startedAt = 0;
  private disposed = false;

  constructor(private queue: CaptureQueue = captureQueue) {}

  private start() {
    if (this.listening || this.unlisten || this.disposed) return;
    const generation = ++this.generation;
    this.startedAt = Date.now();
    this.listening = true;
    listen("audio://spectrum", spectrum => {
      if (generation === this.generation) this.handleSpectrumEvent(spectrum);
    }).then(unlisten => {
      if (generation !== this.generation || !this.consumers.size || this.disposed) {
        unlisten();
        return;
      }
      this.listening = false;
      this.unlisten = unlisten;
      this.enqueueCapture(true, generation);
    }, () => {
      if (generation !== this.generation) return;
      this.listening = false;
      this.clear();
      // Retry only on a later consumer activation, never in a retry loop.
    });
  }

  private enqueueCapture(enabled: boolean, generation: number) {
    this.queue.tail = this.queue.tail.then(async () => {
      try {
        await invoke("audio_visualizer_set_enabled", { enabled });
        if (generation === this.generation) this.captureAcknowledged = enabled && this.consumers.size > 0;
      } catch {
        if (generation === this.generation) {
          this.captureAcknowledged = false;
          this.clear();
        }
      }
    });
  }

  private stop() {
    const generation = ++this.generation;
    this.listening = false;
    this.captureAcknowledged = false;
    this.unlisten?.();
    this.unlisten = null;
    this.clear();
    this.lastSampledAt = 0;
    this.enqueueCapture(false, generation);
  }

  public handleSpectrumEvent(spectrum: AudioSpectrum) {
    if (!this.consumers.size || !this.captureAcknowledged || this.disposed) return;
    const now = Date.now();
    const sampledAt = spectrum.sampledAt;
    if (!Number.isSafeInteger(sampledAt) || sampledAt < this.startedAt || sampledAt > now + 100
      || now - sampledAt > 500 || sampledAt < this.lastSampledAt) {
      this.clear();
      return;
    }
    this.lastSampledAt = sampledAt;
    if (spectrum.available !== true || !Array.isArray(spectrum.bands) || spectrum.bands.length !== 4) {
      this.clear();
      return;
    }
    const sanitized = spectrum.bands.map(value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0) as SpectrumBands;
    this.updateBands(sanitized);
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.clear(), Math.max(0, 501 - (now - sampledAt)));
  }

  private clear() {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    this.updateBands(SILENCE_BANDS);
  }

  private updateBands(bands: SpectrumBands) {
    if (this.currentBands.every((value, index) => value === bands[index])) return;
    this.currentBands = bands;
    for (const listener of this.listeners) listener();
  }

  public getSnapshot = (): SpectrumBands => this.currentBands;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  public registerConsumer(): () => void {
    this.disposed = false;
    const token = ++this.nextConsumer;
    this.consumers.add(token);
    this.start();
    return () => this.release(token);
  }

  private release(token: number) {
    if (!this.consumers.delete(token)) return;
    if (!this.consumers.size) this.stop();
  }

  public unregisterConsumer() {
    const token = this.consumers.values().next().value;
    if (token !== undefined) this.release(token);
  }

  public dispose() {
    this.consumers.clear();
    this.stop();
    this.disposed = true;
  }
  public resetForTests() { this.dispose(); this.disposed = false; }
  public settled(): Promise<void> { return this.queue.tail; }
  public getActiveConsumers() { return this.consumers.size; }
  public isCaptureEnabled() { return this.consumers.size > 0; }
}

export const visualizerManager = new VisualizerManager();
if (import.meta.hot) import.meta.hot.dispose(data => {
  visualizerManager.dispose();
  data.captureQueue = captureQueue;
});

export function useSpectrumBands(playing: boolean): SpectrumBands {
  const audible = useAudioStore(state => state.ready && !state.audio.muted && state.audio.volume > 0);
  const bands = useSyncExternalStore(visualizerManager.subscribe, visualizerManager.getSnapshot, () => SILENCE_BANDS);
  useEffect(() => retainAudio(), []);
  useEffect(() => {
    if (playing && audible) return visualizerManager.registerConsumer();
  }, [playing, audible]);
  return playing && audible ? bands : SILENCE_BANDS;
}
