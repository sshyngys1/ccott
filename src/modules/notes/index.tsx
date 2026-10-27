// Owner: F2 (Frontend-Modules). «Заметки»: folders, rich notes with autosave, timer. compact = timer in the pill.
import { IconNote } from "../../design/icons";
import { useIsTimerActive } from "../../lib/timer/store";
import type { IslandModule } from "../../shared/types";
import { NotesTab } from "./NotesTab";
import { TimerPill } from "./TimerPill";

const notes: IslandModule = {
  id: "notes",
  title: "Заметки",
  icon: IconNote,
  Tab: NotesTab,
  // Above the media activity (10), spec §6.7.
  compact: { useIsActive: useIsTimerActive, priority: 20, View: TimerPill },
  order: 3,
};
export default notes;
