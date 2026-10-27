// Owner: F1. Writes settings: optimistic in the store, then `settings_set`; the answer (or a re-read) is authoritative.
import { invoke } from "../../ipc";
import type { Settings } from "../../shared/types";
import { useIslandStore } from "../../store";

export async function patchSettings(patch: Partial<Settings>): Promise<string | null> {
  const before = useIslandStore.getState().settings;
  useIslandStore.getState().applySettings({ ...before, ...patch });
  try {
    useIslandStore.getState().applySettings(await invoke("settings_set", { patch }));
    return null;
  } catch (err) {
    // Rejected: show what the backend really has, or roll back when even that is unavailable.
    try {
      useIslandStore.getState().applySettings(await invoke("settings_get"));
    } catch {
      useIslandStore.getState().applySettings(before);
    }
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string" && err.trim()) return err;
    return "Не удалось сохранить настройку";
  }
}
