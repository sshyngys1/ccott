// DOM helpers for the rich-text editor. `document.execCommand` is deprecated but remains the only built-in way to edit
// contenteditable content with native undo/redo; WebView2 (Chromium) supports it fully.

/** Number of CSS px at the left edge of a checklist item that toggles it (spec §6.6). */
export const CHECKBOX_HIT_PX = 22;

export type EditorFormats = { bold: boolean; italic: boolean; list: boolean; checklist: boolean };
export const NO_FORMATS: EditorFormats = { bold: false, italic: false, list: false, checklist: false };

function selectionElement(root: HTMLElement): Element | null {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node || !root.contains(node)) return null;
  return node instanceof Element ? node : node.parentElement;
}

/** Formats under the caret. */
export function readFormats(root: HTMLElement): EditorFormats {
  const el = selectionElement(root);
  if (!el) return NO_FORMATS;
  const ul = el.closest("ul");
  const state = (cmd: string): boolean => {
    try {
      return typeof document.queryCommandState === "function" && document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const inChecklist = ul?.getAttribute("data-type") === "checklist";
  return { bold: state("bold"), italic: state("italic"), list: !!ul && !inChecklist, checklist: !!ul && inChecklist };
}

function editCommand(command: string, value?: string): boolean {
  try {
    return typeof document.execCommand === "function" && document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/** Once per editor: Enter creates <p> (not <div>), formatting uses <b>/<i> instead of inline styles. */
export function configureEditing(): void {
  editCommand("defaultParagraphSeparator", "p");
  editCommand("styleWithCSS", "false");
}

export const toggleBold = (): boolean => editCommand("bold");
export const toggleItalic = (): boolean => editCommand("italic");

/** Bullet list on/off. A checklist is converted to a plain list instead of being removed. */
export function toggleList(root: HTMLElement): void {
  const ul = selectionElement(root)?.closest("ul");
  if (ul?.getAttribute("data-type") === "checklist") {
    ul.removeAttribute("data-type");
    for (const li of Array.from(ul.querySelectorAll("li"))) li.removeAttribute("data-checked");
    return;
  }
  editCommand("insertUnorderedList");
}

/** Checklist on/off: a bullet list with data-type="checklist". */
export function toggleChecklist(root: HTMLElement): void {
  let ul = selectionElement(root)?.closest("ul") ?? null;
  if (ul?.getAttribute("data-type") === "checklist") {
    editCommand("insertUnorderedList"); // removes the list
    return;
  }
  if (!ul) {
    editCommand("insertUnorderedList");
    ul = selectionElement(root)?.closest("ul") ?? null;
  }
  ul?.setAttribute("data-type", "checklist");
}

/** The checklist item whose checkbox area was hit by a click at `clientX`, or null. */
export function checklistItemAt(target: EventTarget | null, clientX: number): HTMLLIElement | null {
  if (!(target instanceof Element)) return null;
  const li = target.closest("li");
  if (!li || li.parentElement?.getAttribute("data-type") !== "checklist") return null;
  return clientX - li.getBoundingClientRect().left < CHECKBOX_HIT_PX ? (li as HTMLLIElement) : null;
}

export function toggleChecked(li: HTMLElement): void {
  if (li.hasAttribute("data-checked")) li.removeAttribute("data-checked");
  else li.setAttribute("data-checked", "true");
}

/** A new checklist item created by Enter must start unchecked (the browser clones the attribute). */
export function uncheckCurrentItem(root: HTMLElement): void {
  selectionElement(root)?.closest("li")?.removeAttribute("data-checked");
}

export function insertHtml(html: string): boolean {
  return editCommand("insertHTML", html);
}
export function insertText(text: string): boolean {
  return editCommand("insertText", text);
}
