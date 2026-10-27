import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { AUTOSAVE_DEBOUNCE_MS, SAVE_RETRY_MS, hasPendingEdit, resetNotesStore, useNotesStore } from "./store";

const S = () => useNotesStore.getState();

beforeEach(async () => {
  resetMock();
  resetNotesStore();
  await S().load();
});
afterEach(() => {
  resetNotesStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("notes store: loading and selection", () => {
  it("loads once, newest first, and selects the first note", async () => {
    const spy = vi.spyOn(ipc, "invoke");
    await Promise.all([S().load(), S().load()]);
    expect(spy).not.toHaveBeenCalled(); // already loaded in beforeEach
    expect(S().notes.map((n) => n.title)).toEqual(["Идеи для острова", "План на неделю", "Список покупок"]);
    expect(S().selected).toBe(S().notes[0].id);
  });

  it("selecting a folder keeps the selection if it is still visible, otherwise jumps to the first note", () => {
    S().selectFolder("Работа");
    expect(S().notes.find((n) => n.id === S().selected)?.folder).toBe("Работа");
    S().selectFolder("Нет такой");
    expect(S().selected).toBeNull();
    S().selectFolder(null);
    expect(S().selected).toBe(S().notes[0].id); // nothing selected → the first visible note
  });

  it("addFolder adds a chip once (case-insensitive) and selects it", () => {
    S().addFolder("  Дом ");
    expect(S().extraFolders).toEqual(["Дом"]);
    expect(S().folder).toBe("Дом");
    S().addFolder("дом");
    expect(S().extraFolders).toEqual(["Дом"]);
    S().addFolder("работа");
    expect(S().folder).toBe("Работа");
    S().addFolder("   ");
    expect(S().folder).toBe("Работа");
  });
});

describe("notes store: autosave", () => {
  it("debounces edits (600 ms) into one notes_save with a sanitized body and a derived title", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const id = S().selected as number;
    const spy = vi.spyOn(ipc, "invoke");
    S().edit("<p>Привет</p>");
    S().edit("<h3>Новый заголовок</h3><p>текст</p><script>alert(1)</script>");
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    const calls = spy.mock.calls.filter((c) => c[0] === "notes_save");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ note: { id, folder: "Заметка", title: "Новый заголовок", body: "<h3>Новый заголовок</h3><p>текст</p>" } });
    expect(S().save.state).toBe("saved");
    expect(S().notes.find((n) => n.id === id)?.title).toBe("Новый заголовок");
    expect(S().notes[0].id).toBe(id); // bumped to the top
  });

  it("the status goes saving → saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let release!: () => void;
    const real = ipc.invoke;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) =>
      cmd === "notes_save" ? new Promise((r) => (release = () => r(real(cmd as never, args)))) : real(cmd as never, args)) as never);
    S().edit("<p>x</p>");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(S().save.state).toBe("saving");
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(S().save.state).toBe("saved");
    expect(S().save.at).not.toBeNull();
  });

  it("flush() saves immediately (tab unmount / switching notes)", async () => {
    S().edit("<p>срочно</p>");
    expect(hasPendingEdit()).toBe(true);
    await S().flush();
    expect(hasPendingEdit()).toBe(false);
    expect(S().notes[0].title).toBe("срочно");
  });

  it("switching notes flushes the previous one and bodyOf serves unsaved text", async () => {
    const first = S().notes[0].id;
    const second = S().notes[1].id;
    S().edit("<p>черновик</p>");
    S().select(second);
    expect(S().selected).toBe(second);
    expect(S().bodyOf(first)).toContain("черновик"); // either still in flight or already stored
    await S().flush();
    expect(S().bodyOf(first)).toBe("<p>черновик</p>");
  });

  it("a new note is only created on the first non-empty edit, in the current folder", async () => {
    S().selectFolder("Работа");
    const before = S().notes.length;
    S().newNote();
    expect(S().selected).toBe("new");
    S().edit("<p><br></p>");
    await S().flush();
    expect(S().notes).toHaveLength(before); // empty draft is never saved
    S().edit("<p>Первая строка</p>");
    await S().flush();
    expect(S().notes).toHaveLength(before + 1);
    const created = S().notes.find((n) => n.title === "Первая строка");
    expect(created?.folder).toBe("Работа");
    expect(S().selected).toBe(created?.id);
  });

  it("typing while the first save of a new note is in flight updates the same note (no duplicates)", async () => {
    const real = ipc.invoke;
    let release!: () => void;
    let held = true;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) =>
      cmd === "notes_save" && held
        ? new Promise((r) => {
            release = () => r(real(cmd as never, args));
            held = false;
          })
        : real(cmd as never, args)) as never);
    const before = S().notes.length;
    S().newNote();
    S().edit("<p>а</p>");
    const first = S().flush();
    await Promise.resolve();
    S().edit("<p>аб</p>");
    release();
    await first;
    await S().flush();
    expect(S().notes).toHaveLength(before + 1);
    expect(S().notes.find((n) => n.body === "<p>аб</p>")).toBeDefined();
  });

  it("a failed save shows the error state and the next edit retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = ipc.invoke;
    let fail = true;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) =>
      cmd === "notes_save" && fail ? Promise.reject(new Error("disk")) : real(cmd as never, args)) as never);
    S().edit("<p>a</p>");
    await S().flush();
    expect(S().save.state).toBe("error");
    fail = false;
    S().edit("<p>ab</p>");
    await S().flush();
    expect(S().save.state).toBe("saved");
    expect(S().notes.some((n) => n.body === "<p>ab</p>")).toBe(true);
  });
});

