// Owner: F1. React wiring of the keyboard focus front side (contracts §3a); the logic is in keyboardFocus.ts.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { invoke, listen } from "../ipc";
import { useIslandStore } from "../store";
import { KeyboardFocusController } from "./keyboardFocus";

const noop = () => {};

export interface KeyboardFocusHandle {
  /** The island currently holds the keyboard (a field is being edited). */
  isActive: () => boolean;
  /** Blur the field and give the keyboard back to the previous window. Idempotent. */
  release: () => Promise<void>;
}

/**
 * - document `focusin` on a text field inside the expanded island → `island_set_keyboard_focus({ active: true })`;
 * - `island://focus-changed { active: false }` → blur + drop the flag;
 * - collapse (any cause) or unmount → release.
 * The flag lives in the store (`keyboardFocus`), where the hover machine reads it to not collapse while typing.
 */
export function useKeyboardFocus(islandRef: RefObject<HTMLElement | null>): KeyboardFocusHandle {
  const controllerRef = useRef<KeyboardFocusController | null>(null);

  useEffect(() => {
    const controller = new KeyboardFocusController({
      setNativeFocus: (active) => invoke("island_set_keyboard_focus", { active }),
      onChange: (active) => useIslandStore.getState().setKeyboardFocus(active),
      isEligible: (target) =>
        useIslandStore.getState().mode === "expanded" && !!islandRef.current && islandRef.current.contains(target),
    });
    controllerRef.current = controller;

    const onFocusIn = (e: FocusEvent) => controller.focusIn(e.target);
    const onFocusOut = () => controller.focusOut();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    const unsubscribeStore = useIslandStore.subscribe((s, prev) => {
      if (s.mode === "collapsed" && prev.mode !== "collapsed") controller.release();
    });

    let disposed = false;
    let unlisten: () => void = noop;
    listen("island://focus-changed", ({ active }) => {
      if (!active) controller.lost();
    }).then(
      (u) => {
        if (disposed) u();
        else unlisten = u;
      },
      noop,
    );

    return () => {
      disposed = true;
      unlisten();
      unsubscribeStore();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      controller.release();
      controllerRef.current = null;
    };
  }, [islandRef]);

  return useMemo(
    () => ({
      isActive: () => controllerRef.current?.active ?? false,
      release: () => controllerRef.current?.release() ?? Promise.resolve(),
    }),
    [],
  );
}
