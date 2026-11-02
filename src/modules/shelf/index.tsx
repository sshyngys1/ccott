import { t } from "../../i18n";
import type { IslandModule } from "../../shared/types";
import { IconShelf } from "./IconShelf";
import { deferredScreen } from "../../lib/deferredScreen";
const shelfScreen = deferredScreen(() => import("./ShelfTab").then(module => ({ default: module.ShelfTab })));
const shelf: IslandModule = { id: "shelf", get title() { return t("shelf.title"); }, icon: IconShelf, Tab: shelfScreen.Screen, order: 4 };
export default shelf;
