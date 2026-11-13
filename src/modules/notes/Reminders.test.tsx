import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";
import { mockListenerCount, resetMock } from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import { Reminders } from "./Reminders";
import { NotesTab } from "./NotesTab";
import { resetNotesStore } from "../../lib/notes/store";
import { onShellRequest } from "../../shared/shellBus";

beforeEach(() => { resetMock(); resetIslandStore(); resetNotesStore(); setLanguage("en"); });
afterEach(() => { cleanup(); resetMock(); resetIslandStore(); resetNotesStore(); vi.restoreAllMocks(); });
it.each(["ru", "en"] as const)("%s: previews, creates by Enter, marks done, deletes and follows changes", async lang => {
  setLanguage(lang);
  render(<NotesTab />);
  const input = screen.getByRole("textbox", { name: t("reminders.new") });
  await screen.findByText(t("reminders.empty"));
  const messages: string[] = [];
  const stop = onShellRequest(req => { if (req.type === "toast") messages.push(req.text); });
  try {
    fireEvent.change(input, { target: { value: "tomorrow at 9 Meeting" } });
    expect(within(screen.getByRole("region", { name: t("reminders.title") })).getByRole("status")).toHaveTextContent("Meeting");
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("checkbox", { name: `${t("reminders.done")}: Meeting` });
    expect(input).toHaveValue("");
    expect(messages).toContain(t("reminders.created"));
    fireEvent.click(screen.getByRole("checkbox", { name: `${t("reminders.done")}: Meeting` }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: `${t("reminders.done")}: Meeting` })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: `${t("reminders.delete")}: Meeting` }));
    await screen.findByText(t("reminders.empty"));
  } finally { stop(); }
});
it("rejects incomplete input, displays save failures, and keeps the phrase", async () => {
  render(<Reminders />);
  await screen.findByText(t("reminders.empty"));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "tomorrow at 9" } });
  expect(screen.getByRole("button", { name: t("reminders.create") })).toBeDisabled();
  fireEvent.change(input, { target: { value: "tomorrow at 9 Work" } });
  vi.spyOn(ipc, "invoke").mockRejectedValue(new Error("failed"));
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(t("reminders.error"));
  expect(input).toHaveValue("tomorrow at 9 Work");
});
it("does not load/listen when disabled, releases on disable, restores on enable", async () => {
  const settings = useIslandStore.getState().settings;
  useIslandStore.getState().applySettings({ ...settings, disabledFeatures: ["notes"] });
  const spy = vi.spyOn(ipc, "invoke");
  const view = render(<Reminders />);
  expect(view.container).toBeEmptyDOMElement(); expect(spy).not.toHaveBeenCalled();
  act(() => useIslandStore.getState().applySettings(settings));
  await waitFor(() => expect(mockListenerCount("reminders://changed")).toBe(1));
  act(() => useIslandStore.getState().applySettings({ ...settings, disabledFeatures: ["notes"] }));
  expect(mockListenerCount("reminders://changed")).toBe(0);
  expect(view.container).toBeEmptyDOMElement();
});
