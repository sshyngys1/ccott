import { useEffect, useState } from "react";
import { IconCheck, IconClock, IconClose, IconTerminal, IconWarning } from "../../design/icons";
import { useT } from "../../i18n";
import { invoke } from "../../ipc";
import { useFeatureEnabled } from "../../lib/features";
import { requestShell } from "../../shared/shellBus";
import type { AgentHooksStatus, AgentState } from "../../shared/types";
import { saveSettingsSection } from "../../shell/settings/sections";
import { showToast } from "../../shell/toast";
import { projectName, toolName, useAgents } from "./store";
import "./agents.css";

const stateOrder: Record<AgentState, number> = { waiting: 0, working: 1, done: 2, error: 2 };
const stateIcon = { waiting: IconClock, working: IconTerminal, done: IconCheck, error: IconWarning };

export function AgentsTab() {
  const t = useT();
  const enabled = useFeatureEnabled("agents");
  const sessions = useAgents();
  const [now, setNow] = useState(Date.now);
  const [hooks, setHooks] = useState<AgentHooksStatus | null>(null);
  const [hooksFailed, setHooksFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const load = () => {
      void invoke("agents_hooks_status").then(status => {
        if (!disposed) { setHooks(status); setHooksFailed(false); }
      }, () => { if (!disposed) setHooksFailed(true); });
    };
    load();
    window.addEventListener("focus", load);
    return () => { disposed = true; window.removeEventListener("focus", load); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !sessions.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled, sessions.length]);
  if (!enabled) return null;

  const openSettings = () => {
    saveSettingsSection("agents");
    void requestShell({ type: "collapse" });
    void invoke("settings_window_open").catch(() => showToast({ label: t("agents.settingsError") }));
  };
  const connectButton = () => <button className="ig-glass-control ig-glass-control--sm" type="button" onClick={openSettings}>{t("agents.connectSettings")}</button>;
  const dismiss = async (id: string) => {
    try { await invoke("agents_dismiss", { id }); }
    catch { showToast({ label: t("agents.dismissError") }); }
  };
  const disconnected = hooks && !hooks.claudeCode.hooksInstalled && !hooks.codex.hooksInstalled;
  const ordered = [...sessions].sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return <section className="ig-agents" aria-label={t("agents.title")}>
    <h3 className="ig-section-label">{t("agents.title")}</h3>
    {disconnected && <div className="ig-agents-notice" role="status"><span>{t("agents.notConnected")}</span>{connectButton()}</div>}
    {hooksFailed && <p className="ig-agents-notice" role="alert">{t("agents.statusError")}</p>}
    {ordered.length ? <ul className="ig-agents-list ig-scroll" tabIndex={0} aria-label={t("agents.sessions")}>{ordered.map(session => {
      const StateIcon = stateIcon[session.state];
      return <li key={session.id} data-state={session.state}>
        <span className="ig-agent-state"><StateIcon size={16} /></span>
        <span className="ig-agent-copy"><strong title={`${toolName(session)} · ${projectName(session.project)}`}>{toolName(session)} · {projectName(session.project)}</strong>
          <small><span className="ig-agent-state">{t(`agents.${session.state}`)}</span> · {t("agents.minutesAgo", { minutes: Math.max(0, Math.floor((now - session.updatedAt) / 60_000)) })}</small></span>
        <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--sm" aria-label={t("agents.dismiss", { project: projectName(session.project) })} onClick={() => void dismiss(session.id)}><IconClose size={14} /></button>
      </li>;
    })}</ul> : <div className="ig-agents-empty"><p>{t("agents.empty")}</p>{!disconnected && connectButton()}</div>}
  </section>;
}
