import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import { invoke } from "../../ipc";
import * as ipc from "../../ipc";
import { mockAgentConfig, mockAgentEvent, mockEmit, mockListenerCount, mockSetAgentTool, mockStartDownload, resetMock } from "../../ipc/mock";
import type { AgentSession } from "../../shared/types";
import { Island } from "../../shell/Island";
import { SettingsWindow } from "../../shell/settings/SettingsWindow";
import { SETTINGS_SECTION_KEY } from "../../shell/settings/sections";
import { ControlTab } from "../control/ControlTab";
import { resetIslandStore, useIslandStore } from "../../store";
import { resetAgents } from "./store";
import { AgentBadge, AgentsPill } from "./Agents";
import { AgentsTab } from "./AgentsTab";
import { AgentsSettings } from "./AgentsSettings";

const session = (state: AgentSession["state"], tool: AgentSession["tool"] = "claude-code"): AgentSession => ({ id: "one", tool, project: "project", state, message: "private notification", updatedAt: Date.now() });
beforeEach(async () => { resetMock(); resetIslandStore(); resetAgents(); await invoke("settings_set", { patch: { language: "en" } }); useIslandStore.getState().applySettings(await invoke("settings_get")); setLanguage("en"); localStorage.removeItem(SETTINGS_SECTION_KEY); });
afterEach(() => { cleanup(); resetAgents(); resetIslandStore(); vi.restoreAllMocks(); });

it("shares one subscription, announces transitions once and suppresses toasts in DND", async () => {
  await invoke("agents_set_hooks", { tool: "codex", installed: true });
  const view = render(<><AgentsPill /><AgentBadge /><AgentsTab /></>);
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(1));
  act(() => mockAgentEvent(session("working")));
  expect(screen.getByRole("img", { name: t("agents.working") })).toBeInTheDocument();
  expect(useIslandStore.getState().toast).toBeNull();
  act(() => mockAgentEvent(session("waiting")));
  expect(screen.getByRole("status")).toHaveTextContent("Claude needs input · project");
  const toast = useIslandStore.getState().toast;
  expect(toast?.label).toBe("Claude needs input · project");
  act(() => mockAgentEvent(session("waiting")));
  expect(useIslandStore.getState().toast).toBe(toast);
  act(() => useIslandStore.setState({ doNotDisturb: true, toast: null }));
  act(() => mockAgentEvent(session("done", "codex")));
  expect(useIslandStore.getState().toast).toBeNull();
  expect(screen.getByText("Codex · project")).toBeInTheDocument();
  act(() => mockAgentEvent(session("waiting")));
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(useIslandStore.getState().toast).toBeNull();
  expect(screen.queryByText("private notification")).toBeNull();
  view.unmount();
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(0));
});

it.each(["ru", "en"] as const)("lists sessions in Agents in %s with folder only and dismiss", async language => {
  setLanguage(language);
  mockAgentEvent({ ...session("working"), project: "C:\\private\\folder", updatedAt: Date.now() - 120_000 });
  render(<AgentsTab />);
  const region = await screen.findByRole("region", { name: t("agents.title") });
  expect(await within(region).findByText("Claude · folder")).toBeInTheDocument();
  expect(region).toHaveTextContent(t("agents.minutesAgo", { minutes: 2 }));
  expect(region).not.toHaveTextContent("private");
  const spy = vi.spyOn(ipc, "invoke");
  fireEvent.click(within(region).getByRole("button", { name: t("agents.dismiss", { project: "folder" }) }));
  expect(await within(region).findByText(t("agents.empty"))).toBeInTheDocument();
  expect(await invoke("agents_list")).toEqual([]);
  expect(spy).toHaveBeenCalledWith("agents_dismiss", { id: "one" });
});

