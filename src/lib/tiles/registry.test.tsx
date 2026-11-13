import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { NotesTab } from "../../modules/notes/NotesTab";
import { resetIslandStore, useIslandStore } from "../../store";
import { resetNotesStore, useNotesStore } from "../notes/store";
import { resetTimerStore, useTimerStore } from "../timer/store";
import { TILE_REGISTRY } from "./registry";

beforeEach(() => {
  resetMock();
  resetIslandStore();
  resetNotesStore();
  resetTimerStore();
});
afterEach(() => {
  resetNotesStore();
  resetTimerStore();
  vi.restoreAllMocks();
});

it("opens the screenshots folder through the existing IPC wrapper", async () => {
  const invoke = vi.spyOn(ipc, "invoke");
  await TILE_REGISTRY.screenshots.action({});
  expect(invoke).toHaveBeenCalledExactlyOnceWith("capture_open_folder");
});

it("selects Clipboard without calling IPC", () => {
  const invoke = vi.spyOn(ipc, "invoke");
  TILE_REGISTRY.clipboard.action({});
  expect(useIslandStore.getState().activeTab).toBe("clipboard");
  expect(invoke).not.toHaveBeenCalled();
});

it("opens a blank note before the lazy tab loads and keeps it selected after loading", async () => {
  await TILE_REGISTRY.note.action({});
  expect(useIslandStore.getState().activeTab).toBe("notes");
  expect(useNotesStore.getState().selected).toBe("new");
  render(<NotesTab />);
  await waitFor(() => expect(useNotesStore.getState().loaded).toBe(true));
  const editor = screen.getByRole("textbox", { name: "Текст заметки" });
  expect(editor).toHaveTextContent("");
  expect(editor).toHaveFocus();
  expect(useNotesStore.getState().selected).toBe("new");
});

it("preserves an unfinished draft when the shortcut creates a fresh empty note", async () => {
  useNotesStore.getState().newNote();
  useNotesStore.getState().edit("<p>Keep this draft</p>");
  await TILE_REGISTRY.note.action({});
  await useNotesStore.getState().flush();
  expect(useNotesStore.getState().notes.some((n) => n.body === "<p>Keep this draft</p>")).toBe(true);
  expect(useNotesStore.getState().selected).toBe("new");
  render(<NotesTab />);
  expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveTextContent("");
});

it("focuses the timer after tab mount, consumes the request, and never starts it", async () => {
  await TILE_REGISTRY.timer.action({});
  expect(useIslandStore.getState().activeTab).toBe("notes");
  expect(useNotesStore.getState().timerFocusRequested).toBe(true);
  render(<NotesTab />);
  await waitFor(() => expect(screen.getByRole("region", { name: "Таймер" })).toHaveFocus());
  expect(useNotesStore.getState().timerFocusRequested).toBe(false);
  expect(useTimerStore.getState().timer.status).toBe("idle");
  // A repeated request while mounted also moves focus back to the timer.
  act(() => screen.getByRole("button", { name: "Старт" }).focus());
  await act(async () => { await TILE_REGISTRY.timer.action({}); });
  expect(screen.getByRole("region", { name: "Таймер" })).toHaveFocus();
});
