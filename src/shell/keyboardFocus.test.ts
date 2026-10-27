import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardFocusController, isTextTarget } from "./keyboardFocus";

function field<K extends "input" | "textarea">(tag: K, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let native: ReturnType<typeof vi.fn<(active: boolean) => Promise<unknown>>>;
let changes: boolean[];
let ctl: KeyboardFocusController;

beforeEach(() => {
  native = vi.fn<(active: boolean) => Promise<unknown>>(() => Promise.resolve());
  changes = [];
  ctl = new KeyboardFocusController({ setNativeFocus: native, onChange: (a) => changes.push(a) });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("isTextTarget", () => {
  it("accepts text inputs, textareas and contenteditable=true", () => {
    expect(isTextTarget(field("input"))).toBe(true);
    expect(isTextTarget(field("input", { type: "search" }))).toBe(true);
    expect(isTextTarget(field("textarea"))).toBe(true);
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isTextTarget(div)).toBe(true);
  });

  it("rejects switches, sliders, buttons, disabled/readonly fields and plain elements", () => {
    for (const type of ["checkbox", "radio", "range", "button", "submit", "color", "file"]) {
      expect(isTextTarget(field("input", { type }))).toBe(false);
    }
    expect(isTextTarget(field("input", { disabled: "" }))).toBe(false);
    expect(isTextTarget(field("textarea", { readonly: "" }))).toBe(false);
    expect(isTextTarget(document.createElement("div"))).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });
});

describe("KeyboardFocusController", () => {
  it("focusin on a text field asks Rust for the keyboard once and re-focuses the field afterwards", async () => {
    const input = field("input") as HTMLInputElement;
    ctl.focusIn(input);
    expect(ctl.active).toBe(true);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenLastCalledWith(true);
    expect(changes).toEqual([true]);
    // Rust swallowed the DOM focus while the window was being activated.
    expect(document.activeElement).not.toBe(input);
    await flush();
    expect(document.activeElement).toBe(input);
    // field → field does not call Rust again
    ctl.focusIn(field("textarea"));
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("does not re-focus an element that was removed meanwhile", async () => {
    const input = field("input") as HTMLInputElement;
    ctl.focusIn(input);
    input.remove();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it("ignores non-text targets and targets the island does not consider eligible", () => {
    ctl.focusIn(field("input", { type: "checkbox" }));
    expect(native).not.toHaveBeenCalled();
    const picky = new KeyboardFocusController({ setNativeFocus: native, isEligible: () => false });
    picky.focusIn(field("input"));
    expect(native).not.toHaveBeenCalled();
    expect(picky.active).toBe(false);
  });

  it("a rejected call drops the flag and blurs the field", async () => {
    native.mockRejectedValueOnce(new Error("no"));
    const input = field("input") as HTMLInputElement;
    input.focus();
    ctl.focusIn(input);
    expect(ctl.active).toBe(true);
    await flush();
    expect(ctl.active).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(changes).toEqual([true, false]);
  });

  it("release blurs the field, tells Rust once and is idempotent", async () => {
    const input = field("input") as HTMLInputElement;
    input.focus();
    ctl.focusIn(input);
    await flush();
    ctl.release();
    ctl.release();
    expect(ctl.active).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(native.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(changes).toEqual([true, false]);
  });

  it("releasing before the request resolved does not re-focus the field afterwards", async () => {
    const input = field("input") as HTMLInputElement;
    ctl.focusIn(input);
    ctl.release();
    await flush();
    expect(document.activeElement).not.toBe(input);
    expect(native.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("release without focus does nothing", () => {
    ctl.release();
    expect(native).not.toHaveBeenCalled();
  });

  it("duplicate/reentrant release waits for the same native deactivation", async () => {
    let finish!: () => void;
    native.mockImplementation((active) => active ? Promise.resolve() : new Promise<void>((resolve) => { finish = resolve; }));
    ctl.focusIn(field("input"));
    await flush();
    const release = ctl.release();
    const duplicate = ctl.release();
    expect(duplicate).toBe(release);
    let done = false;
    void release.then(() => { done = true; });
    await flush();
    expect(ctl.active).toBe(false);
    expect(done).toBe(false);
    finish();
    await release;
    expect(done).toBe(true);
    expect(native.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("awaits a release already triggered by a synchronous collapse subscriber", async () => {
    let reentrant: Promise<void> | undefined;
    let finish!: () => void;
    native.mockImplementation((active) => active ? Promise.resolve() : new Promise<void>((resolve) => { finish = resolve; }));
    const controller = new KeyboardFocusController({ setNativeFocus: native, onChange: (active) => {
      if (!active) reentrant = controller.release();
    } });
    controller.focusIn(field("input"));
    const release = controller.release();
    expect(reentrant).toBe(release);
    finish();
    await release;
  });

  it("takes the keyboard for an explicitly marked in-panel picker", async () => {
    const option = document.createElement("li");
    option.dataset.islandKeyboard = "true";
    option.setAttribute("role", "option");
    option.tabIndex = 0;
    document.body.appendChild(option);
    ctl.focusIn(option);
    await flush();
    expect(native).toHaveBeenCalledWith(true);
    expect(option).toHaveFocus();
  });

  it("lost() (island://focus-changed false) blurs and drops the flag without calling Rust again", async () => {
    const input = field("input") as HTMLInputElement;
    input.focus();
    ctl.focusIn(input);
    await flush();
    native.mockClear();
    ctl.lost();
    expect(ctl.active).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(native).not.toHaveBeenCalled();
    expect(changes).toEqual([true, false]);
  });

  it("focusOut releases when focus went to nothing, but keeps the keyboard for another field or a button", async () => {
    const input = field("input") as HTMLInputElement;
    const other = field("textarea") as HTMLTextAreaElement;
    const button = document.createElement("button");
    document.body.appendChild(button);
    input.focus();
    ctl.focusIn(input);
    await flush();

    other.focus(); // field → field
    ctl.focusOut();
    await flush();
    expect(ctl.active).toBe(true);

    button.focus(); // field → toolbar button
    ctl.focusOut();
    await flush();
    expect(ctl.active).toBe(true);

    button.blur(); // click on a blank spot
    ctl.focusOut();
    await flush();
    expect(ctl.active).toBe(false);
    expect(native).toHaveBeenLastCalledWith(false);
  });
});
