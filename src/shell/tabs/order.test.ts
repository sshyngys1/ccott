import { describe, expect, it } from "vitest";
import { modules } from "../../modules/registry";
import {
  DEFAULT_TAB_ORDER,
  type FeatureId,
  type IslandModule,
  type ModuleId,
} from "../../shared/types";
import {
  getDisabledTabModules,
  normalizeTabModules,
  orderVisibleTabs,
  reorderTabOrder,
  resetTabsPatch,
} from "./order";

const Icon = () => null;
const makeModule = (id: ModuleId, order: number): IslandModule => ({
  id,
  title: id,
  icon: Icon,
  Tab: () => null,
  order,
});

const MODULES: readonly IslandModule[] = [
  makeModule("home", 0),
  makeModule("clipboard", 1),
  makeModule("text", 2),
  makeModule("notes", 3),
  makeModule("shelf", 4),
];

describe("tabs/order", () => {
  it("registers eight tabs, appends Agents to older preferences, and resets its feature", () => {
    expect(modules.map(module => module.id)).toEqual(DEFAULT_TAB_ORDER);
    expect(modules).toHaveLength(8);
    expect(orderVisibleTabs(modules, DEFAULT_TAB_ORDER.slice(0, -1), []).map(module => module.id)).toEqual(DEFAULT_TAB_ORDER);
    expect(getDisabledTabModules(modules, DEFAULT_TAB_ORDER, ["agents"]).map(module => module.id)).toEqual(["agents"]);
    expect(resetTabsPatch(["agents", "dock"]).disabledFeatures).toEqual(["dock"]);
  });
  it("returns all tabs in DEFAULT_TAB_ORDER by default", () => {
    const visible = orderVisibleTabs(MODULES, DEFAULT_TAB_ORDER, []);
    expect(visible.map((m) => m.id)).toEqual(["home", "clipboard", "text", "notes", "shelf"]);
  });

  it("respects custom tabOrder including moving Home away from index 0", () => {
    const visible = orderVisibleTabs(MODULES, ["notes", "home", "shelf", "clipboard", "text"], []);
    expect(visible.map((m) => m.id)).toEqual(["notes", "home", "shelf", "clipboard", "text"]);
  });

  it("appends missing known IDs at the end in DEFAULT_TAB_ORDER order", () => {
    const visible = orderVisibleTabs(MODULES, ["shelf", "text"], []);
    expect(visible.map((m) => m.id)).toEqual(["shelf", "text", "home", "clipboard", "notes"]);
  });

  it("skips unknown IDs and deduplicates repeated IDs", () => {
    const visible = orderVisibleTabs(
      MODULES,
      ["future-ai", "notes", "notes", "unknown-tab", "home"],
      [],
    );
    expect(visible.map((m) => m.id)).toEqual(["notes", "home", "clipboard", "text", "shelf"]);
  });

  it("hides tabs whose feature is in disabledFeatures, while keeping Home always visible", () => {
    const visible = orderVisibleTabs(
      MODULES,
      ["clipboard", "home", "notes", "text", "shelf"],
      ["clipboard", "notes", "home" as unknown as FeatureId],
    );
    expect(visible.map((m) => m.id)).toEqual(["home", "text", "shelf"]);

    const disabled = getDisabledTabModules(
      MODULES,
      ["clipboard", "home", "notes", "text", "shelf"],
      ["clipboard", "notes", "dock", "battery"],
    );
    expect(disabled.map((m) => m.id)).toEqual(["clipboard", "notes"]);
  });

  it("returns only Home when all toggleable tab features are disabled", () => {
    const visible = orderVisibleTabs(MODULES, DEFAULT_TAB_ORDER, [
      "clipboard",
      "text",
      "notes",
      "shelf",
    ]);
    expect(visible.map((m) => m.id)).toEqual(["home"]);
  });

  it("reorders visible tabs while preserving hidden tabs in tabOrder", () => {
    const initial = normalizeTabModules(MODULES, DEFAULT_TAB_ORDER).map((m) => m.id);
    // Suppose "text" is hidden; visible = ["home", "clipboard", "notes", "shelf"]
    // Drag "clipboard" onto "notes" -> visible becomes ["home", "notes", "clipboard", "shelf"]
    const reordered = reorderTabOrder(MODULES, initial, "clipboard", "notes");
    expect(reordered).toEqual(["home", "text", "notes", "clipboard", "shelf"]);
    expect(orderVisibleTabs(MODULES, reordered, ["text"]).map((m) => m.id)).toEqual([
      "home",
      "notes",
      "clipboard",
      "shelf",
    ]);
  });

  it("resetTabsPatch restores DEFAULT_TAB_ORDER and re-enables only tab features", () => {
    const patch = resetTabsPatch(["clipboard", "notes", "dock", "audioMeter", "shelf"]);
    expect(patch).toEqual({
      tabOrder: [...DEFAULT_TAB_ORDER],
      disabledFeatures: ["dock", "audioMeter"],
    });
  });
});
