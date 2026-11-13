import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Island } from "./Island";
import { mockCmdOpen, mockEmit, mockListenerCount, mockStats, resetMock } from "../ipc/mock";
import { useIslandStore } from "../store";
import { invoke } from "../ipc";
import { TILE_REGISTRY } from "../lib/tiles/registry";
import { DEFAULT_QUICK_TILES } from "../shared/types";

describe("Island Command Bar shell integration", () => {
  it.each(["1x1", "2x1"] as const)("opens from a %s command tile, focuses input, holds after pointer leave, and closes on external focus", async (size) => {
    expect(DEFAULT_QUICK_TILES.some((tile) => tile.id === "command")).toBe(false);
    expect(TILE_REGISTRY.command.allowedSizes).toContain(size);
    await invoke("settings_set", { patch: { quickTiles: [{ id: "command", size }] } });
    render(<Island />);
    await waitFor(() => expect(useIslandStore.getState().settings.quickTiles).toEqual([{ id: "command", size }]));
    act(() => useIslandStore.getState().setMode("expanded"));
    fireEvent.click(await screen.findByRole("button", { name: "Командная строка" }));
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    expect(useIslandStore.getState().view).toBe("cmd");
    act(() => mockEmit("island://hover", { inside: false }));
    expect(useIslandStore.getState().mode).toBe("expanded");
    act(() => mockEmit("island://focus-changed", { active: false }));
    expect(useIslandStore.getState().mode).toBe("collapsed");
  });
  beforeEach(() => {
    resetMock();
    act(() => {
      useIslandStore.getState().setMode("collapsed");
      useIslandStore.getState().setView("tabs");
      useIslandStore.getState().setKeyboardFocus(false);
      useIslandStore.getState().setHoverInside(false);
    });
  });

  it("expands to command bar on cmd://open and takes focus", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useIslandStore.getState().view).toBe("tabs");

    // Rust emits cmd://open
    act(() => {
      mockCmdOpen();
    });

    await waitFor(() => {
      expect(useIslandStore.getState().mode).toBe("expanded");
      expect(useIslandStore.getState().view).toBe("cmd");
    });

    // Combobox (input) is mounted
    const input = await screen.findByRole("combobox");
    expect(input).toBeInTheDocument();
  });

  it("stays open when the cursor is elsewhere and closes when another window takes focus", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("island://focus-changed")).toBeGreaterThan(0));
    act(() => {
      mockCmdOpen();
      mockEmit("island://hover", { inside: false });
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().view).toBe("cmd");

    act(() => {
      mockEmit("island://focus-changed", { active: false });
    });
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("collapsed"));
  });

  it("keeps cmd open and restores input focus after a technical null-target blur", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));
    act(() => mockCmdOpen());
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    // Finish the initial native focus request: recovery must also work after it has resolved.
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    expect(useIslandStore.getState().hoverInside).toBe(false);
    expect(useIslandStore.getState().keyboardFocus).toBe(true);

    for (let i = 0; i < 2; i++) {
      // Real DOM blur: relatedTarget=null and activeElement becomes body (unlike fireEvent.blur alone).
      act(() => input.blur());
      expect(input).not.toHaveFocus();
      expect(useIslandStore.getState().mode).toBe("expanded");
      expect(useIslandStore.getState().view).toBe("cmd");
      await waitFor(() => expect(input).toHaveFocus());
      expect(useIslandStore.getState().keyboardFocus).toBe(true);
    }
    expect(mockStats.keyboardFocusCalls).toEqual([true]);
    fireEvent.change(input, { target: { value: "2+2" } });
    expect(input).toHaveValue("2+2");
  });

  it.each(["external focus", "Escape", "hotkey"] as const)("does not restore pending cmd focus after %s closes it", async (close) => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));
    act(() => mockCmdOpen());
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));

    act(() => {
      input.blur();
      if (close === "external focus") mockEmit("island://focus-changed", { active: false });
      else if (close === "hotkey") mockCmdOpen();
      else fireEvent.keyDown(input, { key: "Escape" });
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useIslandStore.getState().view).toBe("tabs");
    expect(useIslandStore.getState().keyboardFocus).toBe(false);
    expect(input).not.toHaveFocus();
    expect(mockStats.keyboardFocusCalls).toEqual(close === "external focus" ? [true] : [true, false]);
  });

  it("cancels pending cmd focus restoration on unmount without stealing focus", async () => {
    const { unmount } = render(<Island />);
    render(<div tabIndex={-1} data-testid="outside-focus" />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));
    act(() => mockCmdOpen());
    const input = await screen.findByRole("combobox");
    const outside = screen.getByTestId("outside-focus");
    await waitFor(() => expect(input).toHaveFocus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));

    const schedule = vi.spyOn(globalThis, "setTimeout");
    const cancel = vi.spyOn(globalThis, "clearTimeout");
    const focus = vi.spyOn(input, "focus");
    try {
      act(() => input.blur());
      expect(input).not.toHaveFocus();
      const restoreIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 0);
      expect(restoreIndex).toBeGreaterThanOrEqual(0);
      const restoreTimer = schedule.mock.results[restoreIndex].value;

      unmount();
      expect(cancel).toHaveBeenCalledWith(restoreTimer);
      act(() => outside.focus());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(focus).not.toHaveBeenCalled();
      expect(outside).toHaveFocus();
      expect(useIslandStore.getState().keyboardFocus).toBe(false);
      expect(mockStats.keyboardFocusCalls).toEqual([true, false]);
    } finally {
      focus.mockRestore();
      cancel.mockRestore();
      schedule.mockRestore();
    }
  });

  it("keeps cmd open on DOM focus transfers and does not steal focus from another element", async () => {
    render(<><Island /><div tabIndex={-1} data-testid="outside-focus" /></>);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));
    act(() => mockCmdOpen());
    const input = await screen.findByRole("combobox");
    const outside = screen.getByTestId("outside-focus");
    await waitFor(() => expect(input).toHaveFocus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));

    for (const technicalBlur of [true, false]) {
      act(() => {
        input.focus();
        if (technicalBlur) input.blur();
        outside.focus();
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(outside).toHaveFocus();
      expect(useIslandStore.getState().mode).toBe("expanded");
      expect(useIslandStore.getState().view).toBe("cmd");
      expect(useIslandStore.getState().keyboardFocus).toBe(true);
    }
    expect(mockStats.keyboardFocusCalls).toEqual([true]);
  });

  it("toggles closed on second cmd://open", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));

    act(() => {
      mockCmdOpen();
    });

    await waitFor(() => {
      expect(useIslandStore.getState().view).toBe("cmd");
    });

    // Second hotkey press closes it
    act(() => {
      mockCmdOpen();
    });

    await waitFor(() => {
      expect(useIslandStore.getState().mode).toBe("collapsed");
    });
  });

  it("switches to command bar if regular tabs panel was open", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));

    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setView("tabs");
    });

    await waitFor(() => {
      expect(useIslandStore.getState().mode).toBe("expanded");
      expect(useIslandStore.getState().view).toBe("tabs");
    });

    // Trigger cmd://open
    act(() => {
      mockCmdOpen();
    });

    await waitFor(() => {
      expect(useIslandStore.getState().view).toBe("cmd");
    });
  });

  it("closes and collapses on Esc with empty query", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("cmd://open")).toBeGreaterThan(0));

    act(() => {
      mockCmdOpen();
    });

    const input = await screen.findByRole("combobox");
    expect(input).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(useIslandStore.getState().mode).toBe("collapsed");
    });
  });
});
