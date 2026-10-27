import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import { VOLUME_SEND_INTERVAL_MS, VOLUME_WHEEL_STEP, WheelDeltaAccumulator, initAudio, resetAudioStore, useAudioStore } from "./store";

beforeEach(() => {
  resetMock();
  resetAudioStore();
});
afterEach(() => {
  resetAudioStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("audio store", () => {
  it("loads once and follows audio://changed", async () => {
    await Promise.all([initAudio(), initAudio()]);
    expect(useAudioStore.getState().audio.volume).toBe(64);
    expect(useAudioStore.getState().ready).toBe(true);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(1));
    act(() => mockEmit("audio://changed", { volume: 20, muted: true, device: null }));
    expect(useAudioStore.getState().audio).toEqual({ volume: 20, muted: true, device: null });
  });

  it("setVolume is optimistic, un-mutes and coalesces a drag into few IPC calls", async () => {
    await initAudio();
    useAudioStore.setState({ audio: { ...useAudioStore.getState().audio, muted: true } });
    const spy = vi.spyOn(ipc, "invoke");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    const { setVolume } = useAudioStore.getState();
    setVolume(10); // first call goes out immediately
    setVolume(20);
    setVolume(30);
    setVolume(40);
    expect(useAudioStore.getState().audio).toMatchObject({ volume: 40, muted: false });
    const volumeCalls = () => spy.mock.calls.filter((c) => c[0] === "audio_set_volume");
    expect(volumeCalls()).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith("audio_set_muted", { muted: false });

    await vi.advanceTimersByTimeAsync(VOLUME_SEND_INTERVAL_MS + 5);
    expect(volumeCalls()).toHaveLength(2);
    expect(volumeCalls()[1][1]).toEqual({ volume: 40 });
  });

  it("clamps and rounds the volume", async () => {
    await initAudio();
    useAudioStore.getState().setVolume(150);
    expect(useAudioStore.getState().audio.volume).toBe(100);
    useAudioStore.getState().setVolume(-3);
    expect(useAudioStore.getState().audio.volume).toBe(0);
    useAudioStore.getState().setVolume(33.6);
    expect(useAudioStore.getState().audio.volume).toBe(34);
  });

  it("stepVolume adjusts by ±2% per step, un-mutes only on increase, and coalesces IPC calls", async () => {
    await initAudio();
    useAudioStore.setState({ audio: { ...useAudioStore.getState().audio, volume: 50, muted: true } });
    const spy = vi.spyOn(ipc, "invoke");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    const { stepVolume } = useAudioStore.getState();

    // Decreasing while muted keeps mute active and sends the updated volume.
    stepVolume(-VOLUME_WHEEL_STEP);
    expect(useAudioStore.getState().audio).toMatchObject({ volume: 48, muted: true });
    expect(spy).not.toHaveBeenCalledWith("audio_set_muted", { muted: false });

    // Increasing while muted un-mutes and coalesces volume updates.
    stepVolume(VOLUME_WHEEL_STEP);
    stepVolume(VOLUME_WHEEL_STEP);
    expect(useAudioStore.getState().audio).toMatchObject({ volume: 52, muted: false });
    expect(spy).toHaveBeenCalledWith("audio_set_muted", { muted: false });

    const volumeCalls = () => spy.mock.calls.filter((c) => c[0] === "audio_set_volume");
    expect(volumeCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(VOLUME_SEND_INTERVAL_MS + 5);
    expect(volumeCalls()).toHaveLength(2);
    expect(volumeCalls()[1][1]).toEqual({ volume: 52 });
  });

  it("WheelDeltaAccumulator normalizes mouse notches and accumulates small touchpad deltas", () => {
    const acc = new WheelDeltaAccumulator();
    // Standard mouse wheel up (-100 or -120) → +1 step; down (+100) → -1 step.
    expect(acc.consume(-100)).toBe(1);
    expect(acc.consume(-120)).toBe(1);
    expect(acc.consume(100)).toBe(-1);
    expect(acc.consume(-1, 1)).toBe(1);

    // Small touchpad deltas (-15 px each): 3 events reach ≥ 40 px → +1 step.
    expect(acc.consume(-15)).toBe(0);
    expect(acc.consume(-15)).toBe(0);
    expect(acc.consume(-15)).toBe(1);

    // Direction change drops leftover remainder in the old direction.
    expect(acc.consume(-20)).toBe(0);
    expect(acc.consume(20)).toBe(0);
    expect(acc.consume(25)).toBe(-1);
  });

  it("toggleMute flips and persists", async () => {
    await initAudio();
    await act(async () => {
      await useAudioStore.getState().toggleMute();
    });
    expect(useAudioStore.getState().audio.muted).toBe(true);
    expect((await ipc.invoke("audio_get_state")).muted).toBe(true);
  });

  it("a backend error on mute resyncs instead of throwing", async () => {
    await initAudio();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ipc, "invoke").mockRejectedValue(new Error("x"));
    await expect(useAudioStore.getState().toggleMute()).resolves.toBeUndefined();
  });

  it("lists devices and switches", async () => {
    await initAudio();
    await act(async () => {
      await useAudioStore.getState().loadDevices();
    });
    expect(useAudioStore.getState().devices.map((d) => d.name)).toContain("Наушники (Bluetooth)");
    await act(async () => {
      await useAudioStore.getState().setDevice("dev-headphones");
    });
    await waitFor(() => expect(useAudioStore.getState().audio.device?.id).toBe("dev-headphones"));
  });
});
