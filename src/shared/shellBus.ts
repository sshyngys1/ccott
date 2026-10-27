/**
 * Tiny in-page bus between modules (F2) and the shell (F1). Owner: Orchestrator.
 * Modules ask the shell for things without importing shell internals.
 */
import type { ModuleId } from "./types";

export type ShellRequest =
  /** Collapse the island now (no delay) and release keyboard focus, e.g. before clipboard paste. */
  | { type: "collapse" }
  /** Expand the island and switch to a tab, e.g. clicking a pill activity. */
  | { type: "openTab"; tab: ModuleId }
  /** Show a short message in the pill (e.g. «Скопировано», «Нет окна для вставки»). Suppressed by doNotDisturb. */
  | { type: "toast"; text: string };

/** A listener may return a promise; `requestShell` resolves after every listener has finished. */
type Listener = (req: ShellRequest) => void | Promise<void>;

const listeners = new Set<Listener>();

/**
 * Modules call this. Resolves when the shell has handled the request (e.g. for "collapse": the island is
 * collapsing and keyboard focus has been released), so `await requestShell({type:"collapse"})` before
 * `clipboard_paste`. Never rejects. No-op when the shell has not subscribed (tests).
 */
export async function requestShell(req: ShellRequest): Promise<void> {
  await Promise.all([...listeners].map(async (l) => {
    try {
      await l(req);
    } catch {
      // The shell logs its own failures; callers only need ordering.
    }
  }));
}

/** The shell subscribes once; returns an unsubscribe function. */
export function onShellRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