it("orders waiting before working before completed/error, with recent sessions first in each group", async () => {
  const now = Date.now();
  for (const [id, state, age] of [
    ["waiting-old", "waiting", 2000], ["done", "done", 3000], ["working", "working", 0],
    ["waiting-new", "waiting", 1000], ["error", "error", 1000],
  ] as const) mockAgentEvent({ ...session(state), id, project: id, updatedAt: now - age });
  render(<AgentsTab />);
  const list = await screen.findByRole("list", { name: t("agents.sessions") });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
  expect(within(list).getAllByRole("listitem").map(row => row.querySelector("strong")?.textContent)).toEqual([
    "Claude · waiting-new", "Claude · waiting-old", "Claude · working", "Claude · error", "Claude · done",
  ]);
  expect(within(list).getAllByRole("listitem").every(row => row.querySelector(".ig-agent-state svg"))).toBe(true);
});

it.each(["ru", "en"] as const)("%s: shows empty/disconnected states and opens the Agents settings section", async language => {
  setLanguage(language);
  const spy = vi.spyOn(ipc, "invoke");
  render(<AgentsTab />);
  expect(screen.getByText(t("agents.empty"))).toBeInTheDocument();
  expect(await screen.findByRole("status")).toHaveTextContent(t("agents.notConnected"));
  fireEvent.click(screen.getByRole("button", { name: t("agents.connectSettings") }));
  expect(localStorage.getItem(SETTINGS_SECTION_KEY)).toBe("agents");
  await waitFor(() => expect(spy).toHaveBeenCalledWith("settings_window_open"));
});

it("shows a connect action beside existing sessions when disconnected and refreshes hook status on focus", async () => {
  mockAgentEvent(session("working"));
  render(<AgentsTab />);
  const notice = await screen.findByRole("status");
  expect(within(notice).getByRole("button", { name: t("agents.connectSettings") })).toBeInTheDocument();
  await invoke("agents_set_hooks", { tool: "codex", installed: true });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByText(t("agents.notConnected"))).toBeNull());
  expect(screen.getByText("Claude · project")).toBeInTheDocument();
});

it("keeps a connected empty list helpful without a disconnected notice", async () => {
  await invoke("agents_set_hooks", { tool: "claude-code", installed: true });
  render(<AgentsTab />);
  await act(async () => {});
  expect(screen.queryByText(t("agents.notConnected"))).toBeNull();
  expect(screen.getByText(t("agents.empty"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: t("agents.connectSettings") })).toBeInTheDocument();
});

it("does not render sessions or subscribe to agents in Control", async () => {
  mockAgentEvent(session("waiting"));
  render(<ControlTab />);
  await screen.findByRole("button", { name: t("control.wifi"), pressed: true });
  expect(screen.queryByRole("region", { name: t("agents.title") })).toBeNull();
  expect(mockListenerCount("agents://changed")).toBe(0);
});

it("does no IPC work when Agents is initially disabled", async () => {
  useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["agents"] });
  const spy = vi.spyOn(ipc, "invoke");
  const view = render(<AgentsTab />);
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
  expect(spy).not.toHaveBeenCalled();
  expect(mockListenerCount("agents://changed")).toBe(0);
});

it("hides the active Agents tab, releases subscriptions and restores the tab on enable", async () => {
  render(<Island />);
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(1));
  act(() => { useIslandStore.getState().setMode("expanded"); useIslandStore.getState().setActiveTab("agents"); });
  expect(await screen.findByRole("heading", { name: t("agents.title") })).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(8);
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["agents"] }));
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(0));
  expect(useIslandStore.getState().activeTab).toBe("home");
  expect(screen.queryByRole("tab", { name: t("agents.title") })).toBeNull();
  expect(screen.queryByRole("heading", { name: t("agents.title") })).toBeNull();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: [] }));
  expect(await screen.findByRole("tab", { name: t("agents.title") })).toBeInTheDocument();
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(1));
});

it("keeps working as a badge beside media, waiting above media, downloads and toast above waiting", async () => {
  render(<Island />);
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(1));
  await screen.findByRole("button", { name: /Открыть плеер|Open player/ });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Открыть плеер|Open player/ })).toHaveLength(1));
  act(() => mockAgentEvent(session("working")));
  await waitFor(() => expect(screen.getAllByRole("img", { name: t("agents.working") })).toHaveLength(1));
  expect(screen.getByRole("button", { name: /Открыть плеер|Open player/ })).toBeInTheDocument();
  act(() => mockAgentEvent(session("waiting")));
  await waitFor(() => expect(screen.getAllByRole("status").some(el => el.textContent?.includes("Claude needs input · project"))).toBe(true));
  act(() => useIslandStore.getState().setToast(null));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Открыть плеер|Open player/ })).toBeNull());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Claude needs input · project"));
  act(() => mockStartDownload(20));
  await waitFor(() => expect(screen.queryByText("Claude needs input · project")).toBeNull());
});

