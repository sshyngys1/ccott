import type { AgentHooksStatus, AgentSession, AgentTool } from "../shared/types";

let sessions: AgentSession[] = [];
let hooks: AgentHooksStatus;
let expiry: ReturnType<typeof setTimeout> | null = null;
let changed: ((sessions: AgentSession[]) => void) | undefined;
function scheduleExpiry(): void {
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
  if (!sessions.length) return;
  const due = Math.min(...sessions.map(s => s.updatedAt + (s.state === "done" ? 10 : 30) * 60_000));
  expiry = setTimeout(() => {
    expiry = null;
    const before = sessions.length;
    const current = mockAgentsList(true);
    if (current.length !== before) changed?.(current);
  }, Math.max(1, due - Date.now()));
}
export function resetMockAgents(): void {
  sessions = [];
  changed = undefined;
  scheduleExpiry();
  hooks = { claudeCode: { installed: true, hooksInstalled: false }, codex: { installed: true, hooksInstalled: false } };
}
resetMockAgents();
export const mockAgentConfig = { foreignCodexNotify: false, invalidClaudeJson: false };
export const mockHooksStatus = () => structuredClone(hooks);
export function mockSetAgentTool(tool: AgentTool, installed: boolean): void { hooks[tool === "codex" ? "codex" : "claudeCode"] = { installed, hooksInstalled: false }; }
export function mockSetHooks(tool: AgentTool, installed: boolean): AgentHooksStatus {
  const item = hooks[tool === "codex" ? "codex" : "claudeCode"];
  if (!item.installed) throw new Error("Tool configuration folder was not found");
  if (tool === "codex" && installed && mockAgentConfig.foreignCodexNotify) throw new Error("Codex notify is already configured by another tool");
  if (tool === "claude-code" && mockAgentConfig.invalidClaudeJson) throw new Error("Cannot parse Claude settings.json; file was not changed");
  item.hooksInstalled = installed;
  return mockHooksStatus();
}
export function mockAgentsList(enabled: boolean, now = Date.now()): AgentSession[] {
  sessions = enabled ? sessions.filter(s => now - s.updatedAt < (s.state === "done" ? 10 : 30) * 60_000) : [];
  scheduleExpiry();
  return structuredClone(sessions);
}
export function mockAgentChange(session: AgentSession, emit: (sessions: AgentSession[]) => void): void {
  changed = emit;
  sessions = [structuredClone(session), ...sessions.filter(s => s.id !== session.id)].slice(0, 256);
  emit(mockAgentsList(true));
}
export function mockAgentDismiss(id: string, emit: (sessions: AgentSession[]) => void): void { sessions = sessions.filter(s => s.id !== id); changed = emit; scheduleExpiry(); emit(structuredClone(sessions)); }
