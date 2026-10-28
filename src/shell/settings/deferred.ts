import { deferredScreen } from "../../lib/deferredScreen";

export const settingsScreen = deferredScreen(() =>
  import("./SettingsView").then((module) => ({ default: module.SettingsView })),
);
