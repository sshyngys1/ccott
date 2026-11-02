import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";
import { mockConfig, mockListen, resetMock } from "../../ipc/mock";
import { resetDockStore } from "../../lib/dock/store";
import { resetIslandStore, useIslandStore } from "../../store";
import { Island } from "../../shell/Island";
import shelf from "./index";
import { selectShelfItem } from "./selection";
import { ShelfTab } from "./ShelfTab";
import { refreshShelf, resetShelfStore, useShelfStore } from "./store";

beforeEach(() => { resetMock(); resetShelfStore(); resetIslandStore(); resetDockStore(); });
afterEach(() => { resetShelfStore(); resetDockStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["ru", "en"] as const)("%s: renders grid, sizes and missing item; clears to an empty state", async lang => {
  setLanguage(lang);
  render(<ShelfTab />);
  const options = await screen.findAllByRole("option");
  expect(options).toHaveLength(4);
  expect(screen.getByText(new RegExp(`121[,.]9 ${t("downloads.kb")}`))).toBeVisible();
  const missing = options.find(el => el.textContent?.includes("Moved.zip"))!;
  expect(missing).toHaveAttribute("data-missing", "true");
  expect(missing).toHaveTextContent(t("shelf.missing"));
  fireEvent.contextMenu(missing);
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  expect(screen.queryByRole("menuitem", { name: t("shelf.open") })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: t("shelf.remove") }));
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: t("shelf.clear") }));
  expect(await screen.findByText(t("shelf.empty"))).toBeVisible();
});

it("selects using Ctrl/Shift, opens and reveals from a keyboard-accessible menu", async () => {
  const invoke = vi.spyOn(ipc, "invoke");
  render(<ShelfTab />);
  const options = await screen.findAllByRole("option");
  fireEvent.click(options[0]);
  fireEvent.click(options[2], { ctrlKey: true });
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  expect(options[1]).toHaveAttribute("aria-selected", "false");
  fireEvent.click(options[0], { shiftKey: true });
  for (const option of options.slice(0, 3)) expect(option).toHaveAttribute("aria-selected", "true");
  fireEvent.contextMenu(options[0]);
  const open = screen.getByRole("menuitem", { name: t("shelf.open") });
  expect(open).toHaveFocus();
  fireEvent.keyDown(open, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: t("shelf.reveal") })).toHaveFocus();
  fireEvent.click(screen.getByRole("menuitem", { name: t("shelf.reveal") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("shelf_open", { id: "shelf-1", mode: "reveal" }));
  fireEvent.contextMenu(options[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: t("shelf.open") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("shelf_open", { id: "shelf-1", mode: "open" }));
});

it("starts one native drag with all selected available files and suppresses the following click", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  mockConfig.shelfDragOutcome = "cancel";
  const invoke = vi.spyOn(ipc, "invoke");
  render(<ShelfTab />);
  const options = await screen.findAllByRole("option");
  fireEvent.click(options[0]); fireEvent.click(options[1], { ctrlKey: true });
  fireEvent.pointerDown(options[0], { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(options[0], { buttons: 1, clientX: 30, clientY: 10 });
  fireEvent.pointerMove(options[0], { buttons: 1, clientX: 50, clientY: 10 });
  fireEvent.pointerUp(options[0]);
  fireEvent.click(options[0]);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("shelf_start_drag", { ids: ["shelf-1", "shelf-2"] }));
  expect(invoke.mock.calls.filter(([command]) => command === "shelf_start_drag")).toHaveLength(1);
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  expect(options[1]).toHaveAttribute("aria-selected", "true");
  expect(options[2]).toHaveAttribute("aria-selected", "false");
  expect(invoke).not.toHaveBeenCalledWith("shelf_open", expect.anything());
  // Suppression applies only to the click produced by the drag gesture.
  fireEvent.click(options[0]);
  expect(options[1]).toHaveAttribute("aria-selected", "false");
});

it("does not open or drag a missing file", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const invoke = vi.spyOn(ipc, "invoke");
  render(<ShelfTab />);
  const missing = (await screen.findAllByRole("option"))[3];
  fireEvent.doubleClick(missing);
  fireEvent.pointerDown(missing, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(missing, { clientX: 30, clientY: 10 });
  expect(invoke).not.toHaveBeenCalledWith("shelf_open", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("shelf_start_drag", expect.anything());
});

it("mock promotes duplicates with stable ids, emits changes, supports remove and expiry (0 means forever)", async () => {
  const changes = vi.fn();
  const off = mockListen("shelf://changed", changes);
  try {
    const before = await ipc.invoke("shelf_list");
    const list = await ipc.invoke("shelf_add", { paths: [before[1].path.toUpperCase()] });
    expect(list).toHaveLength(4); expect(list[0].id).toBe(before[1].id);
    expect(changes).toHaveBeenCalled();
    expect(await ipc.invoke("shelf_remove", { ids: [list[0].id] })).toHaveLength(3);
    await ipc.invoke("settings_set", { patch: { shelfRetentionHours: 0 } });
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 999 * 3_600_000);
    expect(await ipc.invoke("shelf_list")).toHaveLength(3);
    await ipc.invoke("settings_set", { patch: { shelfRetentionHours: 24 } });
    expect(await ipc.invoke("shelf_list")).toHaveLength(0);
    await expect(ipc.invoke("settings_set", { patch: { shelfRetentionHours: 2 } })).rejects.toThrow();
  } finally { off(); }
});

it.each([ ["drop", false, 3], ["cancel", false, 4], ["drop", true, 4] ] as const)("mock drag outcome %s, keep %s retains %i", async (outcome, keep, count) => {
  mockConfig.shelfDragOutcome = outcome;
  await ipc.invoke("settings_set", { patch: { shelfKeepAfterDrag: keep } });
  await ipc.invoke("shelf_start_drag", { ids: ["shelf-1"] });
  expect(await ipc.invoke("shelf_list")).toHaveLength(count);
  await expect(ipc.invoke("shelf_start_drag", { ids: ["shelf-4"] })).rejects.toThrow(t("shelf.missing"));
});

it("reloads missing flags whenever the tab mounts", async () => {
  await refreshShelf();
  const items = useShelfStore.getState().items;
  const invoke = vi.spyOn(ipc, "invoke");
  const view = render(<ShelfTab />);
  expect((await screen.findAllByRole("option"))[0]).toHaveAttribute("data-missing", "false");
  view.unmount();
  invoke.mockResolvedValueOnce(items.map((item, index) => index === 0 ? { ...item, missing: true } : item));
  const reopened = render(<ShelfTab />);
  await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveAttribute("data-missing", "true"));
  expect(useShelfStore.getState().items.map(item => item.id)).toEqual(items.map(item => item.id));
  expect(screen.getAllByRole("option")[0]).toHaveTextContent(t("shelf.missing"));
  reopened.unmount();
  invoke.mockResolvedValueOnce(items);
  render(<ShelfTab />);
  await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveAttribute("data-missing", "false"));
  expect(useShelfStore.getState().items.map(item => item.id)).toEqual(items.map(item => item.id));
});

