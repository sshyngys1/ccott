// Owner: F2. Shared feature-flag selectors and helpers (contracts §23).
import type { FeatureId, ModuleId } from "../shared/types";
import { useIslandStore } from "../store";

export const TAB_FEATURES: readonly FeatureId[] = ["clipboard", "text", "notes", "shelf", "weather", "control", "agents"];

export const MODULE_FEATURE: Partial<Record<ModuleId, FeatureId>> = {
  clipboard: "clipboard",
  text: "text",
  notes: "notes",
  shelf: "shelf",
  control: "control",
  weather: "weather",
  agents: "agents",
};

export function isFeatureEnabled(
  id: FeatureId,
  disabledFeatures: readonly FeatureId[] = useIslandStore.getState().settings.disabledFeatures,
): boolean {
  return !disabledFeatures.includes(id);
}

export function isModuleEnabled(
  id: ModuleId,
  disabledFeatures: readonly FeatureId[] = useIslandStore.getState().settings.disabledFeatures,
): boolean {
  if (id === "home") return true;
  const feature = MODULE_FEATURE[id];
  return feature ? isFeatureEnabled(feature, disabledFeatures) : true;
}

export function useFeatureEnabled(id: FeatureId): boolean {
  return useIslandStore((s) => isFeatureEnabled(id, s.settings.disabledFeatures));
}

export function disableFeatureList(disabledFeatures: readonly FeatureId[], id: FeatureId): FeatureId[] {
  if (disabledFeatures.includes(id)) return [...disabledFeatures];
  return [...disabledFeatures, id];
}

export function enableFeatureList(disabledFeatures: readonly FeatureId[], id: FeatureId): FeatureId[] {
  return disabledFeatures.filter((f) => f !== id);
}

export function resetTabFeatures(disabledFeatures: readonly FeatureId[]): FeatureId[] {
  return disabledFeatures.filter((f) => !TAB_FEATURES.includes(f));
}
