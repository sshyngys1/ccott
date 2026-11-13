import { t } from "../../i18n";
// Owner: F2 (Frontend-Modules). «Буфер»: clipboard history with search, pinning and paste.
import { IconClipboard } from "../../design/icons";
import type { IslandModule } from "../../shared/types";
import { deferredScreen } from "../../lib/deferredScreen";

export const clipboardScreen = deferredScreen(() =>
  import("./ClipboardTab").then((module) => ({ default: module.ClipboardTab })),
);

const clipboard: IslandModule = {
  id: "clipboard",
  get title() { return t("clipboardAlt"); },
  icon: IconClipboard,
  Tab: clipboardScreen.Screen,
  order: 1,
};
export default clipboard;
