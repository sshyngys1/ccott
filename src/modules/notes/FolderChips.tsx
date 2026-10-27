import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { IconPlus } from "../../design/icons";
import { folderList } from "../../lib/notes/model";
import { useNotesStore } from "../../lib/notes/store";

export function FolderChips() {
  const notes = useNotesStore((s) => s.notes);
  const extra = useNotesStore((s) => s.extraFolders);
  const folder = useNotesStore((s) => s.folder);
  const { selectFolder, addFolder } = useNotesStore.getState();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const folders = useMemo(() => folderList(notes, extra), [notes, extra]);
  const tabs = [{ name: null, label: "Все", count: notes.length }, ...folders.map((f) => ({ ...f, label: f.name }))];
  const selected = Math.max(0, tabs.findIndex((tab) => tab.name === folder));
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    selectFolder(tabs[next].name);
    tabRefs.current[next]?.focus();
    tabRefs.current[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const finish = (commit: boolean) => {
    if (commit && draft.trim()) addFolder(draft);
    setAdding(false);
    setDraft("");
  };

  // The row scrolls sideways when the chips do not fit; the wheel scrolls it.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
  };

  return (
    <div className="nt-folders" onWheel={onWheel}>
      <div className="nt-folder-tabs" role="tablist" aria-label="Папки">
      {tabs.map((tab, index) => (
        <button key={tab.name ?? "all"} ref={(el) => { tabRefs.current[index] = el; }} type="button" className="ig-chip" role="tab" data-island-keyboard="true" aria-selected={folder === tab.name} tabIndex={index === selected ? 0 : -1} onClick={() => selectFolder(tab.name)} onKeyDown={(e) => onTabKey(e, index)}>
          {tab.label}
          <span className="ig-chip__count">{tab.count}</span>
        </button>
      ))}
      </div>
      {adding ? (
        <input
          ref={inputRef}
          className="ig-glass-input nt-folder-input"
          value={draft}
          maxLength={24}
          placeholder="Название папки"
          aria-label="Название новой папки"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              // preventDefault: otherwise the shell collapses the island.
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
        />
      ) : (
        <button type="button" className="ig-chip ig-chip--add" aria-label="Новая папка" title="Новая папка" onClick={() => setAdding(true)}>
          <IconPlus size={14} />
        </button>
      )}
    </div>
  );
}