describe("notes store: retry and lifecycle", () => {
  it("retries after 2, 5 and 15 seconds, then saves successfully", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = ipc.invoke;
    let attempts = 0;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: never) => {
      if (cmd === "notes_save" && ++attempts <= 3) return Promise.reject(new Error("disk"));
      return real(cmd as never, args);
    }) as never);
    S().edit("<p>не потерять</p>");
    await S().flush();
    expect(attempts).toBe(1);
    for (const [index, delay] of SAVE_RETRY_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(attempts).toBe(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(index + 2);
    }
    expect(S().save.state).toBe("saved");
    expect(S().notes[0].body).toBe("<p>не потерять</p>");
    expect(hasPendingEdit()).toBe(false);
  });

  it("newer typing replaces the failed body and cancels its outdated retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = ipc.invoke;
    const spy = vi.spyOn(ipc, "invoke").mockRejectedValueOnce(new Error("disk"));
    S().edit("<p>старое</p>");
    await S().flush();
    spy.mockImplementation(real);
    S().edit("<p>новое</p>");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(30_000);
    const saves = spy.mock.calls.filter((c) => c[0] === "notes_save");
    expect(saves).toHaveLength(2);
    expect(saves[1][1]).toMatchObject({ note: { body: "<p>новое</p>" } });
    expect(S().notes[0].body).toBe("<p>новое</p>");
  });

  it("retains a failed edit when another note is edited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [first, second] = S().notes;
    const real = ipc.invoke;
    let fail = true;
    vi.spyOn(ipc, "invoke").mockImplementation(((cmd: string, args: { note?: { id: number } }) =>
      cmd === "notes_save" && args.note?.id === first.id && fail ? Promise.reject(new Error("disk")) : real(cmd as never, args as never)) as never);
    S().edit("<p>первый черновик</p>");
    await S().flush();
    S().select(second.id);
    S().edit("<p>второй черновик</p>");
    await S().flush();
    fail = false;
    await S().flush();
    expect(S().notes.find((n) => n.id === first.id)?.body).toBe("<p>первый черновик</p>");
    expect(S().notes.find((n) => n.id === second.id)?.body).toBe("<p>второй черновик</p>");
  });

  it.each(["pagehide", "beforeunload", "hidden"])("flushes pending edits on %s", async (event) => {
    const spy = vi.spyOn(ipc, "invoke");
    S().edit("<p>сохранить перед уходом</p>");
    if (event === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    } else window.dispatchEvent(new Event(event));
    expect(spy).toHaveBeenCalledWith("notes_save", expect.objectContaining({ note: expect.objectContaining({ body: "<p>сохранить перед уходом</p>" }) }));
    await S().flush();
    expect(hasPendingEdit()).toBe(false);
  });

  it("reset cancels a scheduled retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(ipc, "invoke").mockRejectedValue(new Error("disk"));
    S().edit("<p>черновик</p>");
    await S().flush();
    resetNotesStore();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("notes store: delete", () => {
  it("removes the note and selects the next visible one", async () => {
    const [a, b] = S().notes;
    await S().remove();
    expect(S().notes.find((n) => n.id === a.id)).toBeUndefined();
    expect(S().selected).toBe(b.id);
  });

  it("deleting the last note leaves nothing selected", async () => {
    for (let i = 0; i < 3; i++) await S().remove();
    expect(S().notes).toEqual([]);
    expect(S().selected).toBeNull();
  });

  it("an unsaved edit of the deleted note is dropped, not resurrected", async () => {
    S().edit("<p>не нужно</p>");
    await S().remove();
    await S().flush();
    expect(S().notes.some((n) => n.body.includes("не нужно"))).toBe(false);
  });

  it("discarding an empty draft just selects another note", async () => {
    S().newNote();
    await S().remove();
    expect(S().selected).toBe(S().notes[0].id);
  });
});
