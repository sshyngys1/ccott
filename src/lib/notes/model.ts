// Pure helpers for the notes tab: titles, folders, filtering.
import type { Note } from "../../shared/types";

export const DEFAULT_FOLDER = "Заметка";
/** The «Все» chip is not a real folder. */
export const ALL_FOLDERS = null;
export type FolderFilter = string | null;
export const MAX_FOLDER_NAME = 24;
export const MAX_TITLE = 80;

const BLOCK_SELECTOR = "p, h3, li, div";

function parse(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html; // inert: a <template>'s content never runs scripts or loads resources
  return tpl.content;
}

/** Plain text of a note body, blocks separated by newlines. */
export function htmlToText(html: string): string {
  if (!html) return "";
  const frag = parse(html);
  for (const br of Array.from(frag.querySelectorAll("br"))) br.replaceWith("\n");
  for (const block of Array.from(frag.querySelectorAll(BLOCK_SELECTOR))) block.append("\n");
  return (frag.textContent ?? "").replace(/ /g, " ");
}

/** Title = the first non-empty line of the text (max 80 chars). Empty body → "". */
export function deriveTitle(html: string): string {
  const first = htmlToText(html)
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return "";
  return first.length > MAX_TITLE ? first.slice(0, MAX_TITLE - 1).trimEnd() + "…" : first;
}

/** true when the body has no visible text (an empty editor leaves `<p><br></p>` and the like). */
export function isEmptyBody(html: string): boolean {
  return htmlToText(html).trim() === "";
}

export interface FolderInfo {
  name: string;
  count: number;
}

/** Folder chips after «Все»: the default folder, every folder used by a note and the locally added ones, sorted (ru). */
export function folderList(notes: readonly Note[], extra: readonly string[] = []): FolderInfo[] {
  const counts = new Map<string, number>([[DEFAULT_FOLDER, 0]]);
  for (const name of extra) if (!counts.has(name)) counts.set(name, 0);
  for (const n of notes) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function filterNotes(notes: readonly Note[], folder: FolderFilter): Note[] {
  return notes.filter((n) => folder === ALL_FOLDERS || n.folder === folder);
}

/** Newest first. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
}

/** Trim, collapse spaces, cut to 24 chars. Returns null for an empty name. */
export function normalizeFolderName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME).trim();
  return name || null;
}

/** Existing folder with the same name (case-insensitive), so «работа» does not duplicate «Работа». */
export function findFolder(names: readonly string[], name: string): string | undefined {
  const lower = name.toLocaleLowerCase("ru");
  return names.find((n) => n.toLocaleLowerCase("ru") === lower);
}

/** Label for the title of a list row. */
export function noteListTitle(n: { title: string }): string {
  return n.title.trim() || "Без названия";
}
