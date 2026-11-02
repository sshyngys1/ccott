import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetDownloadsStore } from "../lib/downloads/store";
import { resetMediaStore } from "../lib/media/store";
import { resetTimerStore, useTimerStore } from "../lib/timer/store";
import type { DownloadItem } from "../shared/types";
import { resetIslandStore, useIslandStore } from "../store";
import { Island, PillToast } from "./Island";
import { showToast } from "./toast";

const item: DownloadItem = { id: "a", name: "a.zip", state: "active", receivedBytes: 1000,
  totalBytes: null, bytesPerSec: 1000, startedAt: 0, updatedAt: 0 };
beforeEach(() => { resetMock(); resetIslandStore(); resetDownloadsStore(); resetMediaStore(); resetTimerStore(); });
afterEach(() => { cleanup(); resetMock(); resetIslandStore(); resetDownloadsStore(); resetMediaStore(); resetTimerStore(); });

it("downloads outrank media, the timer still wins, and done has two working toast actions", async () => {
  render(<Island />);
  await screen.findByRole("button", { name: /Открыть плеер/ });
  await waitFor(() => expect(mockListenerCount("downloads://changed")).toBe(1));
  act(() => mockEmit("downloads://changed", [item]));
  await screen.findByRole("button", { name: /a.zip.*Показать в папке/ });
  act(() => useTimerStore.getState().toggle());
  await screen.findByRole("button", { name: /таймер/i });
  act(() => mockEmit("downloads://changed", [{ ...item, state: "done" }]));
  await screen.findByText("Скачано: a.zip");
  expect(screen.getByRole("button", { name: "Открыть" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Показать в папке" })).toBeInTheDocument();
});

it("toast action buttons preserve DND and existing one-action toasts", () => {
  const open = vi.fn(), reveal = vi.fn();
  showToast({ label: "file.zip", actions: [{ label: "Open", icon: "file", onClick: open }, { label: "Show in folder", icon: "folder", onClick: reveal }] });
  const toast = useIslandStore.getState().toast!;
  render(<PillToast {...toast} />);
  fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
  fireEvent.click(screen.getByRole("button", { name: "Показать в папке" }));
  expect(open).toHaveBeenCalledOnce(); expect(reveal).toHaveBeenCalledOnce();
  useIslandStore.setState({ doNotDisturb: true, toast: null });
  showToast({ label: "file.zip", actions: toast.actions });
  expect(useIslandStore.getState().toast).toBeNull();
});
