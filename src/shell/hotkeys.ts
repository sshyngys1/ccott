import { useEffect, useRef, useState } from "react";
import { localizeMessage, t } from "../i18n";
import { invoke, listen } from "../ipc";
import type { HotkeyStatus } from "../shared/types";
import { useIslandStore } from "../store";
import type { HoverControls } from "../store/useHoverSync";
import { openSettingsWindow } from "./settings/openWindow";
import { showToast } from "./toast";

/** Subscribe before reading, so a late initial response cannot overwrite a newer event. */
export function useHotkeyStatus(): HotkeyStatus | null {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  useEffect(() => {
    let disposed = false;
    let changed = false;
    let off = () => {};
    void listen("hotkeys://status", (next) => {
      changed = true;
      if (!disposed) setStatus(next);
    }).then(async (unlisten) => {
      if (disposed) { unlisten(); return; }
      off = unlisten;
      const initial = await invoke("hotkeys_status");
      if (!disposed && !changed) setStatus(initial);
    }).catch(() => {});
    return () => { disposed = true; off(); };
  }, []);
  return status;
}

export function useHotkeyFallbackToast(controls: HoverControls): void {
  const status = useHotkeyStatus();
  const command = useIslandStore((s) => s.settings.commandHotkey);
  const doNotDisturb = useIslandStore((s) => s.doNotDisturb);
  const mode = useIslandStore((s) => s.mode);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!status?.commandFallbackFrom || status.command !== "ok" || doNotDisturb || mode !== "collapsed") return;
    let disposed = false;
    // Read the authoritative value: startup settings/status events can arrive in either order.
    void invoke("settings_get").then(async (settings) => {
      if (disposed) return;
      const from = status.commandFallbackFrom!;
      const to = settings.commandHotkey;
      const key = `ccott.hotkey-fallback:${from}:${to}`;
      if (!to || to === from || seen.current.has(key)) return;
      // A no-op settings write retries a pending startup save and reports its failure through
      // the existing settings error channel. Successful persisted no-ops do not touch disk.
      let sessionOnly = false;
      try { await invoke("settings_set", { patch: {} }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (localizeMessage(message) !== t("hotkey.sessionOnly")) throw error;
        sessionOnly = true;
      }
      if (disposed) return;
      if (!sessionOnly) {
        try { if (localStorage.getItem(key)) return; } catch { /* Storage may be disabled. */ }
      }
      const fallbackTitle = t("hotkey.fallback", { from, shortcut: to });
      const title = sessionOnly ? `${fallbackTitle}. ${t("hotkey.sessionOnly")}` : fallbackTitle;
      const current = useIslandStore.getState().toast;
      if (current?.shortcut === to && current.title === title) return;
      showToast({
        label: t("hotkey.fallbackShort", { from }),
        shortcut: to,
        title,
        detail: sessionOnly ? t("hotkey.sessionOnly") : undefined,
        onShown: () => {
          seen.current.add(key);
          if (!sessionOnly) {
            try { localStorage.setItem(key, "1"); } catch { /* Deduplicate during this mount. */ }
          }
        },
        actions: [{ label: t("settings"), icon: "settings", onClick: () => {
          controls.collapseNow();
          void openSettingsWindow();
        } }],
      });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [status, command, doNotDisturb, mode, controls]);
}
