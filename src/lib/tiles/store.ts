import { create } from "zustand";

export interface TilesEditState {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

export const useTilesEditStore = create<TilesEditState>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
