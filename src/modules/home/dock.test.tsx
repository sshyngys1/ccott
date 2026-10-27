import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import * as ipc from "../../ipc";
import * as dockIpc from "../../ipc/dock";
import { mockConfig, resetMock } from "../../ipc/mock";
import { initDock, resetDockStore, useDockStore } from "../../lib/dock/store";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import { resetIslandStore, useIslandStore } from "../../store";
import { useDockDrop } from "../../shell/useDockDrop";
import { Dock } from "./Dock";
beforeEach(() => { resetMock(); resetDockStore(); resetIslandStore(); });
afterEach(() => { resetDockStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(["ru", "en"] as const)("%s shows mock entries, removes via context menu, then shows the empty prompt", async (lang) => {
    setLanguage(lang);
    render(<Dock />);
    await screen.findByRole("button", { name: "Terminal" });
    expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute("title", "Documents");
    fireEvent.contextMenu(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("menuitem", { name: lang === "ru" ? "Удалить из дока" : "Remove from dock" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull());
    await act(async () => { for (const i of useDockStore.getState().items)
        await ipc.invoke("dock_remove", { id: i.id }); });
    expect(screen.getByText(lang === "ru" ? "Перетащите сюда приложение или папку" : "Drop an app or folder here")).toBeVisible();
});
it("adds a chosen folder with the system dialog wrapper", async () => {
    const picker = vi.spyOn(dockIpc, "pickDockPaths").mockResolvedValue(["C:\\Test folder"]);
    render(<Dock />);
    await screen.findByRole("button", { name: "Terminal" });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в док" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Выбрать папку" }));
    await screen.findByRole("button", { name: "Test folder" });
    expect(picker).toHaveBeenCalledWith(true);
    expect(useDockStore.getState().interacting).toBe(false);
});
it("an OS drop on the collapsed pill expands Home, highlights and adds without duplicates", async () => {
    const controls = { expandNow: vi.fn(() => useIslandStore.getState().setMode("expanded")), collapseNow: vi.fn(), summon: vi.fn() };
    function Host() { useDockDrop(controls); return <Dock />; }
    useIslandStore.getState().setActiveTab("text");
    render(<Host />);
    await screen.findByRole("button", { name: "Terminal" });
    act(() => window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "enter", paths: ["C:\\Test.lnk"] } })));
    expect(useIslandStore.getState().mode).toBe("expanded");
    expect(useIslandStore.getState().activeTab).toBe("home");
    expect(screen.getByRole("region", { name: "Док" })).toHaveAttribute("data-dragging", "true");
    await act(async () => { window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "drop", paths: ["C:\\Test.lnk", "c:\\TEST.lnk"] } })); });
    await screen.findByRole("button", { name: "Test" });
    expect(useDockStore.getState().items).toHaveLength(6);
    expect(screen.getByRole("region", { name: "Док" })).toHaveAttribute("data-dragging", "false");
});
it.each(["ru", "en"] as const)("%s waits for collapse before open and toasts missing paths", async (lang) => {
    setLanguage(lang);
    const requests: ShellRequest[] = [];
    let release = () => { };
    const off = onShellRequest(req => { requests.push(req); if (req.type === "collapse")
        return new Promise<void>(r => { release = r; }); });
    try {
        render(<Dock />);
        await screen.findByRole("button", { name: "Terminal" });
        const invoke = vi.spyOn(ipc, "invoke");
        mockConfig.dockOpenError = true;
        fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
        expect(invoke).not.toHaveBeenCalledWith("dock_open", expect.anything());
        await act(async () => { release(); });
        await waitFor(() => expect(requests).toContainEqual({ type: "toast", text: lang === "ru" ? "Файл не найден" : "File not found" }));
        expect(useDockStore.getState().items).toHaveLength(5);
    }
    finally {
        off();
    }
});
it("reorders using pointer events without opening the dragged entry", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    render(<Dock />);
    await screen.findByRole("button", { name: "Terminal" });
    const first = screen.getByRole("button", { name: "Terminal" }), target = screen.getByRole("button", { name: "Projects" });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    const open = vi.spyOn(dockIpc, "dockOpen");
    fireEvent.pointerDown(first, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(first, { clientX: 100, clientY: 10 });
    fireEvent.pointerUp(first);
    fireEvent.click(first);
    await waitFor(() => expect(useDockStore.getState().items.map(i => i.name)).toEqual(["Documents", "Projects", "Terminal", "Sketches", "Notes"]));
    expect(open).not.toHaveBeenCalled();
    const dock = screen.getByRole("region", { name: "Док" });
    expect(within(dock).getAllByRole("button")[0]).toHaveAccessibleName("Documents");
});
it("mock enforces the limit and rejects incomplete reorder without losing entries", async () => {
    await initDock();
    await ipc.invoke("dock_add", { paths: Array.from({ length: 7 }, (_, i) => `C:\\Test${i}.lnk`) });
    await expect(ipc.invoke("dock_add", { paths: ["C:\\overflow.lnk"] })).rejects.toThrow("12");
    await expect(ipc.invoke("dock_reorder", { ids: ["dock-1"] })).rejects.toThrow();
    expect((await ipc.invoke("dock_list")).length).toBe(12);
});

it("the shared add menu supports arrows, Escape and outside clicks", async () => {
  render(<Dock />);
  await screen.findByRole("button", { name: "Terminal" });
  const add = screen.getByRole("button", { name: "Добавить в док" });
  fireEvent.click(add);
  const file = screen.getByRole("menuitem", { name: "Выбрать приложение или файл" });
  const folder = screen.getByRole("menuitem", { name: "Выбрать папку" });
  expect(file).toHaveFocus();
  fireEvent.keyDown(file, { key: "ArrowDown" });
  expect(folder).toHaveFocus();
  expect(file).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(folder, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(add).toHaveFocus();
  fireEvent.click(add);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("crossing the island edge starts a native copy once without reordering or opening", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const start = vi.spyOn(dockIpc, "dockStartDrag").mockResolvedValue();
  const open = vi.spyOn(dockIpc, "dockOpen");
  const reorder = vi.spyOn(dockIpc, "dockReorder");
  render(<div className="ig-island"><Dock /></div>);
  const item = await screen.findByRole("button", { name: "Terminal" });
  vi.spyOn(item.closest(".ig-island")!, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.pointerDown(item, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(item, { clientX: 220, clientY: 10 });
  fireEvent.pointerMove(item, { clientX: 230, clientY: 10 });
  fireEvent.pointerUp(item);
  fireEvent.click(item);
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledWith("dock-1");
  expect(open).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
});
