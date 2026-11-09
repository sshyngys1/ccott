import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import * as ipc from "../ipc";
import {
  mockCopy,
  mockEmit,
  mockListenerCount,
  mockSetBattery,
  mockSetMedia,
  resetMock,
} from "../ipc/mock";
import { resetAudioStore } from "../lib/audio/store";
import { visualizerManager } from "../lib/audio/visualizerStore";
import { runCapture } from "../lib/capture/store";
import { evaluateCommands } from "../lib/cmd/commands";
import { resetDockStore, useDockStore } from "../lib/dock/store";
import { resetDownloadsStore } from "../lib/downloads/store";
import { EMPTY_MEDIA } from "../lib/media/progress";
import { resetMediaStore, useMediaStore } from "../lib/media/store";
import { resetNotesStore, useNotesStore } from "../lib/notes/store";
import { useTextStore } from "../lib/text/store";
import { useTilesEditStore } from "../lib/tiles/store";
import { resetTimerStore, useTimerStore } from "../lib/timer/store";
import { resetShelfStore, useShelfStore } from "../modules/shelf/store";
import { TextTab } from "../modules/text/TextTab";
import { requestShell } from "../shared/shellBus";
import type { FeatureId, TileSlot } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { backgroundScreens } from "./preloadScreens";

beforeAll(async () => {
  await Promise.all(backgroundScreens.map((s) => s.preload()));
});

function setDisabled(disabledFeatures: FeatureId[]) {
  act(() => {
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      disabledFeatures,
    });
  });
}

beforeEach(() => {
  resetMock();
  visualizerManager.resetForTests();
  resetAudioStore();
  resetDockStore();
  resetDownloadsStore();
  resetMediaStore();
  resetShelfStore();
  resetTimerStore();
  resetIslandStore();
  resetNotesStore();
  useTextStore.setState({ text: "", prefilled: false, error: null, last: null, history: [], selection: null });
});

