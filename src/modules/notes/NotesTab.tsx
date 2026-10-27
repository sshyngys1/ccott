import { useEffect, type KeyboardEvent } from "react";
import { useNotesStore } from "../../lib/notes/store";
import "../../lib/ui.css";
import { FolderChips } from "./FolderChips";
import { NoteEditor } from "./NoteEditor";
import { NoteList } from "./NoteList";
import { TimerCard } from "./TimerCard";
import "./notes.css";

export function NotesTab() {
  useEffect(() => {
    void useNotesStore.getState().load();
    // Unsaved typing must not be lost when the panel collapses or another tab opens.
    return () => {
      void useNotesStore.getState().flush();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      useNotesStore.getState().newNote();
    }
  };

  return (
    <div className="nt-root" onKeyDown={onKeyDown}>
      <h2 className="mod-sr-only">Заметки</h2>
      <FolderChips />
      <NoteList />
      <NoteEditor />
      <TimerCard />
    </div>
  );
}
