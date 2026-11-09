import { useEffect } from "react";
import { create } from "zustand";
import { t } from "../../i18n";
import { invoke } from "../../ipc";
import { useFeatureEnabled } from "../../lib/features";
import { createEventSync } from "../../lib/ipcSync";
import type { AgentSession } from "../../shared/types";
import { showToast } from "../../shell/toast";
import { useIslandStore } from "../../store";

export const AGENTS_PRIORITY = 14; // media 10 < waiting < downloads 15
export const useAgentsStore = create<{ sessions: AgentSession[] }>(() => ({ sessions: [] }));
export const toolName = (session: Pick<AgentSession, "tool">) => session.tool === "codex" ? "Codex" : "Claude";
// Defensive at the presentation boundary: a mock or an older backend must not display a cwd.
export const projectName = (project: string) => project.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.slice(0, 120) ?? "";
export const activityLabel = (session: AgentSession) => t(session.state === "waiting" ? "agents.waitingActivity" : "agents.doneActivity", { tool: toolName(session), project: projectName(session.project) });
let agentToastId: number | undefined;

const sync = createEventSync({
  event: "agents://changed",
  load: () => invoke("agents_list"),
  apply: (sessions, source) => {
    const previous = useAgentsStore.getState().sessions;
    const transition = sessions.find(s => (s.state === "waiting" || s.state === "done") && previous.find(p => p.id === s.id)?.state !== s.state);
    useAgentsStore.setState({ sessions });
    if (source === "event" && transition) {
      const before = useIslandStore.getState().toast?.id;
      showToast({ label: activityLabel(transition) });
      const after = useIslandStore.getState().toast?.id;
      if (after !== before) agentToastId = after;
    }
  },
});
let consumers = 0;
export function useAgents(): AgentSession[] {
  const enabled = useFeatureEnabled("agents");
  useEffect(() => {
    if (!enabled) return;
    consumers++;
    void sync.init();
    return () => { if (--consumers === 0) resetAgents(); };
  }, [enabled]);
  const sessions = useAgentsStore(s => s.sessions);
  return enabled ? sessions : [];
}
export function resetAgents(): void {
  sync.reset();
  useAgentsStore.setState({ sessions: [] });
  const store = useIslandStore.getState();
  if (agentToastId !== undefined && store.toast?.id === agentToastId) store.setToast(null);
  agentToastId = undefined;
}
if (import.meta.hot) import.meta.hot.dispose(resetAgents);
