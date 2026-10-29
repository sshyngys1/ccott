import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../ipc", async () => ({ ...await vi.importActual<typeof import("../ipc")>("../ipc"), APP_VERSION: "0.2.2", getAppVersion: async () => "0.2.2" }));
import { Island } from "./Island";
import { resetMock } from "../ipc/mock";
import { resetIslandStore, useIslandStore } from "../store";
import { getLastAcknowledgedVersion, WHATS_NEW_STORAGE_KEY } from "../lib/whatsNew/catalog";
import { backgroundScreens } from "./preloadScreens";

beforeEach(() => { resetMock(); resetIslandStore(); localStorage.clear(); });
afterEach(() => { cleanup(); resetIslandStore(); });

it("waits for user expansion, collapse is not acknowledgment, explicit close persists across remount", async () => {
  const first = render(<Island />);
  expect(useIslandStore.getState().mode).toBe("collapsed");
  expect(screen.queryByText("Версия 0.2.2")).toBeNull();
  act(() => useIslandStore.getState().setMode("expanded"));
  expect(await screen.findByText("Версия 0.2.2")).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: "Что нового в CCOTT" })).toHaveLength(1);
  act(() => useIslandStore.getState().setMode("collapsed"));
  expect(getLastAcknowledgedVersion()).toBeNull();
  await waitFor(() => expect(screen.queryByText("Версия 0.2.2")).toBeNull());
  act(() => useIslandStore.getState().setMode("expanded"));
  fireEvent.click(await screen.findByRole("button", { name: "Понятно" }));
  expect(getLastAcknowledgedVersion()).toBe("0.2.2");
  first.unmount();
  resetIslandStore();
  render(<Island />);
  act(() => useIslandStore.getState().setMode("expanded"));
  expect(useIslandStore.getState().view).toBe("tabs");
});

it("keeps manual settings entry after acknowledgment and never lowers a newer marker", async () => {
  await Promise.all(backgroundScreens.map(screen => screen.preload()));
  localStorage.setItem(WHATS_NEW_STORAGE_KEY, "0.3.0");
  render(<Island />);
  act(() => { useIslandStore.getState().setMode("expanded"); useIslandStore.getState().setView("settings"); });
  fireEvent.click(await screen.findByRole("button", { name: "Что нового" }));
  expect(await screen.findByText("Версия 0.2.2")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Понятно" }));
  expect(getLastAcknowledgedVersion()).toBe("0.3.0");
});
