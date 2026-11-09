import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionConfig } from "motion/react";
import * as ipc from "../../ipc";
import { mockCopy, mockListenerCount, resetMock } from "../../ipc/mock";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import { resetIslandStore, useIslandStore } from "../../store";
import { ClipboardTab } from "./ClipboardTab";

let requests: ShellRequest[] = [];
let off: () => void;

beforeEach(() => {
  resetMock();
  resetIslandStore();
  useIslandStore.setState({ mode: "expanded", activeTab: "clipboard", view: "tabs" });
  requests = [];
  off = onShellRequest((r) => { requests.push(r); });
});
afterEach(() => {
  off();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// These tests assert clipboard behavior; exit animation duration must not retain obsolete rows under load.
async function mountTab(skipAnimations = true) {
  render(<MotionConfig skipAnimations={skipAnimations}><ClipboardTab /></MotionConfig>);
  await screen.findByText("npm run tauri dev");
  await waitFor(() => expect(mockListenerCount("clipboard://changed")).toBe(1));
}

const rows = () => screen.getAllByRole("option");
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

describe("Clipboard tab: list", () => {
  it("shows pinned clips first under «Закреплённые», then «Недавние»", async () => {
    await mountTab();
    expect(screen.getByRole("heading", { name: "Закреплённые" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Недавние" })).toBeInTheDocument();
    const pinned = screen.getByRole("listbox", { name: "Закреплённые" });
    expect(within(pinned).getAllByRole("option")).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent("github.com/tauri-apps/tauri");
  });

  it("renders rows per kind with meta (app · time, files count, image thumb)", async () => {
    await mountTab();
    expect(rowOf("Созвон с командой в 15:30, ссылка в календаре")).toHaveTextContent("Telegram · 2 мин назад");
    expect(rowOf("Отчёт.pdf, Смета.xlsx")).toHaveTextContent("2 файла · Проводник · 2 ч назад");
    const image = screen.getByText("Снимок экрана").closest("li") as HTMLElement;
    expect(image.querySelector("img.ig-thumb")).not.toBeNull();
    expect(within(image).getByRole("option")).toHaveClass("ig-list-row--media");
    expect(within(image).getByAltText("Изображение из буфера")).toBeInTheDocument();
    expect(rowOf("https://github.com/tauri-apps/tauri").querySelector('[data-kind="link"]')).not.toBeNull();
  });

  it("the keyboard cursor starts on the first row and follows ↑/↓", async () => {
    await mountTab();
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
    expect(rows()[0]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("a new copy appears without a manual refresh (clipboard://changed)", async () => {
    await mountTab();
    act(() => {
      mockCopy({ kind: "text", text: "совершенно новая запись", sourceApp: "Notepad.exe" });
    });
    expect(await screen.findByText("совершенно новая запись")).toBeInTheDocument();
  });
});

describe("Clipboard tab: search", () => {
  it("filters with a debounce and shows the empty-search state, then resets", async () => {
    await mountTab();
    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.change(input, { target: { value: "н" } });
    fireEvent.change(input, { target: { value: "нет такого" } });
    expect(await screen.findByText("Ничего не найдено")).toBeInTheDocument();
    const searches = spy.mock.calls.filter((c) => c[0] === "clipboard_list").map((c) => (c[1] as { query: string }).query);
    expect(searches).toEqual(["нет такого"]); // typing fast sent a single request
    fireEvent.click(screen.getByRole("button", { name: "Сбросить поиск" }));
    expect(await screen.findByText("npm run tauri dev")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("finds by text", async () => {
    await mountTab(true);
    // Leave performance.now / rAF real: Motion's shared frame clock survives between tests.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск в истории буфера" }), { target: { value: "hello@" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(spy).toHaveBeenCalledWith("clipboard_list", { query: "hello@", limit: 100 });
    // Exit rows belong to Motion's frame queue; flush it after the filtered data renders.
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    vi.useRealTimers();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("hello@example.com");
  });

  it("Escape clears a non-empty query and is default-prevented (the shell would collapse otherwise)", async () => {
    await mountTab();
    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    fireEvent.change(input, { target: { value: "abc" } });
    const first = fireEvent.keyDown(input, { key: "Escape" }); // false = default prevented
    expect(first).toBe(false);
    expect(input).toHaveValue("");
    const second = fireEvent.keyDown(input, { key: "Escape" });
    expect(second).toBe(true); // empty search: Esc goes on to the shell
  });

  it("Ctrl+F focuses the search", async () => {
    await mountTab();
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "Поиск в истории буфера" })).toHaveFocus();
  });
});

describe("Clipboard tab: paste / copy", () => {
  it.each(["unmount", "collapse", "tab", "whatsNew", "cmd", "away and back"])("cancels pending paste on %s before 160ms", async (action) => {
    await mountTab();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"));
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    act(() => {
      const state = useIslandStore.getState();
      if (action === "unmount") cleanup();
      else if (action === "collapse") state.setMode("collapsed");
      else if (action === "tab") state.setActiveTab("home");
      else if (action === "away and back") {
        state.setActiveTab("home");
        state.setActiveTab("clipboard");
      } else state.setView(action as "whatsNew" | "cmd");
    });
    // Navigation cases deliberately keep ClipboardTab mounted, as AnimatePresence does during exit.
    if (action !== "unmount") expect(screen.getByText("npm run tauri dev")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(requests).toEqual([]);
    expect(spy).not.toHaveBeenCalledWith("clipboard_paste", expect.anything());
  });

  it("restarts the 160ms delay and pastes only the latest activated record", async () => {
    await mountTab();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"));
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    fireEvent.click(rows()[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(159); });
    expect(requests).toEqual([]);
    expect(spy).not.toHaveBeenCalledWith("clipboard_paste", expect.anything());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(requests).toEqual([{ type: "collapse" }]);
    expect(spy.mock.calls.filter(([cmd]) => cmd === "clipboard_paste")).toEqual([["clipboard_paste", { id: 1, mode: "paste" }]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "clipboard_paste")).toHaveLength(1);
  });

  it("a new copy activation cancels an earlier pending paste", async () => {
    await mountTab();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"));
    fireEvent.click(rows()[0], { shiftKey: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(requests).toEqual([{ type: "toast", text: "Скопировано" }]);
    expect(spy.mock.calls.filter(([cmd]) => cmd === "clipboard_paste")).toEqual([["clipboard_paste", { id: 1, mode: "copy" }]]);
  });

  it("highlights the chosen row for 160ms before requesting collapse and paste", async () => {
    await mountTab();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const spy = vi.spyOn(ipc, "invoke");
    const row = rowOf("npm run tauri dev");
    fireEvent.click(within(row).getByRole("option"));
    expect(row.querySelector(".cb-paste-flash")).toBeInTheDocument();
    expect(requests).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(159); });
    expect(requests).toEqual([]);
    expect(spy).not.toHaveBeenCalledWith("clipboard_paste", expect.anything());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(requests).toEqual([{ type: "collapse" }]);
    expect(spy).toHaveBeenCalledWith("clipboard_paste", expect.objectContaining({ mode: "paste" }));
  });

  it("click collapses the island first, then pastes", async () => {
    await mountTab();
    const order: string[] = [];
    off();
    let released!: () => void;
    off = onShellRequest((r) => {
      order.push(`shell:${r.type}`);
      useIslandStore.getState().setMode("collapsed");
      cleanup();
      return new Promise<void>((resolve) => { released = resolve; });
    });
    const spy = vi.spyOn(ipc, "invoke").mockImplementation((async (cmd: string) => {
      order.push(`invoke:${cmd}`);
    }) as never);
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"));
    await waitFor(() => expect(order).toEqual(["shell:collapse"]));
    expect(spy).not.toHaveBeenCalled();
    await act(async () => { released(); });
    expect(order).toEqual(["shell:collapse", "invoke:clipboard_paste"]);
    const call = spy.mock.calls.find((c) => c[0] === "clipboard_paste");
    expect(call?.[1]).toMatchObject({ mode: "paste" });
  });

  it("Enter pastes the item under the cursor", async () => {
    await mountTab();
    const spy = vi.spyOn(ipc, "invoke");
    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(requests).toEqual([{ type: "collapse" }]));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("clipboard_paste", { id: 8, mode: "paste" }));
  });

  it("Shift+click only copies: no collapse, a pill toast", async () => {
    await mountTab();
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"), { shiftKey: true });
    expect(spy).toHaveBeenCalledWith("clipboard_paste", { id: 3, mode: "copy" });
    await waitFor(() => expect(requests).toEqual([{ type: "toast", text: "Скопировано" }]));
  });

  it("Shift+Enter copies as well", async () => {
    await mountTab();
    const spy = vi.spyOn(ipc, "invoke");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Поиск в истории буфера" }), { key: "Enter", shiftKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("clipboard_paste", expect.objectContaining({ mode: "copy" })));
    await waitFor(() => expect(requests).toEqual([{ type: "toast", text: "Скопировано" }]));
  });

  it.each([["no window to paste into", "Нет окна для вставки"], ["cannot send keys to the target window", "Не удалось вставить"]])("a failed paste reports a pill toast after the panel unmounts: %s", async (error, message) => {
    await mountTab();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = ipc.invoke;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) =>
      cmd === "clipboard_paste" ? Promise.reject(new Error(error)) : real(cmd as never, args)) as never);
    off();
    off = onShellRequest((r) => {
      requests.push(r);
      if (r.type === "collapse") {
        useIslandStore.getState().setMode("collapsed");
        cleanup();
      }
    });
    fireEvent.click(within(rowOf("npm run tauri dev")).getByRole("option"));
    await waitFor(() => expect(requests).toEqual([{ type: "collapse" }, { type: "toast", text: message }]));
  });
});

describe("Clipboard tab: pin / delete / clear", () => {
  it("option contents have no nested interactive controls; actions remain available outside", async () => {
    await mountTab();
    for (const option of rows()) expect(option.querySelector('button, input, select, a[href]')).toBeNull();
    expect(within(rowOf("npm run tauri dev")).getByRole("button", { name: "Закрепить" })).toBeInTheDocument();
    act(() => rows()[0].focus());
    fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
    expect(rows()[1]).toHaveFocus();
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("Delete ignores pinned rows and toasts after deleting an unpinned row", async () => {
    await mountTab();
    const spy = vi.spyOn(ipc, "invoke");
    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(spy.mock.calls.filter((c) => c[0] === "clipboard_delete")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const id = (screen.getByRole("option", { selected: true }).id).replace("cb-row-", "");
    fireEvent.keyDown(input, { key: "Delete" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("clipboard_delete", { id: Number(id) }));
    await waitFor(() => expect(requests).toContainEqual({ type: "toast", text: "Запись удалена" }));
  });
  it("pin button pins without pasting", async () => {
    await mountTab();
    const row = rowOf("npm run tauri dev");
    fireEvent.click(within(row).getByRole("button", { name: "Закрепить" }));
    expect(requests).toEqual([]);
    await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Закреплённые" })).getAllByRole("option")).toHaveLength(3));
    expect((await ipc.invoke("clipboard_list", { query: "", limit: 50 })).find((c) => c.id === 3)?.pinned).toBe(true);
  });

  it("Ctrl+P toggles the pin of the cursor row", async () => {
    await mountTab();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Поиск в истории буфера" }), { key: "p", ctrlKey: true });
    await waitFor(async () => expect((await ipc.invoke("clipboard_list", { query: "", limit: 50 })).find((c) => c.id === 1)?.pinned).toBe(false));
  });

  it("delete button removes the row; Delete key removes the cursor row (not while typing a query)", async () => {
    await mountTab();
    fireEvent.click(within(rowOf("ул. Абая, 150, офис 12")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByText("ул. Абая, 150, офис 12")).toBeNull());

    const input = screen.getByRole("textbox", { name: "Поиск в истории буфера" });
    const before = rows().length;
    fireEvent.change(input, { target: { value: "tauri" } });
    fireEvent.keyDown(input, { key: "Delete" }); // editing the query: must not delete a clip
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect((await ipc.invoke("clipboard_list", { query: "", limit: 50 })).length).toBe(before);
  });

  it("«Очистить» needs a second click, keeps pinned items", async () => {
    await mountTab();
    const spy = vi.spyOn(ipc, "invoke");
    const btn = screen.getByRole("button", { name: /Очистить/ });
    fireEvent.click(btn);
    expect(spy.mock.calls.filter((c) => c[0] === "clipboard_clear")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("clipboard_clear", { keepPinned: true }));
    await waitFor(() => expect(rows()).toHaveLength(2)); // only the pinned ones remain
  });

  it("Escape disarms the confirmation", async () => {
    await mountTab();
    fireEvent.click(screen.getByRole("button", { name: /Очистить/ }));
    const prevented = !fireEvent.keyDown(screen.getByRole("textbox", { name: "Поиск в истории буфера" }), { key: "Escape" });
    expect(prevented).toBe(true);
    expect(screen.getByRole("button", { name: /Очистить/ })).toBeInTheDocument();
  });

  it("empty history state", async () => {
    await ipc.invoke("clipboard_clear", { keepPinned: false });
    render(<ClipboardTab />);
    expect(await screen.findByText("История буфера пуста")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Очистить/ })).toBeDisabled();
  });
});
