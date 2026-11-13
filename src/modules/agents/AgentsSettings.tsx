import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { invoke } from "../../ipc";
import type { AgentHooksStatus, AgentTool } from "../../shared/types";

export function AgentsSettings() {
  const t = useT();
  const [status, setStatus] = useState<AgentHooksStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const load = () => { setError(""); void invoke("agents_hooks_status").then(setStatus, () => setError(t("agents.statusError"))); };
  useEffect(load, []);
  const change = async (tool: AgentTool, installed: boolean) => {
    setPending(true); setError("");
    try { setStatus(await invoke("agents_set_hooks", { tool, installed })); }
    catch (error) { setError(t("agents.configError", { message: String(error) })); }
    finally { setPending(false); }
  };
  return <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-agents">
    <h4 id="ig-set-agents" className="ig-section-label ig-settings-label">{t("agents.title")}</h4>
    <p className="ig-settings-foot">{t("agents.privacy")}</p>
    {(["claude-code", "codex"] as const).map(tool => {
      const item = status?.[tool === "codex" ? "codex" : "claudeCode"];
      return <div className="ig-setting-row" key={tool}>
        <span className="ig-setting-row__label"><span className="ig-setting-row__title">{tool === "codex" ? "Codex" : "Claude Code"}</span>
          <span className="ig-setting-row__desc">{item ? `${t(item.installed ? "agents.found" : "agents.notFound")} · ${t(item.hooksInstalled ? "agents.hooksInstalled" : "agents.noHooks")}` : t("agents.loading")}</span>
          <span className="ig-setting-row__desc">{t(tool === "codex" ? "agents.codexHint" : "agents.claudeHint")}</span>
        </span>
        <button type="button" className="ig-glass-control ig-glass-control--sm" disabled={pending || !item?.installed} aria-label={t(item?.hooksInstalled ? "agents.disconnectTool" : "agents.connectTool", { tool: tool === "codex" ? "Codex" : "Claude Code" })} onClick={() => void change(tool, !item?.hooksInstalled)}>{t(item?.hooksInstalled ? "agents.disconnect" : "agents.connect")}</button>
      </div>;
    })}
    {error && <p className="ig-settings-foot" role="alert">{error} <button type="button" className="ig-glass-control ig-glass-control--sm" onClick={load}>{t("agents.retry")}</button></p>}
  </section>;
}
