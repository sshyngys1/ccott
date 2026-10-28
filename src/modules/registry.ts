// Owner: F1 (Frontend-Shell). Adding a module = one import + one array entry.
import type { IslandModule } from "../shared/types";
import clipboard, { clipboardScreen } from "./clipboard";
import home from "./home";
import notes, { notesScreen } from "./notes";
import text, { textScreen } from "./text";

export const modules: IslandModule[] = [home, clipboard, text, notes].sort((a, b) => a.order - b.order);

export const deferredTabs = [clipboardScreen, textScreen, notesScreen];
