// Owner: F2. Active synced line from the extrapolated player position (+ the user's offset). No polling: one timer aimed at
// the moment the next line starts; seek / pause / track change re-aims it.
import { useEffect, useState } from "react";
import { activeLineIndex } from "../../design/lyrics";
import { lyricsMotion } from "../../design/motion";
import type { LyricsLine } from "../../shared/types";
import { useIslandStore } from "../../store";
import { extrapolatePosition } from "../media/progress";
import { useMediaStore } from "../media/store";

/** Index of the active line (−1 before the first one). `enabled = false` removes the timer. */
export function useActiveLineIndex(lines: readonly LyricsLine[], enabled = true): number {
  const media = useMediaStore((s) => s.media);
  const offsetMs = useIslandStore((s) => s.settings.lyrics.offsetMs);
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!enabled || lines.length === 0) {
      setIndex(-1);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const position = extrapolatePosition(media, Date.now()) + offsetMs;
      const active = activeLineIndex(lines, position);
      setIndex(active);
      const next = lines[active + 1];
      if (media.status === "playing" && next) {
        timer = setTimeout(run, Math.max(16, next.timeMs - lyricsMotion.leadMs - position + 1));
      }
    };
    run();
    return () => clearTimeout(timer);
  }, [lines, media, offsetMs, enabled]);
  return index;
}
