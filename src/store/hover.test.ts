import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IslandMode } from "../shared/types";
import { HoverMachine } from "./hover";

describe("HoverMachine", () => {
  let changes: IslandMode[];
  let machine: HoverMachine;

  beforeEach(() => {
    vi.useFakeTimers();
    changes = [];
    machine = new HoverMachine({ expandDelayMs: 120, collapseDelayMs: 350, onChange: (m) => changes.push(m) });
  });

  afterEach(() => {
    machine.dispose();
    vi.useRealTimers();
  });

  it("starts collapsed", () => {
    expect(machine.mode).toBe("collapsed");
  });

  it("expands only after the expand delay", () => {
    machine.setInside(true);
    vi.advanceTimersByTime(119);
    expect(machine.mode).toBe("collapsed");
    vi.advanceTimersByTime(1);
    expect(machine.mode).toBe("expanded");
    expect(changes).toEqual(["expanded"]);
  });

  it("collapses only after the collapse delay", () => {
    machine.expandNow();
    changes.length = 0;
    machine.setInside(false);
    vi.advanceTimersByTime(349);
    expect(machine.mode).toBe("expanded");
    vi.advanceTimersByTime(1);
    expect(machine.mode).toBe("collapsed");
    expect(changes).toEqual(["collapsed"]);
  });

  it("cancels a pending expand when the cursor leaves quickly", () => {
    machine.setInside(true);
    vi.advanceTimersByTime(60);
    machine.setInside(false);
    vi.advanceTimersByTime(1000);
    expect(machine.mode).toBe("collapsed");
    expect(changes).toEqual([]);
  });

  it("cancels a pending collapse when the cursor returns", () => {
    machine.expandNow();
    changes.length = 0;
    machine.setInside(false);
    vi.advanceTimersByTime(300);
    machine.setInside(true);
    vi.advanceTimersByTime(1000);
    expect(machine.mode).toBe("expanded");
    expect(changes).toEqual([]);
  });

  it("does not restart the timer on repeated identical events", () => {
    machine.setInside(true);
    vi.advanceTimersByTime(100);
    machine.setInside(true);
    vi.advanceTimersByTime(20);
    expect(machine.mode).toBe("expanded");
    expect(changes).toEqual(["expanded"]);
  });

  it("ignores inside=false while already collapsed", () => {
    machine.setInside(false);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
  });

  it("survives a flicker: in → out → in within the delays ends up expanded exactly once", () => {
    machine.setInside(true);
    vi.advanceTimersByTime(130);
    machine.setInside(false);
    vi.advanceTimersByTime(100);
    machine.setInside(true);
    vi.advanceTimersByTime(2000);
    expect(machine.mode).toBe("expanded");
    expect(changes).toEqual(["expanded"]);
  });

  it("applies new delays to the next transition", () => {
    machine.setDelays(10, 20);
    machine.setInside(true);
    vi.advanceTimersByTime(10);
    expect(machine.mode).toBe("expanded");
    machine.setInside(false);
    vi.advanceTimersByTime(20);
    expect(machine.mode).toBe("collapsed");
  });

  it("collapseNow / expandNow are immediate and cancel pending timers", () => {
    machine.setInside(true);
    machine.expandNow();
    expect(machine.mode).toBe("expanded");
    machine.setInside(false);
    machine.collapseNow();
    expect(machine.mode).toBe("collapsed");
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual(["expanded", "collapsed"]);
  });

  describe("hold (keyboard focus in a field)", () => {
    it("the cursor leaving does not collapse a held island, not even much later", () => {
      machine.expandNow();
      changes.length = 0;
      machine.setHold(true);
      machine.setInside(false);
      vi.advanceTimersByTime(10_000);
      expect(machine.mode).toBe("expanded");
      expect(changes).toEqual([]);
    });

    it("cancels a collapse that was already pending when the hold starts", () => {
      machine.expandNow();
      machine.setInside(false);
      vi.advanceTimersByTime(200);
      machine.setHold(true);
      vi.advanceTimersByTime(10_000);
      expect(machine.mode).toBe("expanded");
    });

    it("releasing the hold with the cursor outside collapses after the collapse delay", () => {
      machine.expandNow();
      machine.setHold(true);
      machine.setInside(false);
      machine.setHold(false);
      vi.advanceTimersByTime(349);
      expect(machine.mode).toBe("expanded");
      vi.advanceTimersByTime(1);
      expect(machine.mode).toBe("collapsed");
    });

    it("releasing the hold with the cursor inside keeps it expanded", () => {
      machine.expandNow();
      machine.setHold(true);
      machine.setInside(true);
      machine.setHold(false);
      vi.advanceTimersByTime(10_000);
      expect(machine.mode).toBe("expanded");
    });

    it("explicit collapseNow (Escape, shell bus) still works while held", () => {
      machine.expandNow();
      machine.setHold(true);
      machine.collapseNow();
      expect(machine.mode).toBe("collapsed");
    });
  });

  it("dispose drops pending timers", () => {
    machine.setInside(true);
    machine.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
  });

  describe("summon (global hotkey)", () => {
    it("stays open while the cursor is elsewhere, then collapses when the hold expires", () => {
      machine.summon(8000);
      expect(machine.mode).toBe("expanded");
      machine.setInside(false); // Rust re-emits the cursor state after the mode change
      vi.advanceTimersByTime(7999);
      expect(machine.mode).toBe("expanded");
      vi.advanceTimersByTime(1 + 350);
      expect(machine.mode).toBe("collapsed");
    });

    it("behaves like a hover-opened island once the cursor has visited it", () => {
      machine.summon(8000);
      machine.setInside(true);
      machine.setInside(false);
      vi.advanceTimersByTime(350);
      expect(machine.mode).toBe("collapsed");
    });

    it("collapseNow ends the summon hold", () => {
      machine.summon(8000);
      machine.collapseNow();
      vi.advanceTimersByTime(10_000);
      expect(changes).toEqual(["expanded", "collapsed"]);
    });
  });
});
