// Wave 2 behaviour of the shell: keyboard focus, shell bus, settings view, DND, live activities in the pill.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "zustand";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../ipc";
import { mockConfig, mockCopy, mockEmit, mockListenerCount, mockLoseKeyboardFocus, mockOpenSettings, mockStats, mockSummon, resetMock } from "../ipc/mock";
import { requestShell } from "../shared/shellBus";
import type { IslandModule, ModuleId } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";

const Icon = () => null;

// ── Test modules (module-level, so the list is stable like the real registry) ──

function FieldsTab() {
  return (
    <div>
      <input aria-label="Поиск" />
      <input aria-label="Свой Escape" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      <button type="button">Кнопка</button>
    </div>
  );
}
const fieldsModule: IslandModule = { id: "text", title: "Поля", icon: Icon, Tab: FieldsTab, order: 0 };
const otherModule: IslandModule = { id: "notes", title: "Другая", icon: Icon, Tab: () => <p>Другая вкладка</p>, order: 1 };
const FIELD_MODULES: readonly IslandModule[] = [fieldsModule, otherModule];

const useFlags = create<{ media: boolean; timer: boolean }>(() => ({ media: false, timer: false }));
function activityModule(id: ModuleId, order: number, priority: number, flag: "media" | "timer", label: string): IslandModule {
  return {
    id,
    title: id,
    icon: Icon,
    Tab: () => <p>{`Вкладка ${id}`}</p>,
    order,
    compact: {
      useIsActive: () => useFlags((s) => s[flag]),
      priority,
      View: () => (
        <button type="button" onClick={() => requestShell({ type: "openTab", tab: id })}>
          {label}
        </button>
      ),
    },
  };
}
const ACTIVITY_MODULES: readonly IslandModule[] = [
  activityModule("home", 0, 10, "media", "Играет трек"),
  activityModule("notes", 1, 20, "timer", "Таймер 4:12"),
];

async function mountIsland(modules?: readonly IslandModule[]) {
  const utils = render(<Island modules={modules} />);
  await waitFor(() => {
    for (const ev of ["island://hover", "island://focus-changed", "island://open-settings", "settings://changed", "clipboard://added"] as const) {
      expect(mockListenerCount(ev)).toBeGreaterThan(0);
    }
  });
  return utils;
}

const expandAndShow = async (tab?: ModuleId) => {
  if (tab) useIslandStore.getState().setActiveTab(tab);
  act(() => mockEmit("island://hover", { inside: true }));
  await screen.findByRole("tablist");
};

beforeEach(() => {
  resetMock();
  resetIslandStore();
  useFlags.setState({ media: false, timer: false });
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  resetIslandStore();
});

describe("keyboard focus", () => {
  it("focusin on a field in the expanded panel calls island_set_keyboard_focus(true) and re-focuses the field", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true]));
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    expect(useIslandStore.getState().keyboardFocus).toBe(true);
    expect(input).toHaveFocus();
  });

  it("a button does not take the keyboard", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByRole("button", { name: "Кнопка" }).focus());
    await new Promise((r) => setTimeout(r, 60));
    expect(mockStats.keyboardFocusCalls).toEqual([]);
  });

  it("does not collapse when the cursor leaves while a field holds the keyboard", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByLabelText("Поиск").focus());
    await waitFor(() => expect(useIslandStore.getState().keyboardFocus).toBe(true));
    act(() => mockEmit("island://hover", { inside: false }));
    await new Promise((r) => setTimeout(r, 700)); // default collapse delay is 350 ms
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("collapses by itself once the keyboard focus is lost (island://focus-changed { active: false })", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    act(() => mockEmit("island://hover", { inside: false }));
    act(() => mockLoseKeyboardFocus());
    expect(useIslandStore.getState().keyboardFocus).toBe(false);
    expect(input).not.toHaveFocus();
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("collapsed"), { timeout: 2000 });
    // Rust already took the focus away itself: the UI must not call it again.
    expect(mockStats.keyboardFocusCalls).toEqual([true]);
  });

  it("stays expanded after the focus is lost while the cursor is still over the island", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByLabelText("Поиск").focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    act(() => mockLoseKeyboardFocus());
    await new Promise((r) => setTimeout(r, 600));
    expect(useIslandStore.getState().mode).toBe("expanded");
  });

  it("Escape in a focused field releases the keyboard and collapses at once", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(useIslandStore.getState().keyboardFocus).toBe(false);
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true, false]));
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(false));
  });

  it("Escape that a module claimed with preventDefault does not collapse the island", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Свой Escape");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().keyboardFocus).toBe(true);
  });

  it("collapsing by any other cause (the «Свернуть» button) releases the keyboard", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true, false]));
    expect(input).not.toHaveFocus();
  });

  it("a refused request (rejected call) drops the flag", async () => {
    const { mockConfig } = await import("../ipc/mock");
    mockConfig.failKeyboardFocus = true;
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    const input = screen.getByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(useIslandStore.getState().keyboardFocus).toBe(false));
    expect(mockStats.keyboardFocus).toBe(false);
    expect(input).not.toHaveFocus();
  });

  it("unmounting the island releases the keyboard", async () => {
    const { unmount } = await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByLabelText("Поиск").focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    unmount();
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true, false]));
  });
});

