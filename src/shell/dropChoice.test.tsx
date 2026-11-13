import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import * as ipc from "../ipc";
import { resetMock } from "../ipc/mock";
import { resetDockStore, useDockStore } from "../lib/dock/store";
import { resetDownloadsStore } from "../lib/downloads/store";
import { resetShelfStore, useShelfStore } from "../modules/shelf/store";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { resetDropChoice, useDropChoiceStore } from "./dropChoice/store";

beforeEach(async () => {
  resetMock();
  resetIslandStore();
  resetShelfStore();
  resetDockStore();
  resetDownloadsStore();
  resetDropChoice();
  setLanguage("ru");
});

afterEach(() => {
  cleanup();
  resetDropChoice();
  resetShelfStore();
  resetDockStore();
  resetDownloadsStore();
  setLanguage("auto");
  vi.restoreAllMocks();
});

function mockZoneRects() {
  const dockZone = document.querySelector("[data-drop-zone='dock']");
  const shelfZone = document.querySelector("[data-drop-zone='shelf']");
  if (dockZone) {
    vi.spyOn(dockZone, "getBoundingClientRect").mockReturnValue({
      left: 20,
      right: 340,
      top: 50,
      bottom: 350,
      x: 20,
      y: 50,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    });
  }
  if (shelfZone) {
    vi.spyOn(shelfZone, "getBoundingClientRect").mockReturnValue({
      left: 360,
      right: 680,
      top: 50,
      bottom: 350,
      x: 360,
      y: 50,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    });
  }
}