afterEach(() => {
  cleanup();
  visualizerManager.resetForTests();
  resetAudioStore();
  resetDockStore();
  resetDownloadsStore();
  resetMediaStore();
  resetShelfStore();
  resetTimerStore();
  resetIslandStore();
  resetNotesStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Disableable features (§23) — UI & background teardown + live restore", () => {
  it("clipboard: hides tab, removes clipboard://added listener & toast, hides command & quickTile, skips TextTab prefill, and restores on re-enable", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);
    const initialTiles: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "clipboard", size: "1x1" },
    ];
    await ipc.invoke("settings_set", { patch: { quickTiles: initialTiles } });

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("clipboard://added")).toBe(1));
    await waitFor(() => expect(useIslandStore.getState().settings.quickTiles).toEqual(initialTiles));

    // Disable clipboard
    setDisabled(["clipboard"]);
    await waitFor(() => expect(mockListenerCount("clipboard://added")).toBe(0));

    // Toast «Скопировано» is not shown on external copy
    act(() => {
      mockCopy({ kind: "text", text: "secret token", preview: "secret token", sourceApp: "code.exe" });
    });
    expect(useIslandStore.getState().toast).toBeNull();

    // Command bar does not return clipboard command
    expect(evaluateCommands("буфер")).toEqual([]);
    expect(evaluateCommands("clipboard")).toEqual([]);

    // Expand: Clipboard tab and Clipboard quick tile are hidden, while quickTiles setting is preserved
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(await screen.findByRole("tab", { name: "Главная" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Буфер" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Буфер обмена" })).toBeNull();
    expect(useIslandStore.getState().settings.quickTiles).toEqual(initialTiles);

    // TextTab does not invoke clipboard_list while clipboard is disabled
    const invokeSpy = vi.spyOn(ipc, "invoke");
    const textView = render(<TextTab />);
    expect(invokeSpy).not.toHaveBeenCalledWith("clipboard_list", expect.anything());
    textView.unmount();

    // Re-enable clipboard -> tab, tile, command, and listener all return without restart
    setDisabled([]);
    await waitFor(() => expect(mockListenerCount("clipboard://added")).toBe(1));
    expect(await screen.findByRole("tab", { name: "Буфер" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Буфер обмена" })).toBeInTheDocument();
    expect(evaluateCommands("clipboard")).toHaveLength(1);

    act(() => useIslandStore.getState().setMode("collapsed"));
    act(() => {
      mockCopy({ kind: "text", text: "restored", preview: "restored", sourceApp: "code.exe" });
    });
    expect(useIslandStore.getState().toast?.label).toBe(t("copied"));
  });

  it("text: hides tab, blocks openTab('text') from activating hidden tab, keeps OCR copying to clipboard with toast, and restores on re-enable", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
    act(() => {
      useIslandStore.getState().setMode("expanded");
      useIslandStore.getState().setActiveTab("text");
    });
    expect(await screen.findByRole("heading", { name: t("text") })).toBeInTheDocument();

    // Disable text -> switches active tab to Home and unmounts TextTab
    setDisabled(["text"]);
    await waitFor(() => expect(useIslandStore.getState().activeTab).toBe("home"));
    expect(screen.queryByRole("tab", { name: t("text") })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("heading", { name: t("text") })).toBeNull());

    // Shell bus openTab("text") does not activate hidden tab
    act(() => {
      void requestShell({ type: "openTab", tab: "text" });
    });
    expect(useIslandStore.getState().activeTab).toBe("home");

    // OCR action copies recognized text and shows toast without navigating to hidden Text tab
    await act(async () => {
      await runCapture("region", "ocr");
    });
    expect(useIslandStore.getState().activeTab).toBe("home");
    expect(useIslandStore.getState().toast?.label).toBe(t("capture.textCopied"));

    // Re-enable text -> tab returns when expanded
    setDisabled([]);
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(await screen.findByRole("tab", { name: t("text") })).toBeInTheDocument();
  });

  it("notes: stops timer wake & notes retry/pagehide work with 0 calls over 30s fake time, hides tab & tiles, and resumes both on re-enable", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);
    const savedTiles: TileSlot[] = [
      { id: "region", size: "1x1" },
      { id: "screen", size: "1x1" },
      { id: "note", size: "1x1" },
      { id: "timer", size: "1x1" },
    ];
    await ipc.invoke("settings_set", { patch: { quickTiles: savedTiles } });
    await useNotesStore.getState().load();

    render(<Island />);
    await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
    await waitFor(() => expect(useIslandStore.getState().settings.quickTiles).toEqual(savedTiles));

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const realInvoke = ipc.invoke;
    let failSave = true;
    const invokeSpy = vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) => {
      if (cmd === "notes_save" && failSave) return Promise.reject(new Error("disk"));
      return realInvoke(cmd as never, args);
    }) as never);
    const countSaves = () => invokeSpy.mock.calls.filter(([cmd]) => cmd === "notes_save").length;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    act(() => {
      useTimerStore.getState().startDuration(60_000);
      useNotesStore.getState().edit("<p>черновик после ошибки</p>");
    });
    await act(async () => {
      await useNotesStore.getState().flush();
    });
    expect(countSaves()).toBe(1);
    expect(useNotesStore.getState().save.state).toBe("error");
    expect(screen.getByRole("button", { name: /Открыть таймер/ })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    const nowAtDisable = useTimerStore.getState().now;
    const noteId = useNotesStore.getState().selected as number;

    // Disable notes -> TimerPill unmounts, both timer wake and notes retry timeouts are cleared
    setDisabled(["notes"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(evaluateCommands("таймер 5 мин")).toEqual([]);
    expect(evaluateCommands("заметка")).toEqual([]);

    // Advance 30s of fake time + fire pagehide: zero timers, timer.now unchanged, zero new notes_save calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(useTimerStore.getState().now).toBe(nowAtDisable);
    expect(countSaves()).toBe(1);
    expect(useNotesStore.getState().bodyOf(noteId)).toBe("<p>черновик после ошибки</p>");

    // Re-enable notes under fake timers -> timer recalculates now (+30s) & re-arms timeout, notes_save resumes and succeeds
    failSave = false;
    setDisabled([]);
    expect(useTimerStore.getState().now).toBe(nowAtDisable + 30_000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(countSaves()).toBe(2);
    expect(useNotesStore.getState().save.state).toBe("saved");
    expect(useNotesStore.getState().notes.find((n) => n.id === noteId)?.body).toBe(
      "<p>черновик после ошибки</p>",
    );

    // Disable again to check expanded UI & quickTiles preservation under real timers
    setDisabled(["notes"]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Открыть таймер/ })).toBeNull());

    // Expand and verify note/timer quick tiles are hidden on Home, and editing another tile does NOT delete them from quickTiles
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(await screen.findByRole("button", { name: t("region") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("newNote") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("timer") })).toBeNull();

    act(() => useTilesEditStore.getState().setEditing(true));
    fireEvent.click(
      screen.getByRole("button", { name: t("tiles.removeNamed", { name: t("fullScreen") }) }),
    );
    await waitFor(() =>
      expect(useIslandStore.getState().settings.quickTiles.map((s) => s.id)).toEqual([
        "region",
        "note",
        "timer",
      ]),
    );
    act(() => useTilesEditStore.getState().setEditing(false));

    // Re-enable notes -> note & timer tiles return on Home, and TimerPill resumes in collapsed pill
    setDisabled([]);
    expect(await screen.findByRole("button", { name: t("newNote") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("timer") })).toBeInTheDocument();
    act(() => useIslandStore.getState().setMode("collapsed"));
    expect(await screen.findByRole("button", { name: /Открыть таймер/ })).toBeInTheDocument();
  });

  it("shelf: hides tab & pill badge, clears active pill drag-enter on disable so island expands normally with dock on, rejects drop with toast, and restores on re-enable", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);

    render(<Island />);
    const island = screen.getByRole("region", { name: "Dynamic Island" });
    expect(await screen.findByRole("button", { name: t("shelf.count", { count: 4 }) })).toBeInTheDocument();
    expect(mockListenerCount("shelf://changed")).toBe(1);

    const invokeSpy = vi.spyOn(ipc, "invoke");

    // Drag-enter on collapsed pill while shelf is enabled (dock off) -> pill captures dropTarget="pill" and highlights
    setDisabled(["dock"]);
    act(() => {
      window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "enter" } }));
    });
    expect(useShelfStore.getState().dropTarget).toBe("pill");
    expect(useDockStore.getState().dragging).toBe(true);
    expect(island).toHaveAttribute("data-shelf-drop", "true");

    // Disable shelf as well -> dropTarget, dragging, and pill highlight clear immediately
    setDisabled(["shelf", "dock"]);
    await waitFor(() => expect(mockListenerCount("shelf://changed")).toBe(0));
    expect(useShelfStore.getState().dropTarget).toBeNull();
    expect(useDockStore.getState().dragging).toBe(false);
    expect(island).toHaveAttribute("data-shelf-drop", "false");
    expect(screen.queryByRole("button", { name: t("shelf.count", { count: 4 }) })).toBeNull();

    // Re-enable dock while shelf stays disabled -> island expands normally and dock stays functional
    setDisabled(["shelf"]);
    act(() => mockEmit("island://hover", { inside: true }));
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"));
    expect(await screen.findByRole("region", { name: t("dock.title") })).toBeInTheDocument();

    // Collapse again to verify drag-enter / drop behavior while shelf is off and dock is on
    act(() => {
      mockEmit("island://hover", { inside: false });
      useIslandStore.getState().setMode("collapsed");
    });
    expect(useIslandStore.getState().mode).toBe("collapsed");

    // Drag enter on collapsed pill does NOT show shelf drop state
    act(() => {
      window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "enter" } }));
    });
    expect(useShelfStore.getState().dropTarget).toBeNull();

    // Dropping a file on collapsed pill does NOT add to shelf, and shows a toast pointing to the dock
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\Important.pdf"] },
        }),
      );
    });
    expect(invokeSpy).not.toHaveBeenCalledWith("shelf_add", expect.anything());
    expect(useIslandStore.getState().toast?.label).toBe(t("shelf.disabledToast"));

    // Disable dock as well -> file drop listener is completely unsubscribed
    act(() => useIslandStore.getState().setToast(null));
    const removeSpy = vi.spyOn(window, "removeEventListener");
    setDisabled(["shelf", "dock"]);
    expect(removeSpy).toHaveBeenCalledWith("ccott:dock-drop", expect.any(Function));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\Ignored.pdf"] },
        }),
      );
    });
    expect(useIslandStore.getState().toast).toBeNull();

    // Re-enable shelf -> badge and shelf://changed listener return
    setDisabled([]);
    await waitFor(() => expect(mockListenerCount("shelf://changed")).toBe(1));
    expect(await screen.findByRole("button", { name: t("shelf.count", { count: 4 }) })).toBeInTheDocument();
  });

  it("dock: hides Dock on Home, clears active dock dragging on disable, unsubscribes dock://changed, ignores dock zone drops, and restores on re-enable", async () => {
    render(<Island />);
    await waitFor(() => expect(mockListenerCount("island://hover")).toBeGreaterThan(0));
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(await screen.findByRole("region", { name: t("dock.title") })).toBeInTheDocument();
    await waitFor(() => expect(mockListenerCount("dock://changed")).toBe(1));

    const invokeSpy = vi.spyOn(ipc, "invoke");

    // Drag enter on expanded Home (dock zone) sets dock dragging
    act(() => {
      window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "enter" } }));
    });
    expect(useDockStore.getState().dragging).toBe(true);

    // Disable dock -> resets dragging, unmounts Dock, unsubscribes dock://changed while keeping shelf drop listener
    setDisabled(["dock"]);
    expect(useDockStore.getState().dragging).toBe(false);
    await waitFor(() => expect(mockListenerCount("dock://changed")).toBe(0));
    expect(screen.queryByRole("region", { name: t("dock.title") })).toBeNull();

    // Drop on expanded Home is not accepted into dock
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ccott:dock-drop", {
          detail: { type: "drop", paths: ["C:\\App.lnk"] },
        }),
      );
    });
    expect(invokeSpy).not.toHaveBeenCalledWith("dock_add", expect.anything());

    // Re-enable dock -> Dock and listener return
    setDisabled([]);
    expect(await screen.findByRole("region", { name: t("dock.title") })).toBeInTheDocument();
    await waitFor(() => expect(mockListenerCount("dock://changed")).toBe(1));
  });

  it("battery: hides pill & head indicators, unsubscribes system://battery, and restores on re-enable", async () => {
    mockSetMedia({ hasSession: false, status: "stopped" });
    useMediaStore.getState().applyState(EMPTY_MEDIA);
    mockSetBattery({
      hasBattery: true,
      percent: 82,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: 7200,
    });

    const { container } = render(<Island />);
    await waitFor(() => expect(mockListenerCount("system://battery")).toBe(1));
    await waitFor(() => expect(container.querySelector(".ig-pill-battery")).not.toBeNull());

    // Disable battery in collapsed mode
    setDisabled(["battery"]);
    await waitFor(() => expect(mockListenerCount("system://battery")).toBe(0));
    expect(container.querySelector(".ig-pill-battery")).toBeNull();

    // Expand -> head battery indicator is also absent and listener stays 0
    act(() => useIslandStore.getState().setMode("expanded"));
    expect(await screen.findByRole("tab", { name: "Главная" })).toBeInTheDocument();
    expect(container.querySelector(".ig-head-battery")).toBeNull();
    expect(mockListenerCount("system://battery")).toBe(0);

    // Re-enable battery -> indicator and subscription return
    setDisabled([]);
    await waitFor(() => expect(mockListenerCount("system://battery")).toBe(1));
    await waitFor(() => expect(container.querySelector(".ig-head-battery")).not.toBeNull());
  });

  it("audioMeter: hides equalizer in MediaPill, stops audio://spectrum & WASAPI capture consumer, and restores on re-enable", async () => {
    // Default mock has a playing track -> MediaPill with Eq mounts in collapsed pill
    const { container } = render(<Island />);
    expect(await screen.findByRole("button", { name: /Открыть плеер/ })).toBeInTheDocument();
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    expect(visualizerManager.getActiveConsumers()).toBe(1);
    expect(container.querySelector(".ig-eq")).not.toBeNull();

    const invokeSpy = vi.spyOn(ipc, "invoke");

    // Disable audioMeter -> Eq unmounts, WASAPI capture stops, spectrum listener drops to 0
    // (audio://changed remains retained by Island's headset activity watcher)
    setDisabled(["audioMeter"]);
    await visualizerManager.settled();
    expect(container.querySelector(".ig-eq")).toBeNull();
    expect(visualizerManager.getActiveConsumers()).toBe(0);
    expect(mockListenerCount("audio://spectrum")).toBe(0);
    expect(mockListenerCount("audio://changed")).toBe(1);
    expect(invokeSpy).toHaveBeenCalledWith("audio_visualizer_set_enabled", { enabled: false });

    // Re-enable audioMeter -> Eq and spectrum consumer return immediately
    setDisabled([]);
    await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
    await visualizerManager.settled();
    expect(visualizerManager.getActiveConsumers()).toBe(1);
    expect(container.querySelector(".ig-eq")).not.toBeNull();
  });
});
