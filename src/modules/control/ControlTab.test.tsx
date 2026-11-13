import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockControlSettingsOpens, mockListenerCount, mockSetControl, resetMock } from "../../ipc/mock";
import { setLanguage, t } from "../../i18n";
import { onShellRequest } from "../../shared/shellBus";
import type { ShellRequest } from "../../shared/shellBus";
import { resetIslandStore, useIslandStore } from "../../store";
import { orderVisibleTabs } from "../../shell/tabs/order";
import control from "./index";
import { ControlTab } from "./ControlTab";

beforeEach(() => { resetMock(); resetIslandStore(); setLanguage("en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetIslandStore(); });
async function mount() {
  const view = render(<ControlTab />);
  await screen.findByRole("switch", { name: /Windows dark theme/ });
  await waitFor(() => expect(mockListenerCount("control://changed")).toBe(1));
  return view;
}

describe("control center", () => {
  it.each(["ru", "en"] as const)("renders the %s snapshot, device connection and optional battery", async language => {
    setLanguage(language);
    mockSetControl({ btDevices: [
      { id: "a", name: "Headphones", connected: true, battery: 64 },
      { id: "b", name: "Keyboard", connected: false, battery: null },
    ] });
    render(<ControlTab />);
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Headphones")).toBeInTheDocument();
    expect(screen.getByText("Keyboard")).toBeInTheDocument();
    expect(screen.getByLabelText(t("control.battery", { percent: 64 }))).toHaveTextContent("64%");
    expect(screen.getByText(t("control.connected"))).toBeInTheDocument();
    expect(screen.getByText(t("control.disconnected"))).toBeInTheDocument();
  });

  it("changes both radios, theme and power using the typed commands and updates the snapshot", async () => {
    const spy = vi.spyOn(ipc, "invoke");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Wi-Fi", pressed: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Wi-Fi", pressed: false })).toHaveAttribute("aria-pressed", "false"));
    expect(spy).toHaveBeenCalledWith("control_set_radio", { kind: "wifi", on: false });
    fireEvent.click(screen.getByRole("button", { name: "Bluetooth", pressed: true }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("control_set_radio", { kind: "bluetooth", on: false }));
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(spy).toHaveBeenCalledWith("control_set_dark_mode", { dark: false });
    fireEvent.click(screen.getByRole("button", { name: t("control.efficiency") }));
    await waitFor(() => expect(screen.getByRole("button", { name: t("control.efficiency") })).toHaveAttribute("aria-pressed", "true"));
    expect(spy).toHaveBeenCalledWith("control_set_power_mode", { mode: "efficiency" });
  });

  it("shows a toast for unavailable radio and keeps its state unchanged", async () => {
    mockSetControl({ wifi: { kind: "wifi", state: "unavailable" } });
    const requests: ShellRequest[] = [];
    const stop = onShellRequest(request => { requests.push(request); });
    try {
      await mount();
      expect(screen.getByText(t("control.unavailable"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Wi-Fi", pressed: false }));
      await waitFor(() => expect(requests).toContainEqual({ type: "toast", text: t("control.error", { message: t("control.radioError") }) }));
      expect((await ipc.invoke("control_get")).wifi.state).toBe("unavailable");
    } finally { stop(); }
  });

  it("applies external changes, hides unavailable power mode, and shows the empty devices hint", async () => {
    await mount();
    act(() => mockSetControl({ powerMode: null, darkMode: false, wifiInfo: { connected: true, ssid: "Office", signal: 42 } }));
    expect(screen.queryByRole("group", { name: t("control.powerMode") })).toBeNull();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Office")).toBeInTheDocument();
    expect(screen.getByText(t("control.empty"))).toBeInTheDocument();
  });

  it("disabled control hides its registered tab, releases subscription, and restores on enable", async () => {
    const view = await mount();
    act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["control"] }));
    await waitFor(() => expect(mockListenerCount("control://changed")).toBe(0));
    expect(view.container).toBeEmptyDOMElement();
    expect(orderVisibleTabs([control], ["control"], ["control"])).toEqual([]);
    act(() => useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: [] }));
    await screen.findByRole("switch");
    await waitFor(() => expect(mockListenerCount("control://changed")).toBe(1));
    view.unmount();
    expect(mockListenerCount("control://changed")).toBe(0);
  });

  it("does not subscribe when initially disabled", () => {
    useIslandStore.getState().applySettings({ ...useIslandStore.getState().settings, disabledFeatures: ["control"] });
    const spy = vi.spyOn(ipc, "invoke");
    render(<ControlTab />);
    expect(mockListenerCount("control://changed")).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("releases a subscription that resolves after unmount", async () => {
    const originalListen = ipc.listen;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(ipc, "listen").mockImplementation(async (event, cb) => {
      const stop = await originalListen(event, cb);
      await gate;
      return stop;
    });
    const view = render(<ControlTab />);
    await waitFor(() => expect(mockListenerCount("control://changed")).toBe(1));
    view.unmount();
    await act(async () => { release(); });
    expect(mockListenerCount("control://changed")).toBe(0);
  });

  it.each(["wifi", "bluetooth", "colors", "power"] as const)("opens the allowlisted %s Windows settings page", async page => {
    const spy = vi.spyOn(ipc, "invoke");
    await mount();
    fireEvent.click(screen.getByRole("navigation").querySelectorAll("button")[["wifi", "bluetooth", "colors", "power"].indexOf(page)]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("control_open_settings", { page }));
    await waitFor(() => expect(mockControlSettingsOpens).toEqual([page]));
  });
});
