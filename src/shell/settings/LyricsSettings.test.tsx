import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { invoke } from "../../ipc";
import { resetMock } from "../../ipc/mock";
import { resetIslandStore, useIslandStore } from "../../store";
import { useSettingsSync } from "../useShellSync";
import { SettingsView } from "./SettingsView";

function Harness({ section }: { section: "lyrics" | "features" }) {
  useSettingsSync();
  return <SettingsView section={section} />;
}

beforeEach(async () => {
  resetMock();
  resetIslandStore();
  useIslandStore.getState().applySettings(await invoke("settings_get"));
});
afterEach(() => {
  cleanup();
  resetIslandStore();
});

const backend = () => invoke("settings_get");

describe("«Текст песен» settings section", () => {
  it("lists the four controls with the default values and says what is sent", async () => {
    render(<Harness section="lyrics" />);
    const region = within(screen.getByRole("region", { name: t("lyrics.settings.title") }));
    expect(region.getByRole("switch", { name: new RegExp(t("lyrics.settings.search")) })).toBeChecked();
    expect(region.getByRole("switch", { name: new RegExp(t("lyrics.settings.inPill")) })).toBeChecked();
    expect(region.getByRole("switch", { name: new RegExp(t("lyrics.settings.announce")) })).not.toBeChecked();
    expect(region.getByRole("slider", { name: new RegExp(t("lyrics.settings.offset")) })).toHaveValue("0");
    // The privacy note names exactly what leaves the computer.
    expect(region.getByText(t("lyrics.settings.searchHint"))).toBeInTheDocument();
    expect(t("lyrics.settings.searchHint")).toMatch(/LRCLIB/);
  });

  it("each switch writes its own field and keeps the others", async () => {
    render(<Harness section="lyrics" />);
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(t("lyrics.settings.search")) }));
    await waitFor(async () => expect((await backend()).lyrics.enabled).toBe(false));
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(t("lyrics.settings.announce")) }));
    await waitFor(async () => expect((await backend()).lyrics.announce).toBe(true));
    fireEvent.click(screen.getByRole("switch", { name: new RegExp(t("lyrics.settings.inPill")) }));
    await waitFor(async () => expect((await backend()).lyrics).toEqual({ enabled: false, inPill: false, announce: true, offsetMs: 0 }));
  });

  it("the offset slider commits on release; reset returns it to 0", async () => {
    render(<Harness section="lyrics" />);
    const slider = screen.getByRole("slider", { name: new RegExp(t("lyrics.settings.offset")) });
    fireEvent.change(slider, { target: { value: "-1500" } }); // the native `change` = release
    await waitFor(async () => expect((await backend()).lyrics.offsetMs).toBe(-1500));
    fireEvent.click(await screen.findByRole("button", { name: t("lyrics.settings.offsetReset") }));
    await waitFor(async () => expect((await backend()).lyrics.offsetMs).toBe(0));
  });

  it("the backend rejects out-of-range offsets like Rust does", async () => {
    await expect(invoke("settings_set", { patch: { lyrics: { enabled: true, inPill: true, announce: false, offsetMs: 5001 } } })).rejects.toThrow();
    await expect(invoke("settings_set", { patch: { lyrics: { enabled: true, inPill: true, announce: false, offsetMs: 1.5 } } })).rejects.toThrow();
    expect((await backend()).lyrics.offsetMs).toBe(0);
  });
});

describe("«Функции»", () => {
  it("has a switch for the lyrics feature that writes disabledFeatures", async () => {
    render(<Harness section="features" />);
    const toggle = screen.getByRole("switch", { name: t("settings.feature.lyrics") });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(async () => expect((await backend()).disabledFeatures).toEqual(["lyrics"]));
    expect(screen.getByRole("switch", { name: t("settings.feature.lyrics") })).not.toBeChecked();
  });
});
