import { t } from "../../i18n";
// Owner: F2 (Frontend-Modules). «Текст»: in-place text transforms (layout, translit, case, whitespace, JSON, Base64).
import { IconText } from "../../design/icons";
import type { IslandModule } from "../../shared/types";
import { TextTab } from "./TextTab";

const text: IslandModule = { id: "text", get title() { return t("text"); }, icon: IconText, Tab: TextTab, order: 2 };
export default text;
