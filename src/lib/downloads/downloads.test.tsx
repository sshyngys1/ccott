import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import * as ipc from "../../ipc";
import { mockDownloadOpens, mockEmit, mockListenerCount, mockStartDownload, resetMock } from "../../ipc/mock";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import type { DownloadItem } from "../../shared/types";
import { DownloadsPill, downloadProgressShift } from "./DownloadsPill";
import { downloadsSummary, downloadsTitle, formatBytes } from "./format";
import { initDownloads, openDownload, resetDownloadsStore, useDownloadsStore } from "./store";

const active: DownloadItem = { id: "a", name: "test.zip", state: "active", receivedBytes: 13_002_342,
  totalBytes: null, bytesPerSec: 3_250_585, startedAt: 1, updatedAt: 2 };
let requests: ShellRequest[];
let off: () => void;
beforeEach(() => {
  resetMock(); resetDownloadsStore(); requests = [];
  off = onShellRequest((request) => { requests.push(request); });
});
afterEach(() => { cleanup(); off(); resetDownloadsStore(); resetMock(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("downloads", () => {
  it("only mounts the shimmer for active downloads with unknown size", () => {
    useDownloadsStore.setState({ items: [active] });
    const { container } = render(<DownloadsPill />);
    expect(container.querySelector(".ig-downloads-progress-fill--unknown")).toBeInTheDocument();
    act(() => useDownloadsStore.setState({ items: [{ ...active, totalBytes: active.receivedBytes * 2 }] }));
    expect(container.querySelector(".ig-downloads-progress-fill--unknown")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    act(() => useDownloadsStore.setState({ items: [{ ...active, state: "done" }] }));
    expect(container.querySelector(".ig-downloads-pill")).toBeNull();
  });

  it("progress bar: translateX for 0, 37 and 100%, without scale, and no bar for unknown size", () => {
    expect(downloadProgressShift(0)).toBe("translateX(-100%)");
    expect(downloadProgressShift(37)).toBe("translateX(-63%)");
    expect(downloadProgressShift(100)).toBe("translateX(0%)");

    // Unknown size: shimmer mounted, no known progress bar
    useDownloadsStore.setState({ items: [active] });
    const { container, rerender } = render(<DownloadsPill />);
    expect(container.querySelector(".ig-downloads-progress-fill--unknown")).toBeInTheDocument();
    expect(container.querySelector(".ig-downloads-progress-fill:not(.ig-downloads-progress-fill--unknown)")).toBeNull();

    // 0%
    act(() => useDownloadsStore.setState({ items: [{ ...active, receivedBytes: 0, totalBytes: 100 }] }));
    rerender(<DownloadsPill />);
    let fill = container.querySelector<HTMLElement>(".ig-downloads-progress-fill:not(.ig-downloads-progress-fill--unknown)");
    expect(fill).not.toBeNull();
    expect(fill?.style.transform).toBe("translateX(-100%)");
    expect(fill?.style.transform).not.toContain("scale");
    expect(window.getComputedStyle(fill!).transform).not.toContain("scale");

    // 37%
    act(() => useDownloadsStore.setState({ items: [{ ...active, receivedBytes: 37, totalBytes: 100 }] }));
    rerender(<DownloadsPill />);
    fill = container.querySelector<HTMLElement>(".ig-downloads-progress-fill:not(.ig-downloads-progress-fill--unknown)");
    expect(fill?.style.transform).toBe("translateX(-63%)");
    expect(fill?.style.transform).not.toContain("scale");
    expect(window.getComputedStyle(fill!).transform).not.toContain("scale");

    // 100%
    act(() => useDownloadsStore.setState({ items: [{ ...active, receivedBytes: 100, totalBytes: 100 }] }));
    rerender(<DownloadsPill />);
    fill = container.querySelector<HTMLElement>(".ig-downloads-progress-fill:not(.ig-downloads-progress-fill--unknown)");
    expect(fill?.style.transform).toBe("translateX(0%)");
    expect(fill?.style.transform).not.toContain("scale");
    expect(window.getComputedStyle(fill!).transform).not.toContain("scale");
  });

  it("shares one load/subscription and updates from mockEmit", async () => {
    const spy = vi.spyOn(ipc, "invoke");
    await Promise.all([initDownloads(), initDownloads()]);
    expect(spy.mock.calls.filter(([command]) => command === "downloads_list")).toHaveLength(1);
    expect(mockListenerCount("downloads://changed")).toBe(1);
    mockEmit("downloads://changed", [active]);
    expect(useDownloadsStore.getState().items).toEqual([active]);
    expect(requests).toEqual([]);
    resetDownloadsStore();
    expect(mockListenerCount("downloads://changed")).toBe(0);
  });

  it("announces each done once with both actions, ignores initial history and failures", async () => {
    vi.spyOn(ipc, "invoke").mockResolvedValueOnce([{ ...active, state: "done" }]);
    await initDownloads();
    expect(requests).toEqual([]);
    mockEmit("downloads://changed", [{ ...active, state: "done" }, { ...active, id: "failed", state: "failed" }]);
    expect(requests).toEqual([]);
    const done = { ...active, id: "new", state: "done" as const };
    mockEmit("downloads://changed", [done]);
    mockEmit("downloads://changed", [done]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: "toast", text: "Скачано: test.zip",
      actions: [{ label: "Открыть" }, { label: "Показать в папке" }] });
    const spy = vi.spyOn(ipc, "invoke").mockResolvedValue(undefined);
    if (requests[0].type === "toast") {
      requests[0].actions?.[0].onClick(); requests[0].actions?.[1].onClick();
    }
    expect(spy).toHaveBeenCalledWith("downloads_open", { id: "new", mode: "open" });
    expect(spy).toHaveBeenCalledWith("downloads_open", { id: "new", mode: "reveal" });
  });

  it("formats RU/EN bytes, speeds and plural counts", () => {
    expect(formatBytes(active.receivedBytes)).toBe("12,4 МБ");
    expect(downloadsSummary([active])).toEqual({ detail: "12,4 МБ · 3,1 МБ/с", percent: null });
    expect(downloadsTitle(Array.from({ length: 3 }, () => active))).toBe("3 загрузки");
    expect(downloadsTitle(Array.from({ length: 5 }, () => active))).toBe("5 загрузок");
    expect(downloadsTitle([{ ...active, name: "" }])).toBe("Загрузка…");
    setLanguage("en");
    expect(downloadsSummary([active]).detail).toBe("12.4 MB · 3.1 MB/s");
    expect(downloadsTitle([active, active])).toBe("2 downloads");
  });

  it("uses percentages only when every active total is known", () => {
    const known = { ...active, receivedBytes: 50, totalBytes: 100 };
    expect(downloadsSummary([known]).percent).toBe(50);
    expect(downloadsSummary([known, active]).percent).toBeNull();
    expect(downloadsSummary([{ ...known, receivedBytes: 101 }]).percent).toBe(100);
    expect(downloadsSummary([{ ...active, bytesPerSec: null }]).detail).toBe("12,4 МБ · —");
  });

  it("renders a live activity and reveals its partial, with optional progress", async () => {
    const spy = vi.spyOn(ipc, "invoke").mockResolvedValue(undefined);
    useDownloadsStore.setState({ items: [active] });
    render(<DownloadsPill />);
    expect(screen.getByText("test.zip")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(spy).toHaveBeenCalledWith("downloads_open", { id: "a", mode: "reveal" });
    act(() => useDownloadsStore.setState({ items: [{ ...active, totalBytes: active.receivedBytes * 2 }] }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    act(() => useDownloadsStore.setState({ items: [active, { ...active, id: "b" }, { ...active, id: "c" }] }));
    expect(screen.getByText("3 загрузки")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("simulates bytes → done with the same ID, honors disable and validates open", async () => {
    vi.useFakeTimers();
    await initDownloads();
    mockStartDownload();
    const initial = (await ipc.invoke("downloads_list"))[0];
    expect(initial.state).toBe("active");
    await expect(ipc.invoke("downloads_open", { id: initial.id, mode: "open" })).rejects.toThrow();
    await ipc.invoke("downloads_open", { id: initial.id, mode: "reveal" });
    await vi.advanceTimersByTimeAsync(8000);
    const done = (await ipc.invoke("downloads_list"))[0];
    expect(done.id).toBe(initial.id);
    expect(done.state).toBe("done");
    expect(done.receivedBytes).toBeGreaterThan(initial.receivedBytes);
    await ipc.invoke("downloads_open", { id: done.id, mode: "open" });
    expect(mockDownloadOpens).toEqual([{ id: initial.id, mode: "reveal" }, { id: initial.id, mode: "open" }]);
    expect(requests).toHaveLength(1);
    await ipc.invoke("settings_set", { patch: { downloadsMonitor: false } });
    expect(await ipc.invoke("downloads_list")).toEqual([]);
    expect(useDownloadsStore.getState().items).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(useDownloadsStore.getState().items).toEqual([]);
  });

  it("reports a disappeared file without throwing to the caller", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openDownload("gone", "open");
    expect(requests).toEqual([{ type: "toast", text: "Не удалось открыть загрузку" }]);
  });
});
