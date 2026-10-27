import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { invoke } from "../ipc";
import { mockCopy, mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetIslandStore, useIslandStore } from "../store";
import { Island } from "../shell/Island";
import { resetNotesStore } from "../lib/notes/store";
import { resetTextStore, useTextStore } from "../lib/text/store";
import { t } from ".";

beforeEach(() => { resetMock(); resetIslandStore(); resetNotesStore(); resetTextStore(); });
afterEach(() => { cleanup(); resetIslandStore(); resetNotesStore(); resetTextStore(); });

it("switches mounted settings and all tabs immediately, persists the choice, and follows settings://changed", async () => {
  render(<Island />);
  await waitFor(() => expect(mockListenerCount("settings://changed")).toBeGreaterThan(0));
  act(() => useIslandStore.getState().setMode("expanded"));
  fireEvent.click(await screen.findByRole("button", { name: "Настройки" }));
  fireEvent.click(await screen.findByRole("radio", { name: "English" }));
  expect(await screen.findByRole("switch", { name: "Start with Windows" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
  expect(document.documentElement.lang).toBe("en");
  await waitFor(async () => expect((await invoke("settings_get")).language).toBe("en"));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("tab", { name: "Text" });
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(["Home", "Clipboard", "Text", "Notes"]);
  fireEvent.click(screen.getByRole("tab", { name: "Text" }));
  expect(await screen.findByRole("textbox", { name: "Text to transform" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Format JSON" })).toBeInTheDocument();
  const userText = "Мой текст";
  act(() => useTextStore.getState().edit(userText));
  act(() => mockCopy({ kind: "image", text: "", sourceApp: "SnippingTool.exe" }));
  await act(async () => {
    const settings = await invoke("settings_get");
    mockEmit("settings://changed", { ...settings, language: "ru" });
  });
  expect(screen.getByRole("tab", { name: "Текст" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: t("textToTransform") })).toHaveValue(userText);
  expect(document.documentElement.lang).toBe("ru");
  act(() => useIslandStore.getState().setMode("collapsed"));
  expect(await screen.findByText("Изображение")).toHaveClass("ig-pill-preview");
}, 15000);

it("renders an English empty clipboard, notes and timer with English accessible labels", async () => {
  await invoke("settings_set", { patch: { language: "en" } });
  await invoke("clipboard_clear", { keepPinned: false });
  render(<Island />);
  await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  act(() => useIslandStore.getState().setMode("expanded"));
  fireEvent.click(await screen.findByRole("tab", { name: "Clipboard" }));
  expect(await screen.findByText("Your clipboard history is empty")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Search clipboard history" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  expect(await screen.findByRole("region", { name: "Timer" })).toBeInTheDocument();
  expect(await screen.findByRole("tab", { name: /^Note\d*$/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
});
