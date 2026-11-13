import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import { CommandBar } from "./CommandBar";

beforeEach(() => { resetMock(); resetIslandStore(); setLanguage("en"); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); resetMock(); resetIslandStore(); vi.restoreAllMocks(); });
it.each(["напомни через 20 минут позвонить маме", "remind me in 2 hours to Call Mom"])("previews %s and Enter creates exactly once", async phrase => {
  const close = vi.fn(); const spy = vi.spyOn(ipc, "invoke");
  render(<CommandBar onClose={close} />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: phrase } });
  expect(screen.getByRole("option")).toHaveTextContent(/I'll remind you/);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls.filter(([cmd]) => cmd === "reminders_add")).toHaveLength(1);
  expect(await ipc.invoke("reminders_list")).toHaveLength(1);
  expect(useIslandStore.getState().toast?.label).toBe(t("reminders.created"));
});
it("Shift+Enter creates a reminder; Esc clears before closing", async () => {
  const close = vi.fn(); render(<CommandBar onClose={close} />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "remind me tomorrow at 9 Call" } });
  fireEvent.keyDown(input, { key: "Escape" }); expect(input).toHaveValue(""); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "remind me tomorrow at 9 Call" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  expect(await ipc.invoke("reminders_list")).toHaveLength(1);
});
it("disabled notes removes the preview and Enter cannot create", async () => {
  useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["notes"] });
  render(<CommandBar onClose={vi.fn()} />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "remind me in 2 hours to Call" } });
  expect(screen.queryByText(/I'll remind you/)).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await ipc.invoke("reminders_list")).toHaveLength(0);
});
