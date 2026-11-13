import { IconTerminal } from "../../design/icons";
import { t } from "../../i18n";
import { deferredScreen } from "../../lib/deferredScreen";
import type { IslandModule } from "../../shared/types";

export const agentsScreen = deferredScreen(() => import("./AgentsTab").then(m => ({ default: m.AgentsTab })));
const agents: IslandModule = {
  id: "agents", get title() { return t("agents.title"); }, icon: IconTerminal,
  Tab: agentsScreen.Screen, order: 7,
};
export default agents;
