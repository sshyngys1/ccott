// Notes state: list, folders, selection and debounced autosave. Lives in a store (not in the tab component) so an
// unsaved edit is flushed even when the tab unmounts, and a half-saved note re-opens with its latest text.
import { create } from "zustand";
import { invoke } from "../../ipc";
import type { Note } from "../../shared/types";
import { ALL_FOLDERS, DEFAULT_FOLDER, deriveTitle, filterNotes, findFolder, folderList, isEmptyBody, normalizeFolderName, sortNotes, type FolderFilter } from "./model";
import { sanitizeNoteHtml } from "./sanitize";

export const AUTOSAVE_DEBOUNCE_MS = 600;
export const SAVE_RETRY_MS = [2000, 5000, 15000] as const;

export type SaveState = "idle" | "saving" | "saved" | "error";
/** A note id, or "new" for a note that has not been written to the backend yet (created on the first non-empty edit). */
export type Selection = number | "new" | null;

export interface NotesStore {
  notes: Note[];
  loaded: boolean;
  folder: FolderFilter;
  /** Folders added in the UI that have no notes yet. */
  extraFolders: string[];
  selected: Selection;
  save: { state: SaveState; at: number | null };

  load: () => Promise<void>;
  selectFolder: (folder: FolderFilter) => void;
  addFolder: (rawName: string) => void;
  select: (id: number) => void;
  newNote: () => void;
  /** Called on every editor input with the editor's current HTML. */
  edit: (html: string) => void;
  /** Saves pending edits now (tab unmounts, switching notes). */
  flush: () => Promise<void>;
  remove: () => Promise<void>;
  /** Latest text of a note, including edits that have not reached the backend yet. */
  bodyOf: (id: number) => string;
}

interface Pending {
  selection: Selection;
  token: number;
  folder: string;
  html: string;
  failures: number;
  dueAt: number;
}

const pending = new Map<string, Pending>();
const pendingKey = (p: Pick<Pending, "selection" | "token">) => p.selection === "new" ? `draft:${p.token}` : `note:${p.selection}`;
let debounce: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let draining: Promise<void> | null = null;
let generation = 0;
/** Bumped by newNote(): ties a "new" selection to the draft that created it. */
let draftToken = 0;
/** Latest HTML per note id that is not yet confirmed by the backend. */
const unsaved = new Map<number, string>();
let loading: Promise<void> | null = null;

function clearDebounce(): void {
  if (debounce !== null) clearTimeout(debounce);
  debounce = null;
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  clearRetry();
  if (!pending.size) return;
  const at = Math.min(...[...pending.values()].map((p) => p.dueAt));
  retryTimer = setTimeout(() => { retryTimer = null; void startDrain(false); }, Math.max(0, at - Date.now()));
}

function startDrain(force: boolean): Promise<void> {
  if (draining) return draining;
  if (!pending.size) return Promise.resolve();
  clearRetry();
  const gen = generation;
  draining = drain(force, gen).finally(() => {
    if (gen !== generation) return;
    draining = null;
    scheduleRetry();
  });
  return draining;
}

export const useNotesStore = create<NotesStore>()((set, get) => ({
  notes: [],
  loaded: false,
  folder: ALL_FOLDERS,
  extraFolders: [],
  selected: null,
  save: { state: "idle", at: null },

  load: () => {
    if (get().loaded) return Promise.resolve();
    loading ??= invoke("notes_list")
      .then((list) => {
        const notes = sortNotes(list);
        const visible = filterNotes(notes, get().folder);
        set({ notes, loaded: true, selected: get().selected ?? visible[0]?.id ?? null });
      })
      .catch((err: unknown) => console.warn("[island] notes_list failed", err))
      .finally(() => {
        loading = null;
      });
    return loading;
  },

  selectFolder: (folder) => {
    const { selected, notes } = get();
    set({ folder });
    if (selected === "new") return;
    const visible = filterNotes(notes, folder);
    const current = visible.find((n) => n.id === selected);
    if (!current) {
      void get().flush();
      set({ selected: visible[0]?.id ?? null, save: { state: "idle", at: null } });
    }
  },

  addFolder: (rawName) => {
    const name = normalizeFolderName(rawName);
    if (!name) return;
    const { notes, extraFolders } = get();
    const known = folderList(notes, extraFolders).map((f) => f.name);
    const existing = findFolder(known, name);
    if (!existing) set({ extraFolders: [...extraFolders, name] });
    get().selectFolder(existing ?? name);
  },

  select: (id) => {
    if (get().selected === id) return;
    void get().flush();
    set({ selected: id, save: { state: "idle", at: null } });
  },

  newNote: () => {
    if (get().selected === "new") return; // already an empty draft
    void get().flush();
    draftToken++;
    set({ selected: "new", save: { state: "idle", at: null } });
  },

  edit: (html) => {
    const { selected, folder, notes } = get();
    if (selected === null) return;
    const noteFolder = selected === "new" ? (folder ?? DEFAULT_FOLDER) : (notes.find((n) => n.id === selected)?.folder ?? DEFAULT_FOLDER);
    if (typeof selected === "number") unsaved.set(selected, html);
    const edit = { selection: selected, token: draftToken, folder: noteFolder, html, failures: 0, dueAt: Date.now() + AUTOSAVE_DEBOUNCE_MS };
    pending.set(pendingKey(edit), edit);
    clearDebounce();
    debounce = setTimeout(() => { debounce = null; void startDrain(false); }, AUTOSAVE_DEBOUNCE_MS);
  },

  flush: () => {
    clearDebounce();
    return startDrain(true);
  },

  remove: async () => {
    const { selected, notes, folder } = get();
    if (selected === null) return;
    clearDebounce();
    const key = pendingKey({ selection: selected, token: draftToken });
    pending.delete(key);
    if (draining) await draining.catch(() => {});
    pending.delete(key); // an in-flight failed save may have put this edit back
    scheduleRetry();
    if (selected === "new") {
      draftToken++;
      set({ selected: filterNotes(notes, folder)[0]?.id ?? null, save: { state: "idle", at: null } });
      return;
    }
    unsaved.delete(selected);
    try {
      await invoke("notes_delete", { id: selected });
    } catch (err) {
      console.warn("[island] notes_delete failed", err);
      set({ save: { state: "error", at: null } });
      return;
    }
    const rest = get().notes.filter((n) => n.id !== selected);
    const visible = filterNotes(rest, get().folder);
    set({ notes: rest, selected: get().selected === selected ? (visible[0]?.id ?? null) : get().selected, save: { state: "idle", at: null } });
  },

  bodyOf: (id) => unsaved.get(id) ?? get().notes.find((n) => n.id === id)?.body ?? "",
}));

