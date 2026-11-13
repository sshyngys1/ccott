// Owner: F1. Keyboard focus front side (contracts §3a): the island window is WS_EX_NOACTIVATE and gets keys only after
// `island_set_keyboard_focus({ active: true })`. This file is the framework-free, testable part; the React wiring is
// in useKeyboardFocus.ts.

/** `<input type>` values that do not take typed text: they never need the keyboard from the OS. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True for `input` (text-like), `textarea` and `[contenteditable="true"]` that can actually be typed into. */
export function isTextTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type) && !target.disabled && !target.readOnly;
  }
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  return target.getAttribute("contenteditable") === "true";
}

/** Elements that legitimately keep the keyboard after a field loses focus (clicking a toolbar button, tabbing around). */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a[href], summary, [contenteditable="true"], [role="tab"], [role="option"], [role="radio"], [role="switch"], [role="button"], [role="checkbox"]';

export interface KeyboardFocusOptions {
  /** Calls `island_set_keyboard_focus`. A rejection means "could not take the keyboard". */
  setNativeFocus: (active: boolean) => Promise<unknown>;
  /** Called whenever the local flag changes (store / hover hold). */
  onChange?: (active: boolean) => void;
  /** Only targets inside the expanded panel count. Default: any text target. */
  isEligible?: (target: HTMLElement) => boolean;
  /** Document used for `activeElement` (tests). */
  doc?: Document;
}

/**
 * Local keyboard-focus state machine.
 *  - `focusIn(target)`: a text field got DOM focus → ask Rust for the keyboard, then re-focus the field (Rust needs
 *    5–150 ms to hand the window the foreground, and that swallows the DOM focus).
 *  - `focusOut()`: DOM focus went nowhere useful (the user clicked a blank spot: body or a plain container) → release.
 *    If an interactive element has focus
 *    (field → field, field → toolbar button, or just the window being deactivated — Rust reports that one through
 *    `island://focus-changed`) the island keeps the keyboard.
 *  - `release()`: collapse / Escape / unmount → blur the field and give the keyboard back.
 *  - `lost()`: Rust says the island lost the foreground by itself → blur and drop the flag, without calling Rust again
 *    (it already restored things; calling again could pull the foreground back from the app the user just clicked).
 */
export class KeyboardFocusController {
  private _active = false;
  private pendingRelease: Promise<void> | null = null;
  /** Bumped on every state change, so a late promise from an older request is ignored. */
  private epoch = 0;
  private readonly opts: KeyboardFocusOptions;

  constructor(opts: KeyboardFocusOptions) {
    this.opts = opts;
  }

  get active(): boolean {
    return this._active;
  }

  private get doc(): Document {
    return this.opts.doc ?? document;
  }

  focusIn(target: EventTarget | null): void {
    const picker = target instanceof HTMLElement && target.matches('[data-island-keyboard="true"]');
    if ((!isTextTarget(target) && !picker) || this._active || !(target instanceof HTMLElement)) return;
    if (this.opts.isEligible && !this.opts.isEligible(target)) return;
    this.setActive(true);
    const epoch = this.epoch;
    this.opts.setNativeFocus(true).then(
      () => {
        if (epoch !== this.epoch) return;
        if (target.isConnected && this.doc.activeElement !== target) target.focus();
      },
      () => {
        if (epoch !== this.epoch) return;
        this.drop();
      },
    );
  }

  focusOut(): void {
    if (!this._active) return;
    // Wait one task: focus moving between elements fires focusout first and settles on the next one afterwards.
    setTimeout(() => {
      if (!this._active) return;
      const el = this.doc.activeElement;
      if (el instanceof HTMLElement && el.matches(INTERACTIVE_SELECTOR)) return;
      this.release();
    }, 0);
  }

  /** Resolves after Rust has returned the keyboard. Reentrant/duplicate releases share the same wait. */
  release(): Promise<void> {
    if (!this._active) return this.pendingRelease ?? Promise.resolve();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    // Publish before drop(): blur/store subscribers may call release() synchronously.
    this.pendingRelease = pending;
    this.drop();
    const failed = (err: unknown) => {
      console.warn("[island] releasing keyboard focus failed", err);
      finish();
    };
    try {
      this.opts.setNativeFocus(false).then(finish, failed);
    } catch (err) {
      failed(err);
    }
    void pending.then(() => {
      if (this.pendingRelease === pending) this.pendingRelease = null;
    });
    return pending;
  }

  /** The foreground was lost without us asking (`island://focus-changed { active: false }`). */
  lost(): void {
    if (!this._active) return;
    this.drop();
  }

  private drop(): void {
    // Flag first: blurring can synchronously collapse the island, whose handler calls release() again.
    this.setActive(false);
    this.blurActive();
  }

  private blurActive(): void {
    const el = this.doc.activeElement;
    if (el instanceof HTMLElement && el !== this.doc.body) el.blur();
  }

  private setActive(active: boolean): void {
    if (this._active === active) return;
    this._active = active;
    this.epoch += 1;
    this.opts.onChange?.(active);
  }
}
