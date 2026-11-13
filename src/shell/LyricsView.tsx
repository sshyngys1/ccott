// Owner: F1. «Текст песни» — a screen of the expanded island (design-spec §6.11.3–9), like «Что нового».
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { IconCheck, IconLyrics, IconMusic, IconNext, IconPause, IconPlay, IconPrevious } from "../design/icons";
import { lineState, lyricLevel, staggerSteps } from "../design/lyrics";
import { lyricsMotion } from "../design/motion";
import { t, useT } from "../i18n";
import { interludeDots, interludeEnd, lyricsArtSize, plainRows, wheelSteps } from "../lib/lyrics/lines";
import { useCurrentLyrics } from "../lib/lyrics/store";
import { useActiveLineIndex } from "../lib/lyrics/useActiveLine";
import { extrapolatePosition } from "../lib/media/progress";
import { useMedia, useMediaStore } from "../lib/media/store";
import { PlayerSeek } from "../modules/home/PlayerSeek";
import type { LyricsLine } from "../shared/types";
import { useIslandStore } from "../store";
import { patchSettings } from "./settings/patchSettings";

const ANCHOR = 0.3; // the active line's top sits at 30 % of the viewport (--ig-lyrics-anchor)

/** Caption under the title in the header. */
export function LyricsCaption() {
  useT();
  const { status, source } = useCurrentLyrics();
  const key =
    status === "synced" ? "lyrics.captionSynced"
    : status === "plain" ? "lyrics.captionPlain"
    : status === "loading" || status === "idle" ? "lyrics.captionSearching"
    : status === "instrumental" ? "lyrics.captionInstrumental"
    : status === "off" ? "lyrics.captionOff"
    : "lyrics.captionNone";
  return <span className="ig-lyrics-credit" data-source={source ?? undefined}>{t(key)}</span>;
}

/** «В пилюле» chip of the header: turns the pill line on/off (needs synced lyrics). */
export function LyricsPillChip() {
  useT();
  const { status } = useCurrentLyrics();
  const settings = useIslandStore((s) => s.settings.lyrics);
  const on = settings.inPill && status === "synced";
  return (
    <button
      type="button"
      className="ig-chip"
      aria-pressed={on}
      disabled={status !== "synced"}
      title={t("lyrics.inPillHint")}
      onClick={() => void patchSettings({ lyrics: { ...settings, inPill: !settings.inPill } })}
    >
      {on ? <IconCheck size={14} /> : <IconLyrics size={14} />}
      <span>{t("lyrics.inPill")}</span>
    </button>
  );
}

function Dots({ lines, index, active }: { lines: readonly LyricsLine[]; index: number; active: boolean }) {
  const media = useMediaStore((s) => s.media);
  const offsetMs = useIslandStore((s) => s.settings.lyrics.offsetMs);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!active) {
      setLit(0);
      return;
    }
    const start = lines[index].timeMs;
    const end = interludeEnd(lines, index);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const position = extrapolatePosition(media, Date.now()) + offsetMs;
      const n = interludeDots(start, end, position);
      setLit(n);
      if (media.status === "playing" && n < 3) timer = setTimeout(run, Math.max(16, start + ((end - start) * n) / 3 - position + 1));
    };
    run();
    return () => clearTimeout(timer);
  }, [active, lines, index, media, offsetMs]);
  return (
    <span className="ig-lyrics__dots" aria-label={t("lyrics.interlude")} role="img">
      {[0, 1, 2].map((d) => (
        <i key={d} data-on={d < lit} />
      ))}
    </span>
  );
}

