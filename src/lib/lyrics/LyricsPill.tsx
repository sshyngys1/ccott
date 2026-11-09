// Owner: F2. The current synced line inside the collapsed pill (design-spec §6.11.2). Replaces the media pill while a
// synced track plays and `lyrics.inPill` is on; priorities of other activities are decided by the shell.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { readIslandGeometry } from "../../design/geometry";
import { IconMusic } from "../../design/icons";
import { lyricsMotion } from "../../design/motion";
import { t, useT } from "../../i18n";
import { Eq } from "../../modules/home/Eq";
import { requestShell } from "../../shared/shellBus";
import { useIslandStore } from "../../store";
import { isFeatureEnabled } from "../features";
import { announceDelay, trackKey } from "./lines";
import { useLyricsStore } from "./store";
import { useActiveLineIndex } from "./useActiveLine";
import { PILL_CHROME_FALLBACK_PX, fitPillWidth, marqueeDuration, marqueeOverflow, useHeldWidth, usePillFitStore } from "./pillFit";
import { useMediaStore } from "../media/store";
import { sourceAppLabel } from "../media/progress";
import "../ui.css";

/** True when the pill should show the lyric line instead of the plain media activity. */
export function useLyricsPillActive(): boolean {
  const featureOn = useIslandStore((s) => isFeatureEnabled("lyrics", s.settings.disabledFeatures));
  const { enabled, inPill } = useIslandStore((s) => s.settings.lyrics);
  const synced = useLyricsStore((s) => s.status === "synced");
  const lyricsKey = useLyricsStore((s) => s.key);
  const mediaKey = useMediaStore((s) => trackKey(s.media));
  return featureOn && enabled && inPill && synced && lyricsKey === mediaKey && mediaKey !== "";
}

/** Debounced, throttled text for the screen-reader live region (≥ 1.2 s on screen, ≥ 4 s apart, off by default). */
function useAnnounced(text: string, enabled: boolean): string {
  const [announced, setAnnounced] = useState("");
  const lastAt = useRef(0);
  useEffect(() => {
    if (!enabled || !text) return;
    const timer = setTimeout(() => {
      if (useIslandStore.getState().mode === "expanded") return; // the panel is open: the user reads it themselves
      lastAt.current = Date.now();
      setAnnounced(text);
    }, announceDelay(Date.now(), lastAt.current));
    return () => clearTimeout(timer);
  }, [text, enabled]);
  return enabled ? announced : "";
}

export function LyricsPill() {
  useT();
  const reduce = useReducedMotion();
  const media = useMediaStore((s) => s.media);
  const lines = useLyricsStore((s) => s.lines);
  const announce = useIslandStore((s) => s.settings.lyrics.announce);
  const playing = media.status === "playing";
  const active = useActiveLineIndex(lines);
  const line = active >= 0 ? lines[active] : undefined;
  // Before the first line, in an interlude and while paused the pill shows the track instead (quieter).
  const showLine = playing && !!line && line.text !== "";
  const label = showLine ? line.text : `${media.title || t("untitled")}${media.artist ? ` · ${media.artist}` : ""}`;
  const shift = reduce ? 0 : lyricsMotion.pillLine.shift;
  const announced = useAnnounced(showLine ? line.text : "", announce);

  // Width: measure the line (hidden twin) + the pill's own chrome, ask the shell for a wider/narrower pill.
  const geo = useMemo(() => readIslandGeometry(), []);
  const lite = useIslandStore((s) => s.settings.liteMode);
  const row = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const twin = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState({ target: geo.pillLyrics.width, overflow: 0 });
  useLayoutEffect(() => {
    if (!showLine || !twin.current) return; // the title keeps the width of the previous line
    const text = Math.ceil(twin.current.getBoundingClientRect().width);
    const chrome = row.current && box.current ? row.current.clientWidth - box.current.clientWidth : 0;
    const c = chrome > 0 ? chrome : PILL_CHROME_FALLBACK_PX;
    setFit({
      target: fitPillWidth(text, c, geo.pillLyrics.width, geo.panel.width),
      overflow: marqueeOverflow(text, c, geo.panel.width),
    });
  }, [label, showLine, geo, media.artwork]);
  const width = useHeldWidth(fit.target);
  useEffect(() => {
    usePillFitStore.getState().set(width);
  }, [width]);
  useEffect(() => () => usePillFitStore.getState().set(null), []);
  // A line wider than the widest pill scrolls slowly (translateX); without animation it is cut with an ellipsis.
  const animate = !reduce && !lite;
  const marquee = showLine && fit.overflow > 0 && animate;
  const textStyle = marquee ? ({ "--ly-shift": `-${fit.overflow}px`, "--ly-dur": `${marqueeDuration(fit.overflow)}s` } as CSSProperties) : undefined;
  return (
    <>
      <button
        ref={row}
        type="button"
        className="ig-pill-row ig-pill-row--lyrics mod-pill"
        data-state={playing ? "playing" : "paused"}
        onClick={() => requestShell({ type: "openTab", tab: "home" })}
        aria-label={t("openPlayer", { p0: playing ? t("playing") : t("paused"), p1: media.title, p2: media.artist ? ` — ${media.artist}` : "" })}
        title={sourceAppLabel(media.sourceApp) || undefined}
      >
        <span className="ig-art ig-art--pill" aria-hidden="true">
          {media.artwork ? <img src={media.artwork} alt="" draggable={false} /> : <IconMusic size={14} />}
        </span>
        <span ref={box} className="ig-pill-lyric" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.span
              key={showLine ? `l${active}` : "title"}
              initial={{ opacity: 0, y: shift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -shift }}
              transition={{ duration: reduce ? 0 : lyricsMotion.pillLine.duration, ease: lyricsMotion.pillLine.ease }}
            >
              <span
                className="ig-pill-lyric__text"
                data-kind={showLine ? "line" : "title"}
                data-marquee={marquee || undefined}
                data-truncate={(showLine && fit.overflow > 0 && !animate) || undefined}
                style={textStyle}
              >
                {label}
              </span>
            </motion.span>
          </AnimatePresence>
        </span>
        <Eq playing={playing} />
        <span ref={twin} className="ig-pill-lyric__text ig-pill-lyric__twin" aria-hidden="true">
          {label}
        </span>
      </button>
      <span className="mod-sr-only" aria-live="polite" aria-atomic="true" data-testid="lyrics-announce">
        {announced}
      </span>
    </>
  );
}
