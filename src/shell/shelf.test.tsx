import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import * as ipc from "../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetDockStore, useDockStore } from "../lib/dock/store";
import { resetDownloadsStore } from "../lib/downloads/store";
import { resetShelfStore, useShelfStore } from "../modules/shelf/store";
import shelf from "../modules/shelf";
import type { IslandModule } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "./Island";
import { SettingsView } from "./settings/SettingsView";
import { dropZone, handleDockDrop } from "./useDockDrop";

beforeEach(() => { resetMock(); resetIslandStore(); resetShelfStore(); resetDockStore(); resetDownloadsStore(); });
afterEach(() => { cleanup(); resetShelfStore(); resetDockStore(); resetDownloadsStore(); vi.restoreAllMocks(); });
const controls = () => ({ expandNow: vi.fn(() => useIslandStore.getState().setMode("expanded")), collapseNow: vi.fn(() => useIslandStore.getState().setMode("collapsed")), summon: vi.fn() });

it.each(["ru", "en"] as const)("%s settings show shelf defaults, toggle keep and offer exactly the contracted retention choices", async lang => {
  setLanguage(lang);
  render(<SettingsView />);
  const keep = screen.getByRole("switch", { name: t("shelf.keepAfterDrag") });
  expect(keep).not.toBeChecked();
  fireEvent.click(keep);
  await waitFor(() => expect(useIslandStore.getState().settings.shelfKeepAfterDrag).toBe(true));
  const retention = screen.getByRole("combobox", { name: t("shelf.retention") });
  expect(retention).toHaveValue("24");
  expect(Array.from(retention.querySelectorAll("option")).map(o => o.value)).toEqual(["1", "24", "72", "168", "0"]);
  fireEvent.change(retention, { target: { value: "0" } });
  await waitFor(() => expect(useIslandStore.getState().settings.shelfRetentionHours).toBe(0));
});

it("idle pill shows a count, reacts to shelf changes, and unsubscribes on unmount", async () => {
  const view = render(<Island modules={[]} />);
  expect(await screen.findByLabelText(t("shelf.count", { count: 4 }))).toBeVisible();
  await waitFor(() => expect(mockListenerCount("shelf://changed")).toBe(1));
  await act(async () => { await ipc.invoke("shelf_clear"); });
  expect(screen.queryByLabelText(t("shelf.count", { count: 4 }))).toBeNull();
  view.unmount();
  await waitFor(() => expect(mockListenerCount("shelf://changed")).toBe(0));
});

it("media and downloads keep priority over the shelf badge", async () => {
  const media: IslandModule = { id: "home", title: "Home", icon: () => null, Tab: () => null, order: 0,
    compact: { useIsActive: () => true, priority: 10, View: () => <span>media activity</span> } };
  render(<Island modules={[media]} />);
  await waitFor(() => expect(useShelfStore.getState().items).toHaveLength(4));
  expect(screen.getByText("media activity")).toBeVisible();
  expect(screen.queryByLabelText(t("shelf.count", { count: 4 }))).toBeNull();
  await waitFor(() => expect(mockListenerCount("downloads://changed")).toBe(1));
  act(() => mockEmit("downloads://changed", [{ id: "dl", name: "active.zip", state: "active", receivedBytes: 100, totalBytes: null, bytesPerSec: 10, startedAt: 0, updatedAt: 0 }]));
  await waitFor(() => expect(screen.getByRole("button", { name: /active.zip/ })).toBeVisible());
  expect(screen.queryByLabelText(t("shelf.count", { count: 4 }))).toBeNull();
});

it("clicking the shelf count opens the shelf tab", async () => {
  render(<Island modules={[shelf]} />);
  fireEvent.click(await screen.findByRole("button", { name: t("shelf.count", { count: 4 }) }));
  expect(useIslandStore.getState().mode).toBe("expanded");
  expect(useIslandStore.getState().activeTab).toBe("shelf");
  expect(await screen.findByRole("listbox", { name: t("shelf.title") })).toBeVisible();
});

it("collapsed drop highlights the pill, resists hover expansion and adds to shelf without touching the dock", async () => {
  await ipc.invoke("settings_set", { patch: { disabledFeatures: ["dock"] } });
  render(<Island modules={[]} />);
  await screen.findByLabelText(t("shelf.count", { count: 4 }));
  act(() => window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "enter" } })));
  expect(screen.getByRole("status")).toHaveTextContent(t("shelf.drop"));
  expect(useIslandStore.getState().mode).toBe("collapsed");
  act(() => useIslandStore.getState().setMode("expanded"));
  expect(useIslandStore.getState().mode).toBe("collapsed");
  await act(async () => window.dispatchEvent(new CustomEvent("ccott:dock-drop", { detail: { type: "drop", paths: ["C:\\Test.txt", "c:\\TEST.txt"] } })));
  await waitFor(() => expect(useShelfStore.getState().items).toHaveLength(5));
  expect((await ipc.invoke("dock_list"))).toHaveLength(5);
  expect(useShelfStore.getState().dropTarget).toBeNull();
});

it("expanded Home dock drop and shelf tab drop remain separate; outgoing drags ignore incoming events", async () => {
  const c = controls();
  useIslandStore.setState({ mode: "expanded", activeTab: "home", view: "tabs" });
  await handleDockDrop({ type: "drop", paths: ["C:\\New.lnk"] }, c);
  expect((await ipc.invoke("dock_list"))).toHaveLength(6);
  expect((await ipc.invoke("shelf_list"))).toHaveLength(4);
  useIslandStore.getState().setActiveTab("shelf");
  await handleDockDrop({ type: "drop", paths: ["C:\\New.txt"] }, c);
  expect((await ipc.invoke("shelf_list"))).toHaveLength(5);
  useDockStore.setState({ outgoing: true });
  await handleDockDrop({ type: "drop", paths: ["C:\\Ignored.txt"] }, c);
  expect((await ipc.invoke("shelf_list"))).toHaveLength(5);
});

it("hit-tests physical drop positions: only the dock zone or shelf tab accepts files", () => {
  useIslandStore.setState({ mode: "expanded", activeTab: "home", view: "tabs" });
  const dock = document.createElement("div"), tab = document.createElement("div");
  dock.className = "hm-dock"; tab.id = "ig-tab-shelf";
  document.body.append(dock, tab);
  vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({ left: 10, right: 100, top: 100, bottom: 150 } as DOMRect);
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({ left: 20, right: 80, top: 10, bottom: 40 } as DOMRect);
  const p = (x: number, y: number) => ({ x: x * window.devicePixelRatio, y: y * window.devicePixelRatio });
  expect(dropZone(p(50, 120))).toBe("dock");
  expect(dropZone(p(50, 20))).toBe("shelf");
  expect(dropZone(p(500, 250))).toBeNull();
  useIslandStore.setState({ view: "cmd" });
  expect(dropZone(p(50, 120))).toBeNull();
  dock.remove(); tab.remove();
});