describe("shell bus", () => {
  it("await requestShell(collapse) waits until native focus is released, including a duplicate collapse", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByLabelText("Поиск").focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    mockConfig.keyboardFocusDelayMs = 100;
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = requestShell({ type: "collapse" });
      second = requestShell({ type: "collapse" });
    });
    expect(useIslandStore.getState().mode).toBe("collapsed");
    expect(mockStats.keyboardFocus).toBe(true);
    let done = false;
    void second.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await act(async () => { await Promise.all([first, second]); });
    expect(mockStats.keyboardFocus).toBe(false);
    expect(mockStats.keyboardFocusCalls).toEqual([true, false]);
  });

  it("openTab expands the island at once and shows that tab", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => { void requestShell({ type: "openTab", tab: "notes" }); });
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().activeTab).toBe("notes");
    expect(await screen.findByText("Другая вкладка")).toBeInTheDocument();
  });

  it("openTab leaves the settings view; an unknown tab keeps the current one", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => {
      useIslandStore.getState().setView("settings");
      requestShell({ type: "openTab", tab: "weather" });
    });
    expect(useIslandStore.getState().view).toBe("tabs");
    expect(useIslandStore.getState().activeTab).toBe("home");
    expect(useIslandStore.getState().mode).toBe("expanded");
  });

  it("collapse collapses immediately (no delay) and releases the keyboard", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("text");
    act(() => screen.getByLabelText("Поиск").focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));
    act(() => mockEmit("island://hover", { inside: true })); // cursor over the island: a hover collapse would not happen
    act(() => { void requestShell({ type: "collapse" }); });
    expect(useIslandStore.getState().mode).toBe("collapsed");
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true, false]));
  });

  it("is unsubscribed on unmount", async () => {
    const { unmount } = await mountIsland(FIELD_MODULES);
    unmount();
    act(() => { void requestShell({ type: "openTab", tab: "notes" }); });
    expect(useIslandStore.getState().mode).toBe("collapsed");
  });
});

