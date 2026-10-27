import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../ipc";
import type { VibrancyResult } from "../shared/types";
import { DEFAULT_SETTINGS, resetIslandStore, useIslandStore } from "../store";
import { useVibrancySync } from "./useShellSync";

vi.mock("../ipc", () => ({ invoke: vi.fn(), listen: vi.fn() }));

beforeEach(() => {
  resetIslandStore();
  vi.mocked(invoke).mockReset();
  document.documentElement.removeAttribute("data-vibrancy");
});

describe("useVibrancySync", () => {
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
