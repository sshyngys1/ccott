// Owner: F1. Ephemeral UI state for tab strip edit mode (mirrors `useTilesEditStore`).
import { create } from "zustand";

export interface TabsEditState {
  editing: boolean;
  menuOpen: boolean;
  setEditing: (editing: boolean) => void;
  setMenuOpen: (menuOpen: boolean) => void;
}

export const useTabsEditStore = create<TabsEditState>((set) => ({
  editing: false,
  menuOpen: false,
  setEditing: (editing) => set({ editing }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));

export function resetTabsEditStore(): void {
  useTabsEditStore.setState({ editing: false, menuOpen: false });
}