describe("settings view", () => {
  it("hover reopens on Home after collapse, while the tray can still open Settings", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("notes");
    expect(useIslandStore.getState().activeTab).toBe("notes");
    act(() => { void requestShell({ type: "collapse" }); });
    act(() => mockEmit("island://hover", { inside: true }));
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"));
    expect(useIslandStore.getState().activeTab).toBe("home");
    act(() => { void requestShell({ type: "collapse" }); });
    act(() => mockOpenSettings());
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().view).toBe("settings");
  });

  it("the gear opens the view inside the panel, the back button and a second click on the gear return", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow();
    const gear = screen.getByRole("button", { name: "Настройки" });
    expect(gear).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(gear);
    expect(await screen.findByRole("heading", { name: "Настройки" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Настройки" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Настройки" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(await screen.findByRole("tablist")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));
    await screen.findByRole("heading", { name: "Настройки" });
    fireEvent.click(screen.getByRole("button", { name: "Настройки", pressed: true }));
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });

  it("returns to the tab it came from", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow("notes");
    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));
    await screen.findByRole("heading", { name: "Настройки" });
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(await screen.findByText("Другая вкладка")).toBeInTheDocument();
  });

  it("Escape goes back from the settings view; the next Escape collapses", async () => {
    await mountIsland(FIELD_MODULES);
    await expandAndShow();
    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));
    const region = await screen.findByRole("region", { name: "Настройки" });
    fireEvent.keyDown(await within(region).findByRole("switch", { name: /Не беспокоить/ }), { key: "Escape" });
    expect(useIslandStore.getState().view).toBe("tabs");
    expect(useIslandStore.getState().mode).toBe("expanded");
    fireEvent.keyDown(await screen.findByRole("tablist"), { key: "Escape" });
    expect(useIslandStore.getState().mode).toBe("collapsed");
  });

  it("island://open-settings expands the island and opens the view", async () => {
    await mountIsland(FIELD_MODULES);
    expect(useIslandStore.getState().mode).toBe("collapsed");
    act(() => mockOpenSettings());
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(await screen.findByRole("heading", { name: "Настройки" })).toBeInTheDocument();
  });

  it("island://summoned expands when collapsed and collapses (releasing keyboard focus) when expanded", async () => {
    await mountIsland(FIELD_MODULES);
    await waitFor(() => expect(mockListenerCount("island://summoned")).toBeGreaterThan(0));
    expect(useIslandStore.getState().mode).toBe("collapsed");

    act(() => mockSummon());
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"));

    const input = await screen.findByLabelText("Поиск");
    act(() => input.focus());
    await waitFor(() => expect(mockStats.keyboardFocus).toBe(true));

    act(() => mockSummon());
    expect(useIslandStore.getState().mode).toBe("collapsed");
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true, false]));
  });

  it("clicking the summon-hotkey field requests native keyboard focus, and Escape while recording cancels without collapsing", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => mockOpenSettings());
    const hotkeyInput = await screen.findByLabelText("Вызов острова");

    fireEvent.click(hotkeyInput);
    expect(hotkeyInput).toHaveValue("Нажмите сочетание…");
    await waitFor(() => expect(mockStats.keyboardFocusCalls).toEqual([true]));

    // First Escape cancels recording while keeping Settings and the island open.
    fireEvent.keyDown(hotkeyInput, { key: "Escape" });
    expect(hotkeyInput).toHaveValue("Ctrl+Alt+I");
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().view).toBe("settings");
  });

  it("collapsing resets the view, so the next expand shows the tabs", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => mockOpenSettings());
    await screen.findByRole("heading", { name: "Настройки" });
    act(() => { void requestShell({ type: "collapse" }); });
    expect(useIslandStore.getState().view).toBe("tabs");
  });

  it("loads the saved settings: theme from settings://changed reaches <html data-theme>", async () => {
    await mountIsland(FIELD_MODULES);
    await invoke("settings_set", { patch: { theme: "light" } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    await invoke("settings_set", { patch: { theme: "dark" } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("hover delays from the settings reach the store", async () => {
    await mountIsland(FIELD_MODULES);
    await invoke("settings_set", { patch: { hoverExpandDelayMs: 0, hoverCollapseDelayMs: 50 } });
    await waitFor(() => expect(useIslandStore.getState().hoverCollapseDelayMs).toBe(50));
    expect(useIslandStore.getState().hoverExpandDelayMs).toBe(0);
    // And they are used: with a 0 ms delay the island expands on the next tick.
    act(() => mockEmit("island://hover", { inside: true }));
    await waitFor(() => expect(useIslandStore.getState().mode).toBe("expanded"), { timeout: 200 });
  });
});

describe("do not disturb", () => {
  it("suppresses the «Скопировано» toast and shows it again when switched off", async () => {
    await mountIsland(FIELD_MODULES);
    await invoke("settings_set", { patch: { doNotDisturb: true } });
    await waitFor(() => expect(useIslandStore.getState().doNotDisturb).toBe(true));
    act(() => {
      mockCopy({ kind: "text", text: "секрет" });
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText("Скопировано")).toBeNull();
    expect(useIslandStore.getState().toast).toBeNull();

    await invoke("settings_set", { patch: { doNotDisturb: false } });
    await waitFor(() => expect(useIslandStore.getState().doNotDisturb).toBe(false));
    act(() => {
      mockCopy({ kind: "text", text: "не секрет" });
    });
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
  });

  it("switching it on drops a toast that is already visible", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => {
      mockCopy({ kind: "text", text: "привет" });
    });
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
    await invoke("settings_set", { patch: { doNotDisturb: true } });
    await waitFor(() => expect(screen.queryByText("Скопировано")).toBeNull());
  });
});

describe("shell bus toast", () => {
  it("masks secret clipboard text before it reaches the pill and the toast store", async () => {
    await mountIsland(FIELD_MODULES);
    const secret = "MySecret123!";
    act(() => { mockCopy({ kind: "text", text: secret }); });
    expect(await screen.findByRole("status")).toHaveTextContent("Скопировано••••••");
    expect(screen.queryByText(secret)).toBeNull();
    expect(useIslandStore.getState().toast?.preview).toBe("••••••");
  });
  it("shows the text in the pill like «Скопировано» (status role, toast width) and hides it after the hold time", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => { void requestShell({ type: "toast", text: "Нет окна для вставки" }); });
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Нет окна для вставки");
    expect(toast).not.toHaveTextContent("Скопировано");
    await waitFor(() => expect(mockStats.lastShape?.width).toBe(312), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByText("Нет окна для вставки")).toBeNull(), { timeout: 4000 });
  }, 8000);

  it("a new toast replaces the current one and restarts the hold timer", async () => {
    await mountIsland(FIELD_MODULES);
    act(() => { void requestShell({ type: "toast", text: "Первое" }); });
    await screen.findByText("Первое");
    await new Promise((r) => setTimeout(r, 1000));
    act(() => { void requestShell({ type: "toast", text: "Второе" }); });
    await screen.findByText("Второе");
    await new Promise((r) => setTimeout(r, 1000)); // 2 s after the first: it would be gone, the second is not
    expect(screen.getByText("Второе")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Второе")).toBeNull(), { timeout: 3000 });
  }, 8000);

  it("is suppressed by doNotDisturb", async () => {
    await mountIsland(FIELD_MODULES);
    await invoke("settings_set", { patch: { doNotDisturb: true } });
    await waitFor(() => expect(useIslandStore.getState().doNotDisturb).toBe(true));
    act(() => { void requestShell({ type: "toast", text: "Тихо" }); });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText("Тихо")).toBeNull();
    expect(useIslandStore.getState().toast).toBeNull();
  });

  it("updater://available shows a one-time «Доступно обновление» toast in the pill", async () => {
    await mountIsland(FIELD_MODULES);
    await waitFor(() => expect(mockListenerCount("updater://available")).toBeGreaterThan(0));
    act(() => {
      mockEmit("updater://available", { version: "0.1.1", notes: "Новая сборка", date: "2026-10-27T12:00:00Z" });
    });
    expect(await screen.findByText("Доступно обновление")).toBeInTheDocument();
    expect(useIslandStore.getState().availableUpdate?.version).toBe("0.1.1");

    // Clear the toast and emit the same version again: toast must not reappear.
    act(() => useIslandStore.getState().setToast(null));
    act(() => {
      mockEmit("updater://available", { version: "0.1.1", notes: "Новая сборка", date: "2026-10-27T12:00:00Z" });
    });
    expect(useIslandStore.getState().toast).toBeNull();
  });
});

