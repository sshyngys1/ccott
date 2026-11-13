import { beforeEach, expect, it, vi } from "vitest";
import { invoke, listen } from "./index";
import { mockAgentConfig, mockAgentEvent, resetMock } from "./mock";
import { mockAgentsList } from "./agentsMock";
beforeEach(resetMock);

it("models event delivery, dismiss and disabling without retaining sessions", async () => {
  const events: unknown[] = [];
  const stop = await listen("agents://changed", s => events.push(s));
  try {
    mockAgentEvent({ id: "one", tool: "codex", project: "demo", state: "done", message: null, updatedAt: Date.now() });
    expect(await invoke("agents_list")).toHaveLength(1);
    await invoke("agents_dismiss", { id: "one" });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual([]);
    await invoke("settings_set", { patch: { disabledFeatures: ["agents"] } });
    mockAgentEvent({ id: "two", tool: "codex", project: "demo", state: "done", message: null, updatedAt: Date.now() });
    expect(await invoke("agents_list")).toEqual([]);
  } finally { stop(); }
});

it("prunes at injected 10 and 30 minute boundaries", () => {
  const now = Date.now();
  for (const state of ["done", "working"] as const) mockAgentEvent({ id: state, tool: "codex", project: "demo", state, message: null, updatedAt: now });
  expect(mockAgentsList(true, now + 10 * 60_000).map(s => s.state)).toEqual(["working"]);
  expect(mockAgentsList(true, now + 30 * 60_000)).toEqual([]);
});

it("emits expiry without another list request", async () => {
  vi.useFakeTimers();
  const events: unknown[] = [];
  const stop = await listen("agents://changed", sessions => events.push(sessions));
  try {
    mockAgentEvent({ id: "done", tool: "codex", project: "demo", state: "done", message: null, updatedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual([]);
  } finally { stop(); resetMock(); vi.useRealTimers(); }
});

it("updates only the selected tool and refuses foreign notify or malformed JSON", async () => {
  await invoke("agents_set_hooks", { tool: "claude-code", installed: true });
  const status = await invoke("agents_hooks_status");
  expect(status.claudeCode.hooksInstalled).toBe(true);
  expect(status.codex.hooksInstalled).toBe(false);
  mockAgentConfig.foreignCodexNotify = true;
  await expect(invoke("agents_set_hooks", { tool: "codex", installed: true })).rejects.toThrow("another tool");
  mockAgentConfig.invalidClaudeJson = true;
  await expect(invoke("agents_set_hooks", { tool: "claude-code", installed: false })).rejects.toThrow("Cannot parse");
  expect((await invoke("agents_hooks_status")).claudeCode.hooksInstalled).toBe(true);
});
