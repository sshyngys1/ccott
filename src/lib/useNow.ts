import { useEffect, useState } from "react";
import { useDocumentVisible } from "./useDocumentVisible";

/** Current time (epoch ms), refreshed every `intervalMs` — keeps «5 мин назад» labels fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, visible]);
  return now;
}
