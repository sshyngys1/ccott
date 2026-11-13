// Helpers for modules that mirror backend state: one event subscription per app, idempotent init, rejection-safe.
// Only talks to Rust through src/ipc.
import { listen } from "../ipc";
import type { EventName, Events } from "../shared/types";

/**
 * Synchronous wrapper around the async `listen`: the returned function unsubscribes even when it is called before
 * the subscription is established, and a rejected `listen` is logged instead of becoming an unhandled rejection.
 * `onFail` runs when the subscription could not be established.
 */
export function safeListen<E extends EventName>(event: E, cb: (payload: Events[E]) => void, onFail?: () => void): () => void {
  let cancelled = false;
  let stop: (() => void) | null = null;
  listen(event, cb).then(
    (un) => {
      if (cancelled) un();
      else stop = un;
    },
    (err: unknown) => {
      console.warn(`[island] listen(${event}) failed`, err);
      onFail?.();
    },
  );
  return () => {
    cancelled = true;
    stop?.();
    stop = null;
  };
}

export interface EventSync {
  /** Subscribes (once) and loads the initial state (once successful). Safe to call from many components. */
  init(): Promise<void>;
  /** Drops the subscription and forgets everything (tests, hot reload). */
  reset(): void;
}

/**
 * Keeps a Zustand store in sync with a backend value: `load()` once + every `event`.
 * An event that arrives while the initial load is in flight wins (it is newer than the load result).
 */
export function createEventSync<E extends EventName>(opts: {
  event: E;
  load: () => Promise<Events[E]>;
  apply: (value: Events[E], source: "load" | "event") => void;
}): EventSync {
  let unlisten: (() => void) | null = null;
  let loaded = false;
  let inflight: Promise<void> | null = null;
  let generation = 0;
  let eventSeen = false;

  const init = (): Promise<void> => {
    if (!unlisten) {
      const gen = generation;
      unlisten = safeListen(
        opts.event,
        (value) => {
          if (gen !== generation) return;
          eventSeen = true;
          opts.apply(value, "event");
        },
        () => {
          if (gen === generation) unlisten = null; // retry on the next init()
        },
      );
    }
    if (loaded) return Promise.resolve();
    if (inflight) return inflight;
    const gen = generation;
    inflight = opts
      .load()
      .then((value) => {
        if (gen !== generation) return;
        if (!eventSeen) opts.apply(value, "load");
        loaded = true;
      })
      .catch((err: unknown) => {
        console.warn(`[island] load for ${opts.event} failed`, err);
      })
      .finally(() => {
        if (gen === generation) inflight = null;
      });
    return inflight;
  };

  const reset = () => {
    generation++;
    unlisten?.();
    unlisten = null;
    loaded = false;
    inflight = null;
    eventSeen = false;
  };

  return { init, reset };
}
