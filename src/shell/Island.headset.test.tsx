import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockConnectHeadset, mockEmit, mockListenerCount, mockSetMedia, resetMock } from "../ipc/mock";
import { resetAudioStore, useAudioStore } from "../lib/audio/store";
import { HEADSET_DISPLAY_MS, useHeadsetStore } from "../lib/audio/HeadsetPill";
import { resetDownloadsStore } from "../lib/downloads/store";
import { EMPTY_MEDIA } from "../lib/media/progress";
import { resetMediaStore, useMediaStore } from "../lib/media/store";
import { resetTimerStore, useTimerStore } from "../lib/timer/store";
import type { AudioDevice, DownloadItem } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { showToast } from "./toast";

const speakers: AudioDevice = { id: "dev-speakers", name: "Speakers", isDefault: true };
const activeDownload: DownloadItem = {
  id: "dl-1",
  name: "archive.zip",
  state: "active",
  receivedBytes: 1000,
  totalBytes: 5000,
  bytesPerSec: 500,
  startedAt: 0,
  updatedAt: 0,
};

describe("Island headset live activity", () => {
  beforeEach(() => {
    resetMock();
    resetIslandStore();
    resetMediaStore();
    resetTimerStore();
    resetDownloadsStore();
    resetAudioStore();
    useHeadsetStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    resetMock();
    resetIslandStore();
    resetMediaStore();
    resetTimerStore();
    resetDownloadsStore();
    resetAudioStore();
    useHeadsetStore.getState().reset();
    document.documentElement.removeAttribute("data-lite");
    vi.useRealTimers();
  });

  it("shows for ~2.5s and preempts media, then media returns", async () => {
    // Establish baseline with speakers
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    // Initially media pill is visible
    expect(screen.getByRole("button", { name: /Открыть плеер/ })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // Switch default audio device to headphones
    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    // Headset activity shows immediately
    const headsetPill = screen.getByRole("status", { name: /AirPods Pro/ });
    expect(headsetPill).toBeInTheDocument();
    expect(screen.getByText("AirPods Pro")).toBeInTheDocument();
    expect(screen.getByText("Подключено")).toBeInTheDocument();

    // Advance 2500ms
    act(() => {
      vi.advanceTimersByTime(HEADSET_DISPLAY_MS);
    });

    // Headset disappears, media pill remains/returns
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Открыть плеер/ })).toBeInTheDocument();
  });

  it("preempts timer for ~2.5s, then timer returns", async () => {
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    // Start timer (priority 20)
    act(() => {
      useTimerStore.getState().toggle();
    });
    expect(screen.getByRole("button", { name: /таймер/i })).toBeInTheDocument();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // Switch to headphones
    act(() => {
      mockConnectHeadset("Sony WH-1000XM5");
    });

    // Headset beats timer!
    expect(screen.getByRole("status", { name: /Sony WH-1000XM5/ })).toBeInTheDocument();

    // After 2.5s, headset disappears and returns to timer
    act(() => {
      vi.advanceTimersByTime(HEADSET_DISPLAY_MS);
    });
    expect(screen.queryByRole("status", { name: /Sony WH-1000XM5/ })).toBeNull();
    expect(screen.getByRole("button", { name: /таймер/i })).toBeInTheDocument();
  });

  it("yields to active downloads (downloads outrank headset)", async () => {
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    // Start active download
    act(() => {
      mockEmit("downloads://changed", [activeDownload]);
    });
    expect(screen.getByRole("button", { name: /archive.zip/ })).toBeInTheDocument();

    // Switch to headphones
    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    // Download continues to be displayed; headset yields to download
    expect(screen.getByRole("button", { name: /archive.zip/ })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();
  });

  it("yields to toasts (toasts outrank headset)", async () => {
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    // Show a toast
    act(() => {
      showToast({ label: "Screenshot saved" });
    });
    expect(screen.getByText("Screenshot saved")).toBeInTheDocument();

    // Switch to headphones
    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    // Toast continues to be displayed; headset yields to toast
    expect(screen.getByText("Screenshot saved")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();
  });

  it("does not show when Do Not Disturb is enabled", async () => {
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        doNotDisturb: true,
      });
    });

    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    // Suppressed by DND
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();
  });

  it("shows when media is stopped (EMPTY_MEDIA) and audioMeter is disabled, releasing on unmount", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    expect(mockListenerCount("audio://changed")).toBe(0);

    const { unmount } = render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(1));

    // Apply disabled features after mount to avoid race with settings_get
    act(() => {
      useIslandStore.getState().applySettings({
        ...useIslandStore.getState().settings,
        disabledFeatures: ["audioMeter"],
      });
    });

    expect(mockListenerCount("audio://changed")).toBe(1);

    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    // Headset activity shows up despite stopped media and disabled audioMeter!
    expect(screen.getByRole("status", { name: /AirPods Pro/ })).toBeInTheDocument();

    // On unmount, headset releases audio subscription
    unmount();
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(0));
    expect(useHeadsetStore.getState().device).toBeNull();
  });

  it("reflects useHeadsetStore.reset() directly in UI", async () => {
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(1));

    act(() => {
      mockConnectHeadset("AirPods Pro");
    });
    expect(screen.getByRole("status", { name: /AirPods Pro/ })).toBeInTheDocument();
    expect(useHeadsetStore.getState().device?.name).toBe("AirPods Pro");

    // reset() in store immediately removes headset activity from UI
    act(() => {
      useHeadsetStore.getState().reset();
    });
    expect(screen.queryByRole("status", { name: /AirPods Pro/ })).toBeNull();
    expect(useHeadsetStore.getState().device).toBeNull();
  });

  it("operates cleanly in lite mode and without scale animations", async () => {
    document.documentElement.setAttribute("data-lite", "true");
    useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: speakers } });

    const { container } = render(<Island />);
    await waitFor(() => expect(mockListenerCount("audio://changed")).toBeGreaterThan(0));

    act(() => {
      mockConnectHeadset("AirPods Pro");
    });

    const pill = container.querySelector(".ig-headset-pill");
    expect(pill).toBeInTheDocument();
    // No scale in styles
    expect(pill).not.toHaveStyle({ transform: "scale(1)" });
    expect(container.querySelector(".ig-headset-symbol")).toBeInTheDocument();
  });
});
