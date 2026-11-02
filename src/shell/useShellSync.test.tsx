import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../ipc";
import type { VibrancyResult } from "../shared/types";
import { DEFAULT_SETTINGS, resetIslandStore, useIslandStore } from "../store";
import { useLiteSync, useVibrancySync } from "./useShellSync";

vi.mock("../ipc", () => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: () => false, mockUrlParams: () => null }));

beforeEach(() => {
  resetIslandStore();
  vi.mocked(invoke).mockReset();
  document.documentElement.removeAttribute("data-vibrancy");
  document.documentElement.removeAttribute("data-lite");
});

describe("useVibrancySync", () => {
  it("loads saved lite mode immediately and restores the vibrancy preference when disabled", async () => {
    useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "acrylic", liteMode: true });
    vi.mocked(invoke).mockResolvedValue({ requested: "none", applied: "none", error: null });
    renderHook(() => { useLiteSync(); useVibrancySync(); });
    expect(document.documentElement.dataset.lite).toBe("true");
    expect(invoke).toHaveBeenLastCalledWith("window_set_vibrancy", { mode: "none" });
    expect(useIslandStore.getState().settings.vibrancy).toBe("acrylic");
    vi.mocked(invoke).mockResolvedValue({ requested: "acrylic", applied: "acrylic", error: null });
    act(() => useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "acrylic", liteMode: false }));
    expect(document.documentElement.dataset.lite).toBe("false");
    expect(invoke).toHaveBeenLastCalledWith("window_set_vibrancy", { mode: "acrylic" });
    await waitFor(() => expect(document.documentElement.dataset.vibrancy).toBe("acrylic"));
  });

  it("ignores a pending native backdrop response after enabling lite mode", async () => {
    let finish!: (result: VibrancyResult) => void;
    useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "mica" });
    vi.mocked(invoke).mockReturnValueOnce(new Promise<VibrancyResult>((resolve) => { finish = resolve; }));
    renderHook(() => { useLiteSync(); useVibrancySync(); });
    vi.mocked(invoke).mockResolvedValue({ requested: "none", applied: "none", error: null });
    act(() => useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "mica", liteMode: true }));
    expect(invoke).toHaveBeenLastCalledWith("window_set_vibrancy", { mode: "none" });
    await act(async () => { finish({ requested: "mica", applied: "mica", error: null }); });
    expect(document.documentElement.dataset.lite).toBe("true");
    expect(document.documentElement.dataset.vibrancy).toBe("none");
    expect(useIslandStore.getState().vibrancy).toBe("none");
  });

  it("requests none by default and follows the saved vibrancy setting", async () => {
    vi.mocked(invoke).mockResolvedValue({ requested: "none", applied: "none", error: null });
    renderHook(() => useVibrancySync());
    expect(DEFAULT_SETTINGS.vibrancy).toBe("none");
    expect(invoke).toHaveBeenCalledWith("window_set_vibrancy", { mode: "none" });
    await waitFor(() => expect(useIslandStore.getState().vibrancy).toBe("none"));
    vi.mocked(invoke).mockResolvedValue({ requested: "mica", applied: "mica", error: null });
    act(() => useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "mica" }));
    expect(invoke).toHaveBeenLastCalledWith("window_set_vibrancy", { mode: "mica" });
    await waitFor(() => expect(document.documentElement.dataset.vibrancy).toBe("mica"));
  });

  it("ignores an outdated native response after the setting changes", async () => {
    let finish!: (result: VibrancyResult) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise<VibrancyResult>((resolve) => { finish = resolve; }));
    renderHook(() => useVibrancySync());
    vi.mocked(invoke).mockResolvedValue({ requested: "mica", applied: "mica", error: null });
    act(() => useIslandStore.getState().applySettings({ ...DEFAULT_SETTINGS, vibrancy: "mica" }));
    await waitFor(() => expect(useIslandStore.getState().vibrancy).toBe("mica"));
    await act(async () => { finish({ requested: "none", applied: "none", error: null }); });
    expect(document.documentElement.dataset.vibrancy).toBe("mica");
  });
});
