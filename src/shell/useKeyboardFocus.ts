// Owner: F1. React wiring of the keyboard focus front side (contracts §3a); the logic is in keyboardFocus.ts.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { invoke, listen } from "../ipc";
import { useIslandStore } from "../store";
import { isTextTarget, KeyboardFocusController } from "./keyboardFocus";

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

    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelRestore = () => {
      clearTimeout(restoreTimer);
      restoreTimer = undefined;
    };
    const onFocusIn = (e: FocusEvent) => {
      cancelRestore();
      controller.focusIn(e.target);
    };
    const onFocusOut = (e: FocusEvent) => {
      cancelRestore();
      const cmd = useIslandStore.getState().view === "cmd";
      if (controller.active && cmd) {
        // Cmd closes through explicit actions or native focus-changed. A null target can be an activation/MoveFocus
        // hand-off, so recover its DOM focus. Other views keep the usual focusOut path, including null targets.
        const target = e.target;
        if (e.relatedTarget === null && isTextTarget(target)) {
          restoreTimer = setTimeout(() => {
            restoreTimer = undefined;
            const state = useIslandStore.getState();
            if (!controller.active || state.mode !== "expanded" || state.view !== "cmd") return;
            if (!target.isConnected || !islandRef.current?.contains(target)) return;
            const doc = target.ownerDocument;
            if (!doc.activeElement || doc.activeElement === doc.body) target.focus();
          }, 0);
        }
        return;
      }
      controller.focusOut();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    const unsubscribeStore = useIslandStore.subscribe((s, prev) => {
      if (s.mode === "collapsed" && prev.mode !== "collapsed") {
        cancelRestore();
        controller.release();
      }
    });

    let disposed = false;
    let unlisten: () => void = noop;
    listen("island://focus-changed", ({ active }) => {
      if (!active) {
        cancelRestore();
        controller.lost();
      }
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
      cancelRestore();
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