async function drain(force: boolean, gen: number): Promise<void> {
  const { setState: set, getState: get } = useNotesStore;
  const attempted = new Set<string>();
  while (gen === generation) {
    const entry = [...pending.entries()].find(([key, p]) => !attempted.has(key) && (force || p.dueAt <= Date.now()));
    if (!entry) break;
    const [key, p] = entry;
    attempted.add(key);
    pending.delete(key);
    const body = sanitizeNoteHtml(p.html);
    if (p.selection === "new" && isEmptyBody(body)) {
      // Nothing worth creating yet.
      if (get().selected === "new" && !pending.size) set({ save: { state: "idle", at: null } });
      continue;
    }
    set({ save: { state: "saving", at: null } });
    try {
      const id = p.selection === "new" ? null : p.selection;
      const saved = await invoke("notes_save", { note: { id, folder: p.folder, title: deriveTitle(body), body } });
      if (gen !== generation) return;
      const notes = sortNotes([...get().notes.filter((n) => n.id !== saved.id), saved]);
      let selected = get().selected;
      if (p.selection === "new") {
        if (p.token === draftToken && selected === "new") selected = saved.id;
        // Edits typed while the first save was in flight belong to the note that now exists.
        const next = pending.get(key);
        if (next && next.selection === "new" && next.token === p.token) {
          pending.delete(key);
          next.selection = saved.id;
          pending.set(pendingKey(next), next);
          unsaved.set(saved.id, next.html);
        }
      }
      if (typeof p.selection === "number" && unsaved.get(p.selection) === p.html) unsaved.delete(p.selection);
      const failed = [...pending.values()].some((edit) => edit.failures > 0);
      set({ notes, selected, save: { state: failed ? "error" : pending.size ? "saving" : "saved", at: Date.now() } });
    } catch (err) {
      if (gen !== generation) return;
      console.warn("[island] notes_save failed", err);
      // Keep separate notes/drafts queued; newer typing for this note wins over the failed body.
      const latest = pending.get(key) ?? p;
      latest.failures = p.failures + 1;
      latest.dueAt = Date.now() + SAVE_RETRY_MS[Math.min(latest.failures - 1, SAVE_RETRY_MS.length - 1)];
      pending.set(key, latest);
      set({ save: { state: "error", at: null } });
    }
  }
}

/** Tests. */
export function resetNotesStore(): void {
  generation++;
  clearDebounce();
  clearRetry();
  pending.clear();
  draining = null;
  loading = null;
  draftToken = 0;
  unsaved.clear();
  useNotesStore.setState({ notes: [], loaded: false, folder: ALL_FOLDERS, extraFolders: [], selected: null, save: { state: "idle", at: null } });
}

/** Number of edits waiting for the debounce / a save (tests). */
export function hasPendingEdit(): boolean {
  return pending.size > 0;
}

// Flush while the WebView still has an opportunity to send IPC (also when the tab is not mounted).
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const flush = () => { void useNotesStore.getState().flush(); };
  const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", onVisibility);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", flush);
    document.removeEventListener("visibilitychange", onVisibility);
    clearRetry();
    clearDebounce();
  });
}
