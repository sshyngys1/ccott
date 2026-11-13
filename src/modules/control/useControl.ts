import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, type Unlisten } from "../../ipc";
import { localizeMessage, t } from "../../i18n";
import { useFeatureEnabled } from "../../lib/features";
import { requestShell } from "../../shared/shellBus";
import type { ControlState, PowerMode, RadioKind } from "../../shared/types";

export function useControl() {
  const enabled = useFeatureEnabled("control");
  const [state, setState] = useState<ControlState | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef<object | null>(null);
  const busy = useRef(false);
  const error = useCallback((reason: unknown) => {
    void requestShell({ type: "toast", text: t("control.error", { message: localizeMessage(String(reason instanceof Error ? reason.message : reason)) }) });
  }, []);

  useEffect(() => {
    setState(null);
    setFailed(false);
    setPending(false);
    busy.current = false;
    if (!enabled) return;
    const generation = {};
    current.current = generation;
    let stop: Unlisten | undefined;
    void (async () => {
      try {
        stop = await listen("control://changed", fresh => {
          if (current.current !== generation) return;
          setState(fresh);
          setFailed(false);
        });
        if (current.current !== generation) { stop(); return; }
        const fresh = await invoke("control_get");
        // The native command also emits changed. Keep that event snapshot if it arrived
        // first; the return value only fills an otherwise empty initial state.
        if (current.current === generation) setState(previous => previous ?? fresh);
      } catch (reason) {
        if (current.current === generation) { setFailed(true); error(reason); }
      }
    })();
    return () => { current.current = null; stop?.(); };
  }, [enabled, error, attempt]);

  const run = useCallback(async (action: () => Promise<ControlState | void>) => {
    if (!enabled || busy.current || !current.current) return;
    const generation = current.current;
    busy.current = true;
    setPending(true);
    try {
      const fresh = await action();
      if (fresh && current.current === generation) setState(fresh);
    } catch (reason) {
      if (current.current === generation) error(reason);
    } finally {
      if (current.current === generation) { busy.current = false; setPending(false); }
    }
  }, [enabled, error]);

  return {
    enabled, state: enabled ? state : null, pending, failed, retry: () => setAttempt(value => value + 1),
    radio: (kind: RadioKind, on: boolean) => run(() => invoke("control_set_radio", { kind, on })),
    dark: (dark: boolean) => run(() => invoke("control_set_dark_mode", { dark })),
    power: (mode: PowerMode) => run(() => invoke("control_set_power_mode", { mode })),
    settings: (page: "wifi" | "bluetooth" | "power" | "colors") => run(() => invoke("control_open_settings", { page })),
  };
}
