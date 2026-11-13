import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step confirmation for destructive buttons: the first click "arms" the button for `ms`, the second one (while
 * armed) confirms. Disarms by itself, so a forgotten click never leaves a loaded gun behind.
 */
export function useArmed(ms = 3500): { armed: boolean; arm: () => void; disarm: () => void } {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  }, []);
  const arm = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setArmed(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setArmed(false);
    }, ms);
  }, [ms]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { armed, arm, disarm };
}
