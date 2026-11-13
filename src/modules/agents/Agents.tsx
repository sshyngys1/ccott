import { IconTerminal } from "../../design/icons";
import { useT } from "../../i18n";
import { activityLabel, useAgents } from "./store";
import "./agents.css";

export function AgentsPill() {
  const sessions = useAgents();
  useT();
  const waiting = sessions.find(s => s.state === "waiting");
  if (!waiting) return null;
  return <div className="ig-pill-row ig-agent-pill" role="status"><IconTerminal size={16} /><span>{activityLabel(waiting)}</span></div>;
}
export function AgentBadge() {
  const t = useT();
  const sessions = useAgents();
  if (!sessions.some(s => s.state === "working")) return null;
  return <span className="ig-agent-badge" role="img" aria-label={t("agents.working")} title={t("agents.working")}><IconTerminal size={14} /></span>;
}
