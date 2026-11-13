import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetAudioStore, useAudioStore } from "./store";
import { HEADSET_DISPLAY_MS, HeadsetPill, useHeadsetConnect, useHeadsetStore } from "./HeadsetPill";
import { resetIslandStore, useIslandStore } from "../../store";
import { mockListenerCount, resetMock } from "../../ipc/mock";

const device = { id: "pods", name: "AirPods Pro", isDefault: true };

beforeEach(() => {
  useHeadsetStore.getState().reset();
});

afterEach(() => {
  useHeadsetStore.getState().reset();
  resetAudioStore();
  resetIslandStore();
  resetMock();
  vi.useRealTimers();
});

it("holds a connected output for ~2.5 seconds without replaying volume events, respecting DND", () => {
  vi.useFakeTimers();
  expect(HEADSET_DISPLAY_MS).toBe(2500);

  useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: null } });
  const { result, unmount } = renderHook(useHeadsetConnect);
  expect(result.current).toBeNull();

  const apply = (volume: number) => useAudioStore.getState().applyState({ volume, muted: false, device });

  // Connects headset -> shows device
  act(() => apply(50));
  expect(result.current).toEqual(device);

  // Volume change within the 2.5s window does not re-trigger or cancel
  act(() => vi.advanceTimersByTime(2000));
  act(() => apply(60));
  expect(result.current).toEqual(device);

  // Advances past 2500ms -> disappears
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toBeNull();

  // DND suppresses connect
  act(() => useAudioStore.getState().applyState({ volume: 50, muted: false, device: null }));
  useIslandStore.setState({ doNotDisturb: true });
  act(() => apply(50));
  expect(result.current).toBeNull();

  unmount();
});

it("hides the unavailable battery slot and clamps an optional level", () => {
  const { container, rerender } = render(<HeadsetPill device={device} />);
  expect(screen.getByRole("status")).toHaveAccessibleName(/AirPods Pro/);
  expect(container.querySelector(".ig-num")).toBeNull();

  rerender(<HeadsetPill device={device} batteryPercent={150} />);
  expect(screen.getByText("100%")).toBeInTheDocument();

  rerender(<HeadsetPill device={device} batteryPercent={null} />);
  expect(container.querySelector(".ig-num")).toBeNull();
});

it("renders without device prop using useHeadsetStore", () => {
  useHeadsetStore.getState().setDevice(device);
  const { container } = render(<HeadsetPill />);
  expect(screen.getByRole("status")).toHaveAccessibleName(/AirPods Pro/);
  expect(container.querySelector(".ig-headset-symbol")).toBeInTheDocument();
  // Ensure no scale in style or attributes
  expect(container.querySelector(".ig-headset-pill")).not.toHaveStyle({ transform: "scale(1)" });
});

it("honors reduced motion: no scale pulse and instant/short opacity transition", () => {
  const { container } = render(
    <MotionConfig reducedMotion="always">
      <HeadsetPill device={device} />
    </MotionConfig>,
  );
  const pill = container.querySelector(".ig-headset-pill");
  expect(pill).toBeInTheDocument();
  expect(container.querySelector(".ig-headset-pulse")).toBeNull();
  expect(pill?.getAttribute("style") ?? "").not.toContain("scale");
});

it("retains audio subscription while mounted and releases on unmount", async () => {
  expect(mockListenerCount("audio://changed")).toBe(0);
  const { unmount } = renderHook(useHeadsetConnect);
  await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(1));
  unmount();
  await waitFor(() => expect(mockListenerCount("audio://changed")).toBe(0));
});

it("reads from useHeadsetStore as single source of truth, resetting on unmount and reflecting store.reset()", () => {
  useAudioStore.setState({ ready: true, audio: { volume: 50, muted: false, device: null } });
  const { result, unmount } = renderHook(useHeadsetConnect);
  expect(result.current).toBeNull();

  act(() => {
    useAudioStore.getState().applyState({ volume: 50, muted: false, device });
  });
  expect(result.current).toEqual(device);
  expect(useHeadsetStore.getState().device).toEqual(device);

  // reset() store directly -> hook updates immediately
  act(() => {
    useHeadsetStore.getState().reset();
  });
  expect(result.current).toBeNull();
  expect(useHeadsetStore.getState().device).toBeNull();

  // Re-trigger connect
  act(() => {
    useAudioStore.getState().applyState({ volume: 50, muted: false, device: null });
  });
  act(() => {
    useAudioStore.getState().applyState({ volume: 50, muted: false, device });
  });
  expect(result.current).toEqual(device);

  // Unmount hook -> clears store device
  unmount();
  expect(useHeadsetStore.getState().device).toBeNull();
});
