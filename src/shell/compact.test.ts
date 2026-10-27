import { describe, expect, it } from "vitest";
import type { IslandModule, ModuleId } from "../shared/types";
import { pickCompact } from "./compact";

const View = () => null;
const Icon = () => null;

function mod(id: ModuleId, order: number, priority?: number): IslandModule {
  return {
    id,
    title: id,
    icon: Icon,
    Tab: View,
    order,
    compact: priority === undefined ? undefined : { useIsActive: () => true, priority, View },
  };
}

describe("pickCompact", () => {
  it("returns null when nothing is active", () => {
    const modules = [mod("home", 0, 5), mod("clipboard", 1, 9)];
    expect(pickCompact(modules, [false, false])).toBeNull();
  });

  it("ignores modules without a compact activity", () => {
    const modules = [mod("home", 0), mod("notes", 1)];
    expect(pickCompact(modules, [true, true])).toBeNull();
  });

  it("picks the highest priority among active ones", () => {
    const modules = [mod("home", 0, 10), mod("clipboard", 1, 50), mod("notes", 2, 90)];
    expect(pickCompact(modules, [true, true, false])?.id).toBe("clipboard");
    expect(pickCompact(modules, [true, true, true])?.id).toBe("notes");
    expect(pickCompact(modules, [true, false, false])?.id).toBe("home");
  });

  it("breaks ties by lower order", () => {
    const modules = [mod("notes", 3, 10), mod("home", 0, 10)];
    expect(pickCompact(modules, [true, true])?.id).toBe("home");
  });
});
