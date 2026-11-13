import { useCallback, useEffect, useRef, type RefObject } from "react";
import { listen } from "../ipc";
import { useIslandStore } from "../store";
import { CompositorPrewarm } from "./prewarm";

export function usePrewarm(target: RefObject<HTMLElement | null>): () => Promise<void> {
  const controller = useRef<CompositorPrewarm | null>(null);
  useEffect(() => {
    if (!target.current) return;
    const warm = new CompositorPrewarm(target.current);
    controller.current = warm;
    let disposed = false;
    let unlisten = () => {};
    listen("island://prewarm", () => {
      if (!disposed && useIslandStore.getState().mode === "collapsed") void warm.pulse();
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    }, () => {});
    return () => {
      disposed = true;
      unlisten();
      warm.dispose();
      controller.current = null;
    };
  }, [target]);
  return useCallback(() => controller.current?.pulse() ?? Promise.resolve(), []);
}
