import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import * as ipc from "../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { resetIslandStore, useIslandStore } from "../store";
import { playChime } from "../lib/timer/chime";
import { useToastSync } from "./useShellSync";
import { PillToast } from "./Island";

vi.mock("../lib/timer/chime", () => ({ playChime: vi.fn(), primeAudio: vi.fn() }));
function Harness() {
  useToastSync();
  const toast = useIslandStore(s => s.toast);
  return toast ? <PillToast {...toast} /> : null;
}
beforeEach(() => { resetMock(); resetIslandStore(); setLanguage("en"); vi.clearAllMocks(); });
afterEach(() => { cleanup(); resetMock(); resetIslandStore(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function mount() {
  const item = await ipc.invoke("reminders_add", { text: "Call Mom", dueAt: Date.now() + 3_600_000 });
  const view = render(<Harness />);
  await waitFor(() => expect(mockListenerCount("reminders://due")).toBe(1));
  return { item, view, fire: () => act(() => mockEmit("reminders://due", item)) };
}
it("shows due text, plays the timer chime and Done marks it complete", async () => {
  const { item, fire } = await mount(); fire();
  expect(screen.getByRole("status")).toHaveTextContent(item.text);
  expect(playChime).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: t("reminders.done") }));
  await waitFor(() => expect(useIslandStore.getState().toast).toBeNull());
  expect((await ipc.invoke("reminders_list"))[0].done).toBe(true);
});
it("Snooze schedules ten minutes from the click time", async () => {
  const { fire } = await mount(); fire();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  fireEvent.click(screen.getByRole("button", { name: t("reminders.snooze") }));
  await waitFor(() => expect(useIslandStore.getState().toast).toBeNull());
  expect((await ipc.invoke("reminders_list"))[0]).toMatchObject({ dueAt: now + 600_000, done: false });
});
it("queues simultaneous due events so both reminders get their own actionable toast", async () => {
  const { item, fire } = await mount();
  const second = await ipc.invoke("reminders_add", { text: "Second reminder", dueAt: item.dueAt });
  fire(); act(() => mockEmit("reminders://due", second));
  expect(screen.getByRole("status")).toHaveTextContent("Call Mom");
  fireEvent.click(screen.getByRole("button", { name: t("reminders.done") }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Second reminder"));
  fireEvent.click(screen.getByRole("button", { name: t("reminders.done") }));
  await waitFor(() => expect(useIslandStore.getState().toast).toBeNull());
  expect((await ipc.invoke("reminders_list")).every(r => r.done)).toBe(true);
});
it("DND suppresses sound but keeps the toast, including when toggled while visible", async () => {
  const { fire } = await mount();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, doNotDisturb: true }));
  fire();
  expect(screen.getByRole("button", { name: t("reminders.done") })).toBeVisible();
  expect(playChime).not.toHaveBeenCalled();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, doNotDisturb: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Call Mom");
});
it("disabling notes removes the toast and both listeners; late events do nothing", async () => {
  const { fire } = await mount(); fire();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["notes"] }));
  expect(mockListenerCount("reminders://due")).toBe(0); expect(mockListenerCount("reminders://changed")).toBe(0);
  expect(useIslandStore.getState().toast).toBeNull();
  fire(); expect(useIslandStore.getState().toast).toBeNull();
});
it("does not listen at all when notes starts disabled", async () => {
  useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["notes"] });
  render(<Harness />);
  await act(async () => {});
  expect(mockListenerCount("reminders://due")).toBe(0); expect(mockListenerCount("reminders://changed")).toBe(0);
});
it("releases a listener that resolves after unmount", async () => {
  const original = ipc.listen;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(ipc, "listen").mockImplementation(async (event, cb) => { const stop = await original(event, cb); if (event === "reminders://due") await gate; return stop; });
  const view = render(<Harness />);
  await waitFor(() => expect(mockListenerCount("reminders://due")).toBe(1));
  view.unmount();
  await act(async () => { release(); });
  expect(mockListenerCount("reminders://due")).toBe(0);
});
