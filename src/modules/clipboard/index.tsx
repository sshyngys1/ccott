// Owner: F2 (Frontend-Modules). «Буфер»: clipboard history with search, pinning and paste.
import { IconClipboard } from "../../design/icons";
import type { IslandModule } from "../../shared/types";
import { ClipboardTab } from "./ClipboardTab";

const clipboard: IslandModule = { id: "clipboard", title: "Буфер", icon: IconClipboard, Tab: ClipboardTab, order: 1 };
export default clipboard;
