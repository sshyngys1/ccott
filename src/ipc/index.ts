// Owner: F1 (Frontend-Shell). The ONLY place where the UI talks to Rust.
// Tauri runtime → @tauri-apps/api; plain browser (npm run dev, vitest) → ./mock.
// The mock is loaded with a dynamic import() only on the no-Tauri branch, so Vite splits it into its own chunk and the
// production bundle that runs inside Tauri never downloads or parses it.
import type { CommandArgs, CommandName, CommandResult, EventName, Events, FullscreenApp } from "../shared/types";
import { version as packageVersion } from "../../package.json";

export type Unlisten = () => void;

/** package.json is the single source of the version (tauri.conf.json points at it too). */
export const APP_VERSION: string = packageVersion;

type MockModule = typeof import("./mock");
let mockModule: Promise<MockModule> | null = null;
const loadMock = (): Promise<MockModule> => (mockModule ??= import("./mock"));

/** Arguments are optional when the command takes no arguments (`Record<string, never>`). */
type InvokeArgs<C extends CommandName> =
  CommandArgs<C> extends Record<string, never> ? [args?: CommandArgs<C>] : [args: CommandArgs<C>];

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }
  return APP_VERSION;
}

export async function invoke<C extends CommandName>(cmd: C, ...args: InvokeArgs<C>): Promise<CommandResult<C>> {
  const payload = args[0] as CommandArgs<C> | undefined;
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<CommandResult<C>>(cmd, payload as Record<string, unknown> | undefined);
  }
  return (await loadMock()).mockInvoke(cmd, payload);
}

/** Recently seen maximized apps (auto-hide list in settings). */
export function invokeRecentMaximizedApps(): Promise<FullscreenApp[]> {
  return invoke("window_recent_maximized_apps");
}

export async function listen<E extends EventName>(event: E, cb: (payload: Events[E]) => void): Promise<Unlisten> {
  if (isTauri()) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return tauriListen<Events[E]>(event, (e) => cb(e.payload));
  }
  return (await loadMock()).mockListen(event, cb);
}

/**
 * The island element calls this always. In Tauri it is a no-op (Rust polls the cursor and emits `island://hover`);
 * in the browser mock it turns pointerenter/pointerleave of the element into `island://hover`.
 * Synchronous API: the mock is loaded lazily and the listeners are attached as soon as it is there
 * (the returned cleanup also works if it is called before that).
 */
export function registerHoverTarget(el: HTMLElement | null): Unlisten {
  if (!el || isTauri()) return () => {};
  let cancelled = false;
  let stop: Unlisten = () => {};
  loadMock().then(
    (m) => {
      if (!cancelled) stop = m.registerHoverTarget(el);
    },
    () => {},
  );
  return () => {
    cancelled = true;
    stop();
  };
}