it("releases all agent UI and subscriptions on disable and reloads on enable", async () => {
  render(<><AgentsPill /><AgentBadge /><AgentsTab /></>);
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(1));
  act(() => mockAgentEvent(session("waiting")));
  expect(useIslandStore.getState().toast).not.toBeNull();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["agents"] }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByRole("region")).toBeNull();
  await waitFor(() => expect(mockListenerCount("agents://changed")).toBe(0));
  expect(useIslandStore.getState().toast).toBeNull();
  act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: [] }));
  await screen.findByRole("status");
});

it.each(["ru", "en"] as const)("connects and disconnects both tools in %s settings with backup explanation", async language => {
  setLanguage(language);
  render(<AgentsSettings />);
  await screen.findByRole("button", { name: t("agents.connectTool", { tool: "Claude Code" }) });
  for (const tool of ["Claude Code", "Codex"]) {
    const connect = screen.getByRole("button", { name: t("agents.connectTool", { tool }) });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    const disconnect = await screen.findByRole("button", { name: t("agents.disconnectTool", { tool }) });
    expect(screen.getByText(t("agents.hooksInstalled"), { exact: false })).toBeInTheDocument();
    fireEvent.click(disconnect);
    await screen.findByRole("button", { name: t("agents.connectTool", { tool }) });
  }
  expect(screen.getByText(t("agents.claudeHint"))).toBeInTheDocument();
  expect(screen.getByText(t("agents.codexHint"))).toBeInTheDocument();
});

it("shows missing tools and configuration errors without changing hook status", async () => {
  mockSetAgentTool("claude-code", false); mockAgentConfig.foreignCodexNotify = true;
  render(<AgentsSettings />);
  const claude = await screen.findByRole("button", { name: "Connect Claude Code" });
  expect(claude).toBeDisabled();
  const codex = screen.getByRole("button", { name: "Connect Codex" });
  await waitFor(() => expect(codex).toBeEnabled());
  fireEvent.click(codex);
  expect(await screen.findByRole("alert")).toHaveTextContent("another tool");
  expect((await invoke("agents_hooks_status")).codex.hooksInstalled).toBe(false);
});

it("does not toast a restored session, but announces a new completed turn", async () => {
  mockAgentEvent(session("done", "codex"));
  render(<AgentsTab />);
  await screen.findByText("Codex · project");
  expect(useIslandStore.getState().toast).toBeNull();
  act(() => mockAgentEvent(session("working", "codex")));
  act(() => mockAgentEvent(session("done", "codex")));
  expect(useIslandStore.getState().toast?.label).toBe("Codex finished · project");
});

it.each(["dark", "light"] as const)("follows %s theme and lite mode in the Agents settings section", async theme => {
  await invoke("settings_set", { patch: { theme, liteMode: true } });
  localStorage.setItem(SETTINGS_SECTION_KEY, "agents");
  render(<SettingsWindow />);
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", theme));
  expect(document.documentElement).toHaveAttribute("data-lite", "true");
  expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Connect Codex" })).toBeEnabled();
});

it("exposes the Agents section and feature switch in the settings window", async () => {
  await invoke("settings_set", { patch: { language: "en" } });
  render(<SettingsWindow />);
  const nav = screen.getByRole("navigation");
  fireEvent.click(within(nav).getByRole("button", { name: "Agents" }));
  expect(await screen.findByRole("heading", { name: "Agents" })).toBeInTheDocument();
  fireEvent.click(within(nav).getByRole("button", { name: t("settings.features") }));
  const toggle = screen.getByRole("switch", { name: t("agents.feature") });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect((await invoke("settings_get")).disabledFeatures).toContain("agents");
  act(() => mockEmit("agents://changed", []));
});