describe("live activities in the pill", () => {
  const widthIs = (w: number) => waitFor(() => expect(mockStats.lastShape?.width).toBe(w), { timeout: 2000 });

  it("clock when nothing is active; the activity (304 wide) when a module is active", async () => {
    await mountIsland(ACTIVITY_MODULES);
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    await widthIs(224);
    act(() => useFlags.setState({ media: true }));
    expect(await screen.findByText("Играет трек")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull()); // the clock fades out
    await widthIs(304);
    act(() => useFlags.setState({ media: false }));
    await waitFor(() => expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument());
    await widthIs(224);
  });

  it("the highest priority wins and the activity swaps when it changes; hooks keep working across swaps", async () => {
    await mountIsland(ACTIVITY_MODULES);
    act(() => useFlags.setState({ media: true }));
    await screen.findByText("Играет трек");
    act(() => useFlags.setState({ timer: true }));
    expect(await screen.findByText("Таймер 4:12")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Играет трек")).toBeNull());
    act(() => useFlags.setState({ timer: false }));
    expect(await screen.findByText("Играет трек")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Таймер 4:12")).toBeNull());
  });

  it("hover still expands the island over an activity", async () => {
    await mountIsland(ACTIVITY_MODULES);
    act(() => useFlags.setState({ media: true }));
    await screen.findByText("Играет трек");
    act(() => mockEmit("island://hover", { inside: true }));
    await screen.findByRole("tablist");
    expect(useIslandStore.getState().mode).toBe("expanded");
  });

  it("a click on the activity reaches the module's own handler, which opens its tab", async () => {
    await mountIsland(ACTIVITY_MODULES);
    act(() => useFlags.setState({ timer: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Таймер 4:12" }));
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().activeTab).toBe("notes");
    expect(await screen.findByText("Вкладка notes")).toBeInTheDocument();
  });

  it("the «Скопировано» toast takes precedence over the activity for a moment, then the activity returns", async () => {
    await mountIsland(ACTIVITY_MODULES);
    act(() => useFlags.setState({ media: true }));
    await screen.findByText("Играет трек");
    act(() => {
      mockCopy({ kind: "text", text: "abc" });
    });
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
    await widthIs(312);
    await waitFor(() => expect(screen.queryByText("Скопировано")).toBeNull(), { timeout: 4000 });
    expect(await screen.findByText("Играет трек")).toBeInTheDocument();
  }, 8000);
});
