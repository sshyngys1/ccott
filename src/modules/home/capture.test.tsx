import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockConfig, resetMock } from "../../ipc/mock";
import { setLanguage } from "../../i18n";
import { consumeCaptureEcho, resetCaptureStore, runCapture, useCaptureStore } from "../../lib/capture/store";
import { resetAudioStore } from "../../lib/audio/store";
import { resetMediaStore } from "../../lib/media/store";
import { onShellRequest } from "../../shared/shellBus";
import { useToastSync } from "../../shell/useShellSync";
import { resetIslandStore, useIslandStore } from "../../store";
import { HomeTab } from "./HomeTab";

beforeEach(() => { resetMock(); resetCaptureStore(); resetIslandStore(); resetAudioStore(); resetMediaStore(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetCaptureStore(); resetIslandStore(); resetAudioStore(); resetMediaStore(); });
function Harness() { useToastSync(); return <HomeTab />; }

it.each([
  ["Область", false, "region", "copy"], ["Весь экран", false, "screen", "copy"],
  ["Область", true, "region", "save"], ["Весь экран", true, "screen", "save"],
  ["Текст с экрана", false, "region", "ocr"], ["Текст с экрана", true, "region", "ocr"],
] as const)("%s shift=%s invokes %s/%s only after collapse completes", async (name, shiftKey, mode, action) => {
  const spy = vi.spyOn(ipc, "invoke");
  let release = () => {};
  const off = onShellRequest((request) => request.type === "collapse" ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
  try {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name }), { shiftKey });
    expect(spy.mock.calls.some(([command]) => command === "capture_start")).toBe(false);
    expect(screen.getByRole("button", { name })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("capture_start", { mode, action }));
    await waitFor(() => expect(useCaptureStore.getState().busy).toBe(false));
    expect(useIslandStore.getState().toast?.label).toBe(action === "save" ? "Сохранено" : action === "ocr" ? "Текст скопирован" : "Скопировано");
  } finally { off(); }
});

it.each(["ru", "en"] as const)("%s displays every outcome and Saved opens the screenshots folder", async (language) => {
  setLanguage(language);
  render(<Harness />);
  const spy = vi.spyOn(ipc, "invoke");
  await act(() => runCapture("region", "save"));
  expect(useIslandStore.getState().toast?.label).toBe(language === "ru" ? "Сохранено" : "Saved");
  await act(async () => { useIslandStore.getState().toast?.onClick?.(); });
  expect(spy).toHaveBeenCalledWith("capture_open_folder");
  mockConfig.captureOutcome = "empty";
  await act(() => runCapture("region", "ocr"));
  expect(useIslandStore.getState().toast?.label).toBe(language === "ru" ? "Текст не найден" : "No text found");
  mockConfig.captureOutcome = "error";
  await act(() => runCapture("screen", "copy"));
  expect(useIslandStore.getState().toast?.label).toBe(language === "ru" ? "Не удалось сделать снимок или распознать текст" : "Couldn’t capture the screen or recognize text");
  const previous = useIslandStore.getState().toast;
  mockConfig.captureOutcome = "cancel";
  await act(() => runCapture("region", "copy"));
  expect(useIslandStore.getState().toast).toBe(previous);
  expect(screen.getByRole("button", { name:language === "ru" ? "Область" : "Region" })).toBeEnabled();
});

it("only consumes capture clipboard echoes, leaving other apps' copies alone", async () => {
  await runCapture("screen", "save");
  const item = { id:1, kind:"image" as const, text:"", preview:"", sourceApp:"Paint.exe", createdAt:0, pinned:false };
  expect(consumeCaptureEcho(item)).toBe(false);
  expect(consumeCaptureEcho({ ...item, sourceApp:"island-win.exe" })).toBe(true);
  expect(consumeCaptureEcho({ ...item, sourceApp:"island-win.exe" })).toBe(false);
});

it.each(["text", "link"] as const)("consumes a native QR %s echo without swallowing a different app's copy", async (kind) => {
  await runCapture("region", "qr");
  const item = { id:1, kind, text:"https://example.com/ccott", preview:"", sourceApp:"Chrome.exe", createdAt:0, pinned:false };
  expect(consumeCaptureEcho(item)).toBe(false);
  expect(consumeCaptureEcho({ ...item, sourceApp:"island-win.exe" })).toBe(true);
  expect(consumeCaptureEcho({ ...item, sourceApp:"island-win.exe" })).toBe(false);
});