function SyncedLines({ lines }: { lines: readonly LyricsLine[] }) {
  useT();
  const active = useActiveLineIndex(lines);
  const offsetMs = useIslandStore((s) => s.settings.lyrics.offsetMs);
  const canSeek = useMediaStore((s) => s.media.canSeek);
  const viewport = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const wheelRest = useRef(0);
  const resume = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cursor, setCursor] = useState<number | null>(null);
  const [y, setY] = useState(0);
  // Opening the view and changing the track place the lines instantly (no fly-through from the start of the song).
  const [instant, setInstant] = useState(true);
  const first = lines[0];
  useLayoutEffect(() => {
    setInstant(true);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    return () => cancelAnimationFrame(id);
  }, [first]);
  const anchorIndex = cursor ?? Math.max(0, active);
  useLayoutEffect(() => {
    const vp = viewport.current;
    const el = lineRefs.current[anchorIndex];
    // offsetTop ignores transforms, so the target is stable while lines are still moving.
    if (vp && el) setY(Math.round(vp.clientHeight * ANCHOR - el.offsetTop));
  }, [anchorIndex, lines]);
  useEffect(() => () => clearTimeout(resume.current), []);

  const browse = useCallback((next: number | null) => {
    clearTimeout(resume.current);
    setCursor(next);
    if (next !== null) resume.current = setTimeout(() => setCursor(null), lyricsMotion.browseResumeMs);
  }, []);
  const seekTo = (line: LyricsLine) => {
    if (canSeek) void useMediaStore.getState().seek(Math.max(0, line.timeMs - offsetMs));
    browse(null);
  };
  const move = (delta: number) => browse(Math.min(lines.length - 1, Math.max(0, (cursor ?? Math.max(0, active)) + delta)));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" && cursor !== null && lines[cursor]) seekTo(lines[cursor]);
    else return; // Escape and everything else keep bubbling (Esc closes the view)
    e.preventDefault();
  };

  return (
    <div
      ref={viewport}
      className="ig-lyrics"
      data-seekable={canSeek || undefined}
      data-browsing={cursor !== null || undefined}
      data-reduced={instant || undefined}
      tabIndex={0}
      role="group"
      aria-label={t("lyrics.title")}
      onKeyDown={onKeyDown}
      onWheel={(e) => {
        const { steps, rest } = wheelSteps(wheelRest.current, e.deltaY);
        wheelRest.current = rest;
        if (steps !== 0) move(steps);
      }}
    >
      <ol className="ig-lyrics__track" style={{ "--ly-y": `${y}px` } as CSSProperties}>
        {lines.map((line, i) => {
          const state = lineState(i, active);
          return (
            <li
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className="ig-lyrics__line"
              data-state={state}
              data-level={lyricLevel(i, active)}
              data-cursor={cursor === i || undefined}
              aria-current={state === "active" ? "true" : undefined}
              style={{ "--ly-step": staggerSteps(i, active) } as CSSProperties}
              onClick={() => seekTo(line)}
            >
              {line.text === "" ? <Dots lines={lines} index={i} active={state === "active"} /> : <span className="ig-lyrics__text">{line.text}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PlainLines({ text }: { text: string }) {
  useT();
  return (
    <div className="ig-lyrics ig-lyrics--plain" tabIndex={0} role="group" aria-label={t("lyrics.title")}>
      <ol className="ig-lyrics__track">
        {plainRows(text).map((row, i) => (
          <li key={i} className="ig-lyrics__line" aria-hidden={row === "" || undefined}>
            <span className="ig-lyrics__text">{row === "" ? " " : row}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StateBlock({ icon, title, text, action }: { icon: "lyrics" | "music"; title: string; text?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="ig-lyrics-state" role="status">
      <span className="ig-lyrics-state__icon" aria-hidden="true">
        {icon === "music" ? <IconMusic size={22} /> : <IconLyrics size={22} />}
      </span>
      <span className="ig-lyrics-state__title">{title}</span>
      {text && <span className="ig-lyrics-state__text">{text}</span>}
      {action && (
        <button type="button" className="ig-glass-control ig-glass-control--sm ig-lyrics-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function LyricsColumn() {
  useT();
  const lyrics = useCurrentLyrics();
  switch (lyrics.status) {
    case "synced":
      return <SyncedLines lines={lyrics.lines} />;
    case "plain":
      return <PlainLines text={lyrics.text} />;
    case "instrumental":
      return <StateBlock icon="music" title={t("lyrics.instrumental")} />;
    case "error":
      return <StateBlock icon="lyrics" title={t("lyrics.error")} action={{ label: t("lyrics.retry"), onClick: lyrics.retry }} />;
    case "off":
      return (
        <StateBlock
          icon="lyrics"
          title={t("lyrics.off")}
          text={t("lyrics.offHint")}
          action={{ label: t("lyrics.enableSearch"), onClick: () => void patchSettings({ lyrics: { ...useIslandStore.getState().settings.lyrics, enabled: true } }) }}
        />
      );
    case "notFound":
      return <StateBlock icon="lyrics" title={t("lyrics.none")} text={t("lyrics.noneHint")} action={{ label: t("lyrics.retry"), onClick: lyrics.retry }} />;
    default:
      return (
        <div className="ig-lyrics" aria-busy="true" aria-label={t("lyrics.loading")}>
          <div className="ig-lyrics-skeleton" aria-hidden="true">
            <i style={{ width: "72%" }} />
            <i style={{ width: "58%" }} />
            <i style={{ width: "80%" }} />
            <i style={{ width: "46%" }} />
          </div>
          <p className="ig-lyrics-credit ig-lyrics-loading">{t("lyrics.loading")}</p>
        </div>
      );
  }
}

export function LyricsView() {
  useT();
  const media = useMedia();
  const { previous, playPause, next } = useMediaStore.getState();
  const view = useRef<HTMLElement>(null);
  const [art, setArt] = useState(lyricsArtSize(0));
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const measure = () => setArt(lyricsArtSize(el.clientHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const playing = media.status === "playing";
  return (
    <section ref={view} className="ig-lyrics-view" aria-label={t("lyrics.title")} style={{ "--ig-lyrics-art-size": `${art}px` } as CSSProperties}>
      <aside className="ig-lyrics-side">
        <span className="ig-art" aria-hidden="true">
          {media.artwork ? <img src={media.artwork} alt="" draggable={false} /> : <IconMusic size={32} />}
        </span>
        <span className="ig-lyrics-side__title ig-truncate" title={media.title}>{media.title || t("untitled")}</span>
        <span className="ig-lyrics-side__artist ig-truncate" title={media.artist}>{media.artist}</span>
        <div className="ig-lyrics-side__controls">
          <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" disabled={!media.hasSession || !media.canPrevious} onClick={() => void previous()} aria-label={t("previousTrack")}>
            <IconPrevious size={18} />
          </button>
          <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg hm-play" disabled={!media.hasSession || !media.canPlayPause} onClick={() => void playPause()} aria-label={playing ? t("pause") : t("play")}>
            {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
          <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" disabled={!media.hasSession || !media.canNext} onClick={() => void next()} aria-label={t("nextTrack")}>
            <IconNext size={18} />
          </button>
        </div>
        <PlayerSeek />
      </aside>
      <LyricsColumn />
    </section>
  );
}
