import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { AUTOSAVE_DEBOUNCE_MS, resetNotesStore, useNotesStore } from "../../lib/notes/store";
import { MINUTE_MS } from "../../lib/timer/machine";
import { resetTimerStore, useTimerStore } from "../../lib/timer/store";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import { NotesTab } from "./NotesTab";
import notes from "./index";
import { TimerPill } from "./TimerPill";

const editor = () => screen.getByRole("textbox", { name: "Текст заметки" });

beforeEach(() => {
  resetMock();
  resetNotesStore();
  resetTimerStore();
});
afterEach(() => {
  cleanup();
  resetNotesStore();
  resetTimerStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Simulates typing: replaces the editor HTML like the browser does, then fires `input`. */
function typeHtml(html: string) {
  editor().innerHTML = html;
  fireEvent.input(editor());
}

async function mountNotes() {
  render(<NotesTab />);
  await screen.findAllByRole("option");
}

describe("module definition", () => {
  it("timer activity outranks media", () => {
    expect(notes.compact?.priority).toBe(20);
  });
});

describe("Notes tab: list, folders, editor", () => {
  it("shows chips with counts, the list and the first note in the editor", async () => {
    await mountNotes();
    expect(screen.getByRole("heading", { name: "Заметки" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Все3", "Заметка2", "Работа1"]);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(editor().textContent).toContain("Блик за курсором");
    expect(screen.getByRole("option", { name: /Идеи для острова/ })).toHaveAttribute("aria-current", "true");
    expect(editor()).toHaveAttribute("contenteditable", "true");
  });

  it("selecting a folder filters the list", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("tab", { name: /Работа/ }));
    expect(screen.getByRole("tab", { name: /Работа/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("План на неделю", { selector: ".ig-list-row__title" })).toBeInTheDocument();
    expect(editor().textContent).toContain("Собрать каркас");
  });
  it("folder tabs have one Tab stop and arrows/Home/End select and move focus", async () => {
    await mountNotes();
    const tabs = within(screen.getByRole("tablist", { name: "Папки" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[2]).toHaveFocus();
    expect(useNotesStore.getState().folder).toBe("Работа");
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0]).toHaveFocus();
  });

  it("clicking another note loads it", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("option", { name: /Список покупок/ }));
    expect(editor().textContent).toContain("Молоко");
  });

  it("adds a folder through the inline input (Enter) and selects it", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("button", { name: "Новая папка" }));
    const input = screen.getByRole("textbox", { name: "Название новой папки" });
    fireEvent.change(input, { target: { value: "Дом" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("tab", { name: /Дом/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Пока пусто")).toBeInTheDocument();
    expect(editor()).toHaveAttribute("contenteditable", "false");
    expect(screen.getByText("Нет заметки")).toBeInTheDocument();
  });

  it("Escape in the folder input is default-prevented (the shell would collapse) and cancels", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("button", { name: "Новая папка" }));
    const input = screen.getByRole("textbox", { name: "Название новой папки" });
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Название новой папки" })).toBeNull();
  });
});

describe("Notes tab: sanitizing", () => {
  it("never renders script, event handlers or javascript: links from a stored body", async () => {
    await ipc.invoke("notes_save", {
      note: {
        id: 1,
        folder: "Заметка",
        title: "evil",
        body: '<p onclick="window.__pwned=1">текст</p><script>window.__pwned=1</script><img src=x onerror="window.__pwned=1"><a href="javascript:window.__pwned=1">ссылка</a><b>жирный</b>',
      },
    });
    await mountNotes();
    const html = editor().innerHTML;
    expect(html).toContain("<b>жирный</b>");
    expect(html).toContain("текст");
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("sanitizes again before saving (a polluted editor is cleaned in storage)", async () => {
    await mountNotes();
    const spy = vi.spyOn(ipc, "invoke");
    typeHtml('<p>ok</p><img src=x onerror="alert(1)"><script>alert(2)</script>');
    await useNotesStore.getState().flush();
    const call = spy.mock.calls.find((c) => c[0] === "notes_save");
    expect((call?.[1] as { note: { body: string } }).note.body).toBe("<p>ok</p>");
  });

  it("links in the editor are not followed", async () => {
    await ipc.invoke("notes_save", { note: { id: 1, folder: "Заметка", title: "l", body: '<p><a href="https://example.com">site</a></p>' } });
    await mountNotes();
    const link = editor().querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(fireEvent.click(link)).toBe(false); // default prevented
  });
});

describe("Notes tab: autosave", () => {
  it("typing is saved after the debounce, the status goes saving → saved", async () => {
    await mountNotes();
    const spy = vi.spyOn(ipc, "invoke");
    typeHtml("<p>Новый текст заметки</p>");
    expect(spy.mock.calls.filter((c) => c[0] === "notes_save")).toHaveLength(0);
    await waitFor(() => expect(spy.mock.calls.filter((c) => c[0] === "notes_save")).toHaveLength(1), { timeout: AUTOSAVE_DEBOUNCE_MS + 1500 });
    expect(await screen.findByText(/^Сохранено · \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(await screen.findByText("Новый текст заметки", { selector: ".ig-list-row__title" })).toBeInTheDocument();
  });

  it("closing the tab flushes the unsaved edit", async () => {
    await mountNotes();
    typeHtml("<p>успей сохранить</p>");
    cleanup();
    await waitFor(() => expect(useNotesStore.getState().notes[0].title).toBe("успей сохранить"));
  });

  it("«+» starts a new note in the selected folder; it is created on the first input", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("tab", { name: /Работа/ }));
    fireEvent.click(screen.getByRole("button", { name: "Новая заметка" }));
    expect(editor().innerHTML).toBe("");
    expect(editor()).toHaveFocus();
    expect(useNotesStore.getState().notes).toHaveLength(3);
    typeHtml("<p>Брифинг</p>");
    await useNotesStore.getState().flush();
    const created = useNotesStore.getState().notes.find((n) => n.title === "Брифинг");
    expect(created?.folder).toBe("Работа");
  });

  it("Ctrl+N creates a note", async () => {
    await mountNotes();
    fireEvent.keyDown(editor(), { key: "n", ctrlKey: true });
    expect(useNotesStore.getState().selected).toBe("new");
  });

  it("delete needs a confirming second click", async () => {
    await mountNotes();
    fireEvent.click(screen.getByRole("button", { name: "Удалить заметку" }));
    expect(useNotesStore.getState().notes).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить удаление заметки" }));
    await waitFor(() => expect(useNotesStore.getState().notes).toHaveLength(2));
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

describe("Notes tab: checklist", () => {
  it("clicking the checkbox area toggles an item without moving the caret", async () => {
    await ipc.invoke("notes_save", {
      note: { id: 1, folder: "Заметка", title: "c", body: '<ul data-type="checklist"><li>молоко</li><li data-checked="true">кофе</li></ul>' },
    });
    await mountNotes();
    const [milk, coffee] = Array.from(editor().querySelectorAll("li"));
    expect(milk).not.toHaveAttribute("data-checked");
    expect(fireEvent.mouseDown(milk, { clientX: 4 })).toBe(false); // default prevented → caret stays
    expect(milk).toHaveAttribute("data-checked", "true");
    fireEvent.mouseDown(coffee, { clientX: 4 });
    expect(coffee).not.toHaveAttribute("data-checked");
    await useNotesStore.getState().flush();
    expect(useNotesStore.getState().notes.find((n) => n.id === 1)?.body).toContain('<li data-checked="true">молоко</li>');
  });

  it("a click on the text area of an item does not toggle it", async () => {
    await ipc.invoke("notes_save", { note: { id: 1, folder: "Заметка", title: "c", body: '<ul data-type="checklist"><li>молоко</li></ul>' } });
    await mountNotes();
    const li = editor().querySelector("li") as HTMLElement;
    fireEvent.mouseDown(li, { clientX: 100 });
    expect(li).not.toHaveAttribute("data-checked");
  });
});

describe("Notes tab: timer card", () => {
  it("idle → running → paused → reset, with presets and +1 мин", async () => {
    await mountNotes();
    const card = screen.getByRole("region", { name: "Таймер" });
    expect(within(card).getByText("05:00")).toBeInTheDocument();
    expect(within(card).getByText("Готов к запуску")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "10 мин" }));
    expect(within(card).getByText("10:00")).toBeInTheDocument();
    expect(within(card).getByText("из 10 мин")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "10 мин" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(card).getByRole("button", { name: "Старт" }));
    expect(within(card).getByText("Идёт")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Пауза" }));
    expect(within(card).getByText("Пауза")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "+1 мин" }));
    expect(within(card).getByText("из 11 мин")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Сбросить" }));
    expect(within(card).getByText("Готов к запуску")).toBeInTheDocument();
    expect(within(card).getByText("из 11 мин")).toBeInTheDocument();
  });

  it("finishing shows «Время вышло» and a green card; start repeats the interval", async () => {
    await mountNotes();
    const card = screen.getByRole("region", { name: "Таймер" });
    fireEvent.click(within(card).getByRole("button", { name: "1 мин" }));
    fireEvent.click(within(card).getByRole("button", { name: "Старт" }));
    act(() => {
      useTimerStore.setState({ timer: { ...useTimerStore.getState().timer, startedAt: Date.now() - MINUTE_MS - 10 } });
    });
    await waitFor(() => expect(within(card).getByText("Готово")).toBeInTheDocument(), { timeout: 3000 });
    expect(within(card).getByText("Время вышло")).toBeInTheDocument();
    expect(card).toHaveClass("ig-glass-card--success");
    fireEvent.click(within(card).getByRole("button", { name: "Запустить снова" }));
    expect(within(card).getByText("Идёт")).toBeInTheDocument();
    expect(within(card).getByText("из 1 мин")).toBeInTheDocument();
  });

  it("keeps running after the tab is closed", async () => {
    render(<NotesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    cleanup();
    expect(useTimerStore.getState().timer.status).toBe("running");
    render(<NotesTab />);
    expect(screen.getByText("Идёт")).toBeInTheDocument();
  });
});

describe("timer pill (compact)", () => {
  it("running: ring, «Таймер», m:ss; click opens the Notes tab", () => {
    const requests: ShellRequest[] = [];
    const off = onShellRequest((r) => { requests.push(r); });
    try {
      useTimerStore.getState().selectPreset(3);
      useTimerStore.getState().toggle();
      render(<TimerPill />);
      expect(screen.getByText("Таймер")).toBeInTheDocument();
      expect(screen.getByText("3:00")).toBeInTheDocument();
      expect(document.querySelector(".ig-ring")).toHaveAttribute("data-state", "running");
      fireEvent.click(screen.getByRole("button"));
      expect(requests).toEqual([{ type: "openTab", tab: "notes" }]);
    } finally {
      off();
    }
  });

  it("paused state", () => {
    useTimerStore.getState().toggle();
    useTimerStore.getState().toggle();
    render(<TimerPill />);
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "paused");
  });

  it("done: «Время вышло», 0:00; the click acknowledges it", () => {
    useTimerStore.setState({
      timer: { status: "done", totalMs: MINUTE_MS, remainingMs: 0, startedAt: null, finishedAt: Date.now() },
      doneDismissed: false,
    });
    render(<TimerPill />);
    expect(screen.getByText("Время вышло")).toBeInTheDocument();
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "done");
    fireEvent.click(screen.getByRole("button"));
    expect(useTimerStore.getState().doneDismissed).toBe(true);
  });
});
