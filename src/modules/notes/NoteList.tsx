import { t, useT } from "../../i18n";
import { useMemo, useRef, type KeyboardEvent } from "react";
import { IconNote, IconPlus } from "../../design/icons";
import { useScrollFade } from "../../design/useScrollFade";
import { filterNotes, folderDisplayName, noteListTitle, sortNotes } from "../../lib/notes/model";
import { useNotesStore } from "../../lib/notes/store";
import { formatNoteStamp } from "../../lib/time/format";
import { useNow } from "../../lib/useNow";

export function NoteList() {
  useT();
  const notes = useNotesStore((s) => s.notes);
  const folder = useNotesStore((s) => s.folder);
  const selected = useNotesStore((s) => s.selected);
  const { select, newNote } = useNotesStore.getState();
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollFade(scrollRef);

  const visible = useMemo(() => sortNotes(filterNotes(notes, folder)), [notes, folder]);
  const draft = selected === "new";
  const empty = visible.length === 0 && !draft;

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(visible[index].id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = visible[index + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      select(next.id);
      (e.currentTarget.parentElement?.children[index + (e.key === "ArrowDown" ? 1 : -1) + (draft ? 1 : 0)] as HTMLElement | undefined)?.focus();
    }
  };

  return (
    <section className="ig-glass-card nt-list" aria-label={t("notes")}>
      <div className="nt-list-head">
        <span className="ig-section-label mod-label-flush">{folder === null ? t("allNotes") : folderDisplayName(folder)}</span>
        <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label={t("newNote")} title={t("newNoteCtrlN")} onClick={newNote}>
          <IconPlus size={16} />
        </button>
      </div>
      {empty ? (
        <div className="ig-empty nt-empty">
          <span className="ig-empty__icon">
            <IconNote size={20} />
          </span>
          <span className="ig-empty__title">{t("nothingHereYet")}</span>
          <span className="ig-empty__text">{t("clickToCreateANote")}</span>
        </div>
      ) : (
        <div ref={scrollRef} className="ig-scroll ig-scroll-fade mod-fill">
          <ul className="ig-list" role="listbox" aria-label={t("noteList")}>
            {draft && (
              <li className="ig-list-row ig-list-row--compact" role="option" aria-selected={false} aria-current="true">
                <span className="ig-list-row__body">
                  <span className="ig-list-row__title nt-list-title">{t("newNote")}</span>
                  <span className="ig-list-row__meta">{folder === null ? t("note") : folderDisplayName(folder)}</span>
                </span>
              </li>
            )}
            {visible.map((n, i) => (
              <li
                key={n.id}
                className="ig-list-row ig-list-row--compact"
                role="option"
                tabIndex={0}
                aria-selected={false}
                aria-current={n.id === selected ? "true" : undefined}
                onClick={() => select(n.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                <span className="ig-list-row__body">
                  <span className="ig-list-row__title nt-list-title">{noteListTitle(n)}</span>
                  <span className="ig-list-row__meta">
                    {formatNoteStamp(n.updatedAt, now)} · {folderDisplayName(n.folder)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
