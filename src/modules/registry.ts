// Owner: F1 (Frontend-Shell). Adding a module = one import + one array entry.
import type { deferredScreen } from "../lib/deferredScreen";
import type { FeatureId, IslandModule } from "../shared/types";
import clipboard, { clipboardScreen } from "./clipboard";
import home from "./home";
import control from "./control";
import notes, { notesScreen } from "./notes";
import text, { textScreen } from "./text";
import shelf, { shelfScreen } from "./shelf";
import weather, { weatherScreen } from "./weather";
import agents, { agentsScreen } from "./agents";

type DeferredScreen = ReturnType<typeof deferredScreen>;

export const modules: IslandModule[] = [home, clipboard, text, notes, shelf, weather, control, agents].sort((a, b) => a.order - b.order);

export const deferredTabEntries: readonly { feature: FeatureId; screen: DeferredScreen }[] = [
  { feature: "clipboard", screen: clipboardScreen },
  { feature: "text", screen: textScreen },
  { feature: "notes", screen: notesScreen },
  { feature: "shelf", screen: shelfScreen },
  { feature: "weather", screen: weatherScreen },
  { feature: "agents", screen: agentsScreen },
];

export const deferredTabs = deferredTabEntries.map((entry) => entry.screen);
