// Owner: F1. Pure hover state machine (no React, no DOM): turns "cursor inside/outside" into delayed expand/collapse.
import type { IslandMode } from "../shared/types";

export const DEFAULT_EXPAND_DELAY_MS = 120;
export const DEFAULT_COLLAPSE_DELAY_MS = 350;
/** A hotkey-summoned island stays open this long if the cursor never comes to it. */
export const SUMMON_HOLD_MS = 8000;

export interface HoverMachineOptions {
  expandDelayMs?: number;
  collapseDelayMs?: number;
  initialMode?: IslandMode;
  /** Called only when the mode actually changes. */
  onChange: (mode: IslandMode) => void;
}

export class HoverMachine {
  private _mode: IslandMode;
  private expandDelayMs: number;
  private collapseDelayMs: number;
  private readonly onChange: (mode: IslandMode) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: IslandMode | null = null;
  /** Last reported cursor state; re-applied when a hold is released. */
  private inside = false;
  /** While held (keyboard focus in a text field) the cursor leaving never schedules a collapse. */
  private held = false;
  /** Summoned by the global hotkey: stays open until the cursor visits it once, or until the summon hold expires. */
  private summonHeld = false;
  private summonTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HoverMachineOptions) {
    this._mode = opts.initialMode ?? "collapsed";
    this.expandDelayMs = opts.expandDelayMs ?? DEFAULT_EXPAND_DELAY_MS;
    this.collapseDelayMs = opts.collapseDelayMs ?? DEFAULT_COLLAPSE_DELAY_MS;
    this.onChange = opts.onChange;
  }

  get mode(): IslandMode {
    return this._mode;
  }

  setDelays(expandDelayMs: number, collapseDelayMs: number): void {
    this.expandDelayMs = expandDelayMs;
    this.collapseDelayMs = collapseDelayMs;
  }

  /**
   * Hold the island open: while `true` the cursor leaving does not collapse it (explicit `collapseNow` still does).
   * Releasing re-evaluates the last known cursor state, so a cursor that left in the meantime collapses after the delay.
   */
  setHold(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    this.setInside(this.inside);
  }

  /** Cursor entered (`true`) or left (`false`) the island. Repeated identical calls do not restart timers. */
  setInside(inside: boolean): void {
    this.inside = inside;
    // The cursor reached the summoned island: from now on it behaves like a hover-opened one.
    if (inside) this.endSummon();
    const target: IslandMode = inside ? "expanded" : "collapsed";
    if (target === this._mode || ((this.held || this.summonHeld) && target === "collapsed")) {
      // Cursor came back (or left again) while the opposite change was pending: cancel it.
      this.cancel();
      return;
    }
    if (this.pending === target) return; // already scheduled
    this.cancel();
    this.pending = target;
    const delay = inside ? this.expandDelayMs : this.collapseDelayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = null;
      this.apply(target);
    }, delay);
  }

  /** Change the mode immediately (keyboard focus, Escape). */
  expandNow(): void {
    this.cancel();
    this.apply("expanded");
  }

  collapseNow(): void {
    this.endSummon();
    this.cancel();
    this.apply("collapsed");
  }

  /** Expand now and stay open (global hotkey, cursor elsewhere) until the cursor visits or `holdMs` passes. */
  summon(holdMs: number = SUMMON_HOLD_MS): void {
    this.endSummon();
    this.summonHeld = true;
    this.summonTimer = setTimeout(() => {
      this.summonTimer = null;
      this.summonHeld = false;
      this.setInside(this.inside);
    }, holdMs);
    this.expandNow();
  }

  dispose(): void {
    this.endSummon();
    this.cancel();
  }

  private endSummon(): void {
    if (this.summonTimer !== null) clearTimeout(this.summonTimer);
    this.summonTimer = null;
    this.summonHeld = false;
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private apply(mode: IslandMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.onChange(mode);
  }
}