it("captures native keyboard from the menu, navigates, restores its anchor on Escape and releases on the next Escape", async () => {
  const invoke = vi.spyOn(ipc, "invoke");
  useIslandStore.setState({ mode: "expanded", activeTab: "shelf" });
  render(<Island modules={[{ ...shelf, Tab: ShelfTab }]} />);
  const options = await screen.findAllByRole("option");
  fireEvent.contextMenu(options[0]);
  const open = screen.getByRole("menuitem", { name: t("shelf.open") });
  expect(open).toHaveFocus();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("island_set_keyboard_focus", { active: true }));
  expect(useIslandStore.getState().keyboardFocus).toBe(true);
  fireEvent.keyDown(open, { key: "ArrowDown" });
  const reveal = screen.getByRole("menuitem", { name: t("shelf.reveal") });
  expect(reveal).toHaveFocus();
  fireEvent.keyDown(reveal, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(options[0]).toHaveFocus();
  expect(useIslandStore.getState().mode).toBe("expanded");
  expect(useIslandStore.getState().keyboardFocus).toBe(true);
  fireEvent.keyDown(options[0], { key: "Escape" });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("island_set_keyboard_focus", { active: false }));
  expect(useIslandStore.getState().keyboardFocus).toBe(false);
  expect(options[0]).not.toHaveFocus();
  expect(useIslandStore.getState().mode).toBe("collapsed");
});

it("captures native keyboard from the grid and handles arrows, Enter, Ctrl+A, Escape and Delete", async () => {
  const invoke = vi.spyOn(ipc, "invoke");
  useIslandStore.setState({ mode: "expanded", activeTab: "shelf" });
  render(<Island modules={[{ ...shelf, Tab: ShelfTab }]} />);
  const options = await screen.findAllByRole("option");
  act(() => options[0].focus());
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("island_set_keyboard_focus", { active: true }));
  fireEvent.keyDown(options[0], { key: "ArrowRight" });
  expect(options[1]).toHaveFocus();
  expect(options[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(options[1], { key: "Enter" });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("shelf_open", { id: "shelf-2", mode: "open" }));
  fireEvent.keyDown(options[1], { key: "a", ctrlKey: true });
  options.forEach(option => expect(option).toHaveAttribute("aria-selected", "true"));
  fireEvent.keyDown(options[1], { key: "Escape" });
  options.forEach(option => expect(option).toHaveAttribute("aria-selected", "false"));
  expect(options[1]).toHaveFocus();
  expect(useIslandStore.getState().mode).toBe("expanded");
  fireEvent.keyDown(options[1], { key: " " });
  fireEvent.keyDown(options[1], { key: "Delete" });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("shelf_remove", { ids: ["shelf-2"] }));
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
});

it("range selection adds to Ctrl selection and toggles without duplicating", () => {
  const ids = ["a", "b", "c", "d"];
  expect(selectShelfItem(ids, ["d"], "c", "a", true, true)).toEqual(["d", "a", "b", "c"]);
  expect(selectShelfItem(ids, ["a", "c"], "c", "a", true, false)).toEqual(["a"]);
});
