import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type MouseEvent } from "react";
import { IconBold, IconChecklist, IconItalic, IconListBullet, IconTrash } from "../../design/icons";
import { formatClockHM } from "../../lib/time/format";
import { sanitizeNoteHtml } from "../../lib/notes/sanitize";
import { useNotesStore, type SaveState } from "../../lib/notes/store";
import { useArmed } from "../../lib/useArmed";
import {
  NO_FORMATS,
  checklistItemAt,
  configureEditing,
  insertHtml,
  insertText,
  readFormats,
  toggleBold,
  toggleChecked,
  toggleChecklist,
  toggleItalic,
  toggleList,
  uncheckCurrentItem,
  type EditorFormats,
} from "./editorCommands";

const BTN = "ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm";

function statusOf(hasNote: boolean, isDraft: boolean, save: { state: SaveState; at: number | null }, updatedAt: number | null): { state: string; text: string } {
  if (!hasNote) return { state: "idle", text: "Нет заметки" };
  switch (save.state) {
    case "saving":
      return { state: "saving", text: "Сохранение…" };
    case "saved":
      return { state: "saved", text: `Сохранено · ${formatClockHM(save.at ?? Date.now())}` };
    case "error":
      return { state: "error", text: "Не сохранено" };
    default:
      if (isDraft || updatedAt === null) return { state: "idle", text: "Новая заметка" };
      return { state: "saved", text: `Сохранено · ${formatClockHM(updatedAt)}` };
  }
}

export function NoteEditor() {
  const selected = useNotesStore((s) => s.selected);
  const save = useNotesStore((s) => s.save);
  const updatedAt = useNotesStore((s) => (typeof s.selected === "number" ? (s.notes.find((n) => n.id === s.selected)?.updatedAt ?? null) : null));
  const ref = useRef<HTMLDivElement>(null);
  const [formats, setFormats] = useState<EditorFormats>(NO_FORMATS);
  const del = useArmed();

  const hasNote = selected !== null;

  // Put the (sanitized) body of the selected note into the editor. The DOM is the source of truth while typing,
  // so this runs only when the selection changes — never on every save.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = typeof selected === "number" ? sanitizeNoteHtml(useNotesStore.getState().bodyOf(selected)) : "";
    el.innerHTML = html;
    setFormats(NO_FORMATS);
    del.disarm();
    if (selected === "new") el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the selection should reload the editor
  }, [selected]);

  useEffect(() => {
    configureEditing();
  }, []);

  // Formats under the caret follow the selection.
  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      if (el && document.activeElement === el) setFormats(readFormats(el));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const changed = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    useNotesStore.getState().edit(el.innerHTML);
    setFormats(readFormats(el));
  }, []);

  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el && (e.nativeEvent as InputEvent).inputType === "insertParagraph") uncheckCurrentItem(el);
    changed();
  };

  const run = (fn: (root: HTMLElement) => unknown) => () => {
    const el = ref.current;
    if (!el || !hasNote) return;
    el.focus();
    fn(el);
    changed();
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const li = checklistItemAt(e.target, e.clientX);
    if (!li) return;
    e.preventDefault(); // do not move the caret when a checkbox is toggled
    toggleChecked(li);
    changed();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    // Never let foreign markup in: sanitized HTML, or plain text.
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const clean = html ? sanitizeNoteHtml(html) : "";
    if (clean.trim()) insertHtml(clean);
    else if (text) insertText(text);
    changed();
  };

  const stopDrop = (e: DragEvent<HTMLDivElement>) => e.preventDefault();

  const onDelete = () => {
    if (!del.armed) return del.arm();
    del.disarm();
    void useNotesStore.getState().remove();
  };

  const st = statusOf(hasNote, selected === "new", save, updatedAt);

  return (
    <div className="ig-field nt-editor">
      <div className="ig-field-bar ig-field-bar--header" role="toolbar" aria-label="Форматирование">
        {/* mousedown is cancelled so the editor keeps its selection while a button is pressed. */}
        <button type="button" className={BTN} aria-label="Жирный (Ctrl+B)" title="Жирный (Ctrl+B)" aria-pressed={formats.bold} disabled={!hasNote} onMouseDown={(e) => e.preventDefault()} onClick={run(() => toggleBold())}>
          <IconBold size={16} />
        </button>
        <button type="button" className={BTN} aria-label="Курсив (Ctrl+I)" title="Курсив (Ctrl+I)" aria-pressed={formats.italic} disabled={!hasNote} onMouseDown={(e) => e.preventDefault()} onClick={run(() => toggleItalic())}>
          <IconItalic size={16} />
        </button>
        <span className="ig-field-bar__sep" aria-hidden="true" />
        <button type="button" className={BTN} aria-label="Список" title="Список" aria-pressed={formats.list} disabled={!hasNote} onMouseDown={(e) => e.preventDefault()} onClick={run(toggleList)}>
          <IconListBullet size={16} />
        </button>
        <button type="button" className={BTN} aria-label="Чек-лист" title="Чек-лист" aria-pressed={formats.checklist} disabled={!hasNote} onMouseDown={(e) => e.preventDefault()} onClick={run(toggleChecklist)}>
          <IconChecklist size={16} />
        </button>
        <span className="ig-field-bar__spacer" />
        <span className="ig-status" data-state={st.state} role="status">
          {st.text}
        </span>
        <button
          type="button"
          className={`${BTN} ig-glass-control--danger nt-delete`}
          data-armed={del.armed ? true : undefined}
          aria-label={del.armed ? "Подтвердить удаление заметки" : "Удалить заметку"}
          title={del.armed ? "Нажмите ещё раз, чтобы удалить" : "Удалить заметку"}
          disabled={!hasNote}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
        >
          <IconTrash size={16} />
        </button>
      </div>
      <div
        ref={ref}
        className="ig-editor"
        contentEditable={hasNote}
        suppressContentEditableWarning
        data-placeholder={hasNote ? "Начните писать…" : "Создайте заметку слева"}
        role="textbox"
        aria-multiline="true"
        aria-label="Текст заметки"
        spellCheck
        onInput={onInput}
        onMouseDown={onMouseDown}
        onClick={(e) => {
          // Links are shown, never followed (a navigation would replace the whole app).
          if ((e.target as Element).closest("a")) e.preventDefault();
        }}
        onPaste={onPaste}
        onDrop={stopDrop}
        onDragOver={stopDrop}
      />
    </div>
  );
}
