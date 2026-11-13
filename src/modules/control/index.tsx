import { lazy } from "react";
import { t } from "../../i18n";
import type { IslandModule } from "../../shared/types";
import { IconControl } from "./icons";

// Loaded only on selection, so a disabled control feature never imports its UI or subscribes.
const Tab = lazy(() => import("./ControlTab").then(module => ({ default: module.ControlTab })));
const control: IslandModule = { id: "control", get title() { return t("control.title"); }, icon: IconControl, Tab, order: 6 };
export default control;
