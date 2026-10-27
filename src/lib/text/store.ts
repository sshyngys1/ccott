// State of the «Текст» tab. Kept in a store so switching tabs does not lose the text or the undo history.
import { create } from "zustand";
import { applyToRange, type TransformId } from "./transforms";

export const HISTORY_LIMIT = 20;

export interface TextStore {
  text: string;
  /** Error of the last transform (text is left untouched). Any manual edit clears it. */
  error: string | null;
  /** Last applied transform (highlighted until the text is edited by hand). */
  last: TransformId | null;
  history: string[];
  /** The clipboard prefill is offered once per session. */
  prefilled: boolean;
  /** Range to re-select after the text was replaced (consumed by the view). */
  selection: [number, number] | null;

  /** Manual edit in the textarea. */
  edit: (text: string) => void;
  /** Applies a transform to the selection (start < end) or to the whole text. */
  apply: (id: TransformId, start: number, end: number) => void;
  undo: () => void;
  /** Sets the text from outside (clipboard prefill) without touching history. */
  prefill: (text: string) => void;
  markPrefilled: () => void;
  clearSelection: () => void;
}

export const useTextStore = create<TextStore>()((set, get) => ({
  text: "",
  error: null,
  last: null,
  history: [],
  prefilled: false,
  selection: null,

  edit: (text) => set({ text, error: null, last: null, selection: null }),

  apply: (id, start, end) => {
    const { text, history } = get();
    if (!text) return;
    const r = applyToRange(id, text, start, end);
    if (!r.ok) {
      set({ error: r.error, last: id, selection: null });
      return;
    }
    set({
      text: r.text,
      error: null,
      last: id,
      selection: r.selection,
      // A transform that changed nothing does not litter the undo history.
      history: r.text === text ? history : [...history.slice(-(HISTORY_LIMIT - 1)), text],
    });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    set({ text: history[history.length - 1], history: history.slice(0, -1), error: null, last: null, selection: null });
  },

  prefill: (text) => set({ text, error: null, last: null, selection: null }),
  markPrefilled: () => set({ prefilled: true }),
  clearSelection: () => set({ selection: null }),
}));

/** Tests. */
export function resetTextStore(): void {
  useTextStore.setState({ text: "", error: null, last: null, history: [], prefilled: false, selection: null });
}
