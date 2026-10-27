import { t } from "../../i18n";
// Owner: F2 (Frontend-Modules). «Главная»: player, volume, tool tiles (placeholders), dock; compact = now playing.
import { IconHome } from "../../design/icons";
import type { IslandModule } from "../../shared/types";
import { useIsMediaActive } from "../../lib/media/store";
import { HomeTab } from "./HomeTab";
import { MediaPill } from "./MediaPill";

const home: IslandModule = {
  id: "home",
  get title() { return t("home"); },
  icon: IconHome,
  Tab: HomeTab,
  // Lower than the timer (20), spec §6.7.
  compact: { useIsActive: useIsMediaActive, priority: 10, View: MediaPill },
  order: 0,
};
export default home;