describe("Drop Choice (§22, v0.4)", () => {
  it.each(["ru", "en"] as const)("%s: enter on collapsed pill with both dock and shelf on -> expands into two drop zones", async (lang) => {
    setLanguage(lang);
    render(<Island modules={[]} />);
    expect(useIslandStore.getState().mode).toBe("collapsed");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Docs\\Report.pdf"] },
        }),
      );
    });

    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useDropChoiceStore.getState().active).toBe(true);
    expect(await screen.findByRole("region", { name: t("dropChoice.title") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("dropChoice.dock") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("dropChoice.shelf") })).toBeInTheDocument();
  });

  it("drop into «На полку» invokes shelf_add, collapses island and resets drop choice", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Temp\\File.txt", "C:\\Temp\\Image.png"] },
        }),
      );
    });

    mockZoneRects();

    // Hover over shelf zone
    const shelfPos = { x: 500 * window.devicePixelRatio, y: 150 * window.devicePixelRatio };
    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "over", position: shelfPos },
        }),
      );
    });

    expect(document.querySelector("[data-drop-zone='shelf']")).toHaveAttribute("data-active", "true");
    expect(document.querySelector("[data-drop-zone='dock']")).not.toHaveAttribute("data-active", "true");

    // Drop onto shelf zone
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: {
            type: "drop",
            paths: ["C:\\Temp\\File.txt", "C:\\Temp\\Image.png"],
            position: shelfPos,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith("shelf_add", {
        paths: ["C:\\Temp\\File.txt", "C:\\Temp\\Image.png"],
      });
    });

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useDropChoiceStore.getState().active).toBe(false);
  });

  it("drop without position after over above «На полку» preserves hoveredZone and calls shelf_add", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Temp\\File.txt"] },
        }),
      );
    });

    mockZoneRects();

    // Hover over shelf zone with position
    const shelfPos = { x: 500 * window.devicePixelRatio, y: 150 * window.devicePixelRatio };
    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "over", position: shelfPos },
        }),
      );
    });

    expect(useDropChoiceStore.getState().hoveredZone).toBe("shelf");

    // Drop WITHOUT position (position is undefined)
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: {
            type: "drop",
            paths: ["C:\\Temp\\File.txt"],
          },
        }),
      );
    });

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith("shelf_add", {
        paths: ["C:\\Temp\\File.txt"],
      });
    });

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useDropChoiceStore.getState().active).toBe(false);
  });

  it("drop into «В док» invokes dock_add, collapses island and resets drop choice", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Games\\Doom.exe"] },
        }),
      );
    });

    mockZoneRects();

    // Hover over dock zone
    const dockPos = { x: 100 * window.devicePixelRatio, y: 150 * window.devicePixelRatio };
    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "over", position: dockPos },
        }),
      );
    });

    expect(document.querySelector("[data-drop-zone='dock']")).toHaveAttribute("data-active", "true");
    expect(document.querySelector("[data-drop-zone='shelf']")).not.toHaveAttribute("data-active", "true");

    // Drop onto dock zone
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: {
            type: "drop",
            paths: ["C:\\Games\\Doom.exe"],
            position: dockPos,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith("dock_add", {
        paths: ["C:\\Games\\Doom.exe"],
      });
    });

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useDropChoiceStore.getState().active).toBe(false);
  });


  it("leave without drop collapses island and adds nothing", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\File.txt"] },
        }),
      );
    });

    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useDropChoiceStore.getState().active).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "leave" } }));
    });

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useDropChoiceStore.getState().active).toBe(false);
    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", expect.anything());
    expect(invokeSpy).not.toHaveBeenCalledWith("shelf_add", expect.anything());
  });

  it("Esc key during drop choice collapses island and adds nothing", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\File.txt"] },
        }),
      );
    });

    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useDropChoiceStore.getState().active).toBe(true);

    const island = screen.getByRole("region", { name: "Dynamic Island" });
    fireEvent.keyDown(island, { key: "Escape" });

    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useDropChoiceStore.getState().active).toBe(false);
    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", expect.anything());
    expect(invokeSpy).not.toHaveBeenCalledWith("shelf_add", expect.anything());
  });

  it("only shelf enabled (dock disabled) -> no choice, direct drop to shelf on collapsed pill", async () => {
    await ipc.invoke("settings_set", { patch: { disabledFeatures: ["dock"] } });
    useIslandStore.setState((s) => ({ settings: { ...s.settings, disabledFeatures: ["dock"] } }));
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\SoloShelf.txt"] },
        }),
      );
    });

    // Drop choice was NOT triggered, pill stays collapsed
    expect(useDropChoiceStore.getState().active).toBe(false);
    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useShelfStore.getState().dropTarget).toBe("pill");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\SoloShelf.txt"] },
        }),
      );
    });

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith("shelf_add", { paths: ["C:\\SoloShelf.txt"] });
    });
    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", expect.anything());
  });

  it("only dock enabled (shelf disabled) -> no choice, drop on collapsed pill shows shelf.disabledToast", async () => {
    await ipc.invoke("settings_set", { patch: { disabledFeatures: ["shelf"] } });
    useIslandStore.setState((s) => ({ settings: { ...s.settings, disabledFeatures: ["shelf"] } }));
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\SoloDock.exe"] },
        }),
      );
    });

    expect(useDropChoiceStore.getState().active).toBe(false);
    expect(useIslandStore.getState().mode).toBe("collapsed");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\SoloDock.exe"] },
        }),
      );
    });

    expect(invokeSpy).not.toHaveBeenCalledWith("shelf_add", expect.anything());
    expect(useIslandStore.getState().toast?.label).toBe(t("shelf.disabledToast"));
  });

  it("unsuitable file for dock (dock full) -> dock zone is inactive with hint, drop rejected", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    // Fill dock to maximum 12 items
    await ipc.invoke("dock_add", {
      paths: Array.from({ length: 7 }, (_, i) => `C:\\Fill${i}.lnk`),
    });
    const dockList = await ipc.invoke("dock_list");
    expect(dockList.length).toBe(12);
    useDockStore.setState({ items: dockList });

    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Overflow.exe"] },
        }),
      );
    });

    mockZoneRects();

    const dockZone = document.querySelector("[data-drop-zone='dock']");
    expect(dockZone).toHaveAttribute("data-disabled", "true");
    expect(dockZone).toHaveAttribute("aria-disabled", "true");
    expect(dockZone).toHaveTextContent(t("dropChoice.dockFull"));

    // Try dropping into the full dock
    const dockPos = { x: 100 * window.devicePixelRatio, y: 150 * window.devicePixelRatio };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\Overflow.exe"], position: dockPos },
        }),
      );
    });

    // dock_add was NOT called for Overflow.exe
    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", { paths: ["C:\\Overflow.exe"] });
  });

  it("fresh start with 12 dock items in backend, island never expanded -> «В док» zone is inactive with dockFull reason", async () => {
    // Fill dock in IPC mock to 12 items
    await ipc.invoke("dock_add", {
      paths: Array.from({ length: 7 }, (_, i) => `C:\\Fill${i}.lnk`),
    });
    const dockList = await ipc.invoke("dock_list");
    expect(dockList.length).toBe(12);

    // Fresh start simulation: dock store is reset and has 0 items in memory, island is collapsed
    resetDockStore();
    expect(useDockStore.getState().items).toHaveLength(0);

    render(<Island modules={[]} />);
    expect(useIslandStore.getState().mode).toBe("collapsed");

    // Drag enters collapsed pill -> drop choice starts
    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\Fresh.txt"] },
        }),
      );
    });

    // DropChoiceView retains dock and loads the 12 items
    const dockZone = await screen.findByRole("region", { name: t("dropChoice.dock") });
    await waitFor(() => {
      expect(dockZone).toHaveAttribute("data-disabled", "true");
      expect(dockZone).toHaveAttribute("aria-disabled", "true");
      expect(dockZone).toHaveTextContent(t("dropChoice.dockFull"));
    });
  });

  it("unsuitable file for dock (web URL) -> dock zone is inactive with hint", async () => {
    const invokeSpy = vi.spyOn(ipc, "invoke");
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["https://example.com/not-a-file"] },
        }),
      );
    });

    mockZoneRects();

    const dockZone = document.querySelector("[data-drop-zone='dock']");
    expect(dockZone).toHaveAttribute("data-disabled", "true");
    expect(dockZone).toHaveAttribute("aria-disabled", "true");
    expect(dockZone).toHaveTextContent(t("dropChoice.dockIncompatible"));

    const dockPos = { x: 100 * window.devicePixelRatio, y: 150 * window.devicePixelRatio };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["https://example.com/not-a-file"], position: dockPos },
        }),
      );
    });

    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", expect.anything());
  });

  it("on already expanded island, drop choice does not trigger (previous behavior preserved)", async () => {
    useIslandStore.setState({ mode: "expanded", activeTab: "home", view: "tabs" });
    render(<Island modules={[]} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "enter", paths: ["C:\\App.lnk"] },
        }),
      );
    });

    // Drop choice should NOT be active
    expect(useDropChoiceStore.getState().active).toBe(false);
    expect(screen.queryByRole("region", { name: t("dropChoice.title") })).toBeNull();
  });
});
