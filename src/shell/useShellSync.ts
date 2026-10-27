// Owner: F1. Startup/side-effect hooks of the shell: theme, vibrancy, settings, mode → Rust.
import { useEffect, useRef } from "react";
import { durations } from "../design/motion";
import { invoke, listen } from "../ipc";
import type { IslandMode, Settings } from "../shared/types";
import { useIslandStore, type ResolvedTheme } from "../store";
import { announceUpdate, clipboardToastPreview, showToast } from "./toast";

const noop = () => {};

function systemTheme(): ResolvedTheme {
  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** `<html data-theme>`: settings.theme, or prefers-color-scheme when "auto" (with a live subscription). */
export function useThemeSync(): void {
  const themeMode = useIslandStore((s) => s.themeMode);
  const setTheme = useIslandStore((s) => s.setTheme);

  useEffect(() => {
    const apply = (theme: ResolvedTheme) => {
      document.documentElement.dataset.theme = theme;
      setTheme(theme);
    };
    if (themeMode !== "auto") {
      apply(themeMode);
      return;
    }
    apply(systemTheme());
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode, setTheme]);
}

/** Follows settings.vibrancy (default none), mirroring the native result to `<html data-vibrancy>`. */
export function useVibrancySync(): void {
  const setVibrancy = useIslandStore((s) => s.setVibrancy);
  const requested = useIslandStore((s) => s.settings.vibrancy);

  useEffect(() => {
    let cancelled = false;
    const apply = (applied: "acrylic" | "mica" | "none") => {
      if (cancelled) return;
      document.documentElement.dataset.vibrancy = applied;
      setVibrancy(applied);
    };
    document.documentElement.dataset.vibrancy = "none";
    invoke("window_set_vibrancy", { mode: requested }).then((r) => apply(r.applied), () => apply("none"));
    return () => {
      cancelled = true;
    };
  }, [requested, setVibrancy]);
}

/** Loads settings (theme, hover delays, DND, …) into the store and follows `settings://changed`. Missing backend (wave 1) → defaults. */
export function useSettingsSync(): void {
  useEffect(() => {
    const apply = (s: Settings) => useIslandStore.getState().applySettings(s);
    let disposed = false;
    let unlisten: () => void = noop;
    invoke("settings_get").then((s) => !disposed && apply(s), noop);
    listen("settings://changed", apply).then((u) => {
      if (disposed) u();
      else unlisten = u;
    }, noop);
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);
}

/** Tells Rust about collapsed/expanded on every change (including the initial value). */
export function useModeSync(mode: IslandMode): void {
  const sent = useRef<IslandMode | null>(null); // survives StrictMode effect re-runs
  useEffect(() => {
    if (sent.current === mode) return;
    sent.current = mode;
    invoke("island_set_mode", { mode }).catch(noop);
  }, [mode]);
}

/** Toasts (`clipboard://added` → «Скопировано», `updater://available` → «Доступно обновление», shell bus `toast`) stay in the pill for `durations.toastHold` seconds. */
export function useToastSync(): void {
  useEffect(() => {
    let disposed = false;
    let unlistenClipboard: () => void = noop;
    let unlistenUpdater: () => void = noop;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Whatever shows a toast (clipboard event, updater, shell bus), a new one restarts the hold timer.
    const unsubscribe = useIslandStore.subscribe((s, prev) => {
      if (!s.toast || s.toast === prev.toast) return;
      clearTimeout(timer);
      timer = setTimeout(() => useIslandStore.getState().setToast(null), durations.toastHold * 1000);
    });
    listen("clipboard://added", (item) => {
      const preview = item.kind === "image" ? "Изображение" : item.kind === "files" ? "Файлы" : clipboardToastPreview(item.text, item.preview);
      showToast({ label: "Скопировано", preview });
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenClipboard = u;
      },
      noop,
    );
    listen("updater://available", (info) => {
      if (!disposed) announceUpdate(info);
    }).then(
      (u) => {
        if (disposed) u();
        else unlistenUpdater = u;
      },
      noop,
    );
    return () => {
      disposed = true;
      unlistenClipboard();
      unlistenUpdater();
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}
