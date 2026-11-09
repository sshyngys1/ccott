// Owner: Designer. Synced-lyrics design stand (spec §6.11): http://localhost:1430/src/design/preview/lyrics.html
// Runs without Rust. All lyric lines, titles and artists below are INVENTED for the mock-up (no real songs).
// URL: solo=collapsed|home|lyrics|loading|plain|none (one 800×520 frame at 0,0, for screenshots) · theme=dark|light ·
//      lite=1 · t=<ms> (start position) · freeze=1 (no clock) · track=0|1 · reduced=1
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import "../tokens.css";
import "../glass.css";
import "../lyrics.css";
import "./preview.css";
import "./lyrics-preview.css";
import { GlassFilters } from "../GlassFilters";
import { readIslandGeometry, type BoxSize } from "../geometry";
import { lyricsMotion, pressScale, springs } from "../motion";
import {
  activeLineIndex,
  lineState,
  lyricLevel,
  lyricsPaletteStyle,
  paletteContrast,
  paletteFromImage,
  staggerSteps,
  type LyricsPalette,
  type LyricsTheme,
} from "../lyrics";
import {
  IconBack,
  IconCheck,
  IconCleanText,
  IconClipboard,
  IconCode,
  IconCollapse,
  IconCommand,
  IconFolder,
  IconGlobe,
  IconHome,
  IconLyrics,
  IconMore,
  IconMusic,
  IconNext,
  IconNote,
  IconPause,
  IconPipette,
  IconPlus,
  IconPrevious,
  IconQr,
  IconRecord,
  IconRegion,
  IconScanText,
  IconScreen,
  IconSettings,
  IconSpeaker,
  IconTerminal,
  IconText,
  IconVolume,
  type IconProps,
} from "../icons";

// ───────────────────────────── params ─────────────────────────────
const params = new URLSearchParams(location.search);
const SOLO = params.get("solo") ?? "";
const THEME: LyricsTheme = params.get("theme") === "light" ? "light" : "dark";
const LITE = params.get("lite") === "1";
const FREEZE = params.get("freeze") === "1";
const REDUCED = params.get("reduced") === "1";
const START_T = Number(params.get("t") ?? 15200);
const START_TRACK = params.get("track") === "1" ? 1 : 0;
document.documentElement.dataset.theme = THEME;
if (LITE) document.documentElement.dataset.lite = "true";

// ───────────────────────────── invented tracks ─────────────────────────────
interface Line {
  timeMs: number;
  /** "" = instrumental interlude (rendered as three dots). */
  text: string;
}
interface Track {
  title: string;
  artist: string;
  durationMs: number;
  cover: string; // data URL generated below
  canvas: HTMLCanvasElement;
  lines: Line[];
}

function drawCover(kind: 0 | 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 240;
  const g = c.getContext("2d")!;
  if (kind === 0) {
    // "Paper lighthouses": dusk sky, a sun, a dark shore with a small tower.
    const sky = g.createLinearGradient(0, 0, 0, 240);
    sky.addColorStop(0, "#ff8a3d");
    sky.addColorStop(0.5, "#d2366e");
    sky.addColorStop(1, "#3a1a6e");
    g.fillStyle = sky;
    g.fillRect(0, 0, 240, 240);
    g.fillStyle = "#ffd36e";
    g.beginPath();
    g.arc(160, 92, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgb(40 14 70 / 0.85)";
    g.fillRect(0, 168, 240, 72);
    g.fillStyle = "#1c0b3a";
    g.fillRect(52, 112, 18, 60);
    g.fillStyle = "#ffe9a8";
    g.fillRect(52, 104, 18, 10);
    g.strokeStyle = "rgb(255 210 140 / 0.5)";
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(20 + i * 12, 190 + i * 11);
      g.lineTo(220 - i * 16, 190 + i * 11);
      g.stroke();
    }
  } else {
    // "Low tide": deep blue to teal, a pale moon, white wave arcs.
    const sea = g.createLinearGradient(0, 0, 240, 240);
    sea.addColorStop(0, "#0b2f66");
    sea.addColorStop(1, "#11b0a4");
    g.fillStyle = sea;
    g.fillRect(0, 0, 240, 240);
    g.fillStyle = "#e6f6ff";
    g.beginPath();
    g.arc(72, 70, 30, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgb(255 255 255 / 0.55)";
    g.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(120, 300 + i * 6, 150 - i * 18, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
  }
  return c;
}

function makeTrack(kind: 0 | 1, title: string, artist: string, durationMs: number, lines: Line[]): Track {
  const canvas = drawCover(kind);
  return { title, artist, durationMs, canvas, cover: canvas.toDataURL("image/png"), lines };
}

const TRACKS: Track[] = [
  makeTrack(0, "Бумажные маяки", "Нордвик", 208_000, [
    { timeMs: 4000, text: "Фонари считают шаги до утра" },
    { timeMs: 7600, text: "Город дышит тише, чем вчера" },
    { timeMs: 11200, text: "Мы рисуем окна на стекле" },
    { timeMs: 14800, text: "Paper lanterns drifting through the rain" },
    { timeMs: 18400, text: "Every signal fades and lights again" },
    { timeMs: 22000, text: "Назови меня по имени ветров — я вернусь сквозь сотню городов и снов" },
    { timeMs: 26600, text: "Hold the line, the morning's almost here" },
    { timeMs: 30200, text: "" },
    { timeMs: 38000, text: "Тихий берег, тёплая вода" },
    { timeMs: 41600, text: "Мы не спим, и это навсегда" },
    { timeMs: 45200, text: "Static on the radio keeps humming every word we never dared to say out loud tonight" },
    { timeMs: 50000, text: "Фонари считают шаги до утра" },
    { timeMs: 53600, text: "Бумажные маяки горят" },
  ]),
  makeTrack(1, "Low Tide Hours", "Mira Vale", 196_000, [
    { timeMs: 3000, text: "Salt on the window, slow and bright" },
    { timeMs: 6400, text: "Counting the boats that leave tonight" },
    { timeMs: 9800, text: "Ты держишь небо на ладони" },
    { timeMs: 13200, text: "И море помнит наши имена" },
    { timeMs: 16600, text: "Low tide hours, quiet and wide" },
    { timeMs: 20000, text: "We wait for the water to change its mind" },
    { timeMs: 23400, text: "Отлив уносит всё, что было лишним" },
    { timeMs: 26800, text: "Only the lighthouse keeps the time" },
  ]),
];
const LOOP_END = (t: Track) => t.lines[t.lines.length - 1].timeMs + 5000;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ───────────────────────────── shared clock ─────────────────────────────
function usePlayback() {
  const [track, setTrack] = useState(START_TRACK);
  const [pos, setPos] = useState(START_T);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (FREEZE || !playing) return;
    const id = window.setInterval(() => {
      setPos((p) => (p + 100 > LOOP_END(TRACKS[track]) ? 1500 : p + 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [track, playing]);
  return {
    track: TRACKS[track],
    trackIndex: track,
    pos,
    playing,
    togglePlay: () => setPlaying((p) => !p),
    nextTrack: () => {
      setTrack((t) => (t + 1) % TRACKS.length);
      setPos(1500);
    },
  };
}
type Playback = ReturnType<typeof usePlayback>;

const paletteCache = new Map<string, LyricsPalette>();
function paletteFor(track: Track, theme: LyricsTheme): LyricsPalette {
  const key = `${track.title}:${theme}`;
  let p = paletteCache.get(key);
  if (!p) {
    p = paletteFromImage(track.canvas, theme);
    paletteCache.set(key, p);
  }
  return p;
}

// ───────────────────────────── island pieces ─────────────────────────────
/** Two tint layers: a new palette goes to the hidden one, then the two cross-fade (opacity only). */
function Tint({ palette, on, lite }: { palette: LyricsPalette; on: boolean; lite?: boolean }) {
  const [slots, setSlots] = useState<{ p: [LyricsPalette, LyricsPalette]; active: 0 | 1 }>({ p: [palette, palette], active: 0 });
  useEffect(() => {
    setSlots((s) => {
      if (s.p[s.active] === palette) return s;
      const next = (1 - s.active) as 0 | 1;
      const p: [LyricsPalette, LyricsPalette] = [...s.p];
      p[next] = palette;
      return { p, active: next };
    });
  }, [palette]);
  return (
    <>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="ig-lyrics-tint"
          data-on={on && slots.active === i}
          data-lite={lite || undefined}
          style={lyricsPaletteStyle(slots.p[i]) as CSSProperties}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

function Eq() {
  return (
    <span className="ig-eq pv-ly-eq" data-playing="false" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Island({ size, pill, tint, palette, lite, children }: { size: BoxSize; pill: boolean; tint: boolean; palette: LyricsPalette; lite?: boolean; children: ReactNode }) {
  const cls = ["ig-glass", "pv-ly-island", pill ? "ig-glass--pill" : "", tint ? "ig-glass--lyrics" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} style={{ width: size.width, height: size.height, borderRadius: size.radius }}>
      <Tint palette={palette} on={tint} lite={lite} />
      <div className={pill ? "pv-ly-layer" : "pv-ly-layer pv-ly-layer--panel"}>{children}</div>
    </div>
  );
}

function Frame({ label, collapsed, children }: { label: string; collapsed?: boolean; children: ReactNode }) {
  return (
    <div className="pv-ly-window">
      <div className={collapsed ? "pv-ly-app pv-ly-app-only-collapsed" : "pv-ly-app"} aria-hidden="true">
        <i /> <i /> <i /> <i /> <i /> <i /> <i /> <i />
      </div>
      {children}
      <span className="pv-ly-label">{label}</span>
    </div>
  );
}

// ───────────────────────────── (а) collapsed pill ─────────────────────────────
function PillLyric({ pb }: { pb: Playback }) {
  const { track, pos } = pb;
  const active = activeLineIndex(track.lines, pos);
  const line = active >= 0 ? track.lines[active] : null;
  const isLine = !!line && line.text !== "";
  const key = isLine ? `l${active}` : "title";
  const shift = REDUCED ? 0 : lyricsMotion.pillLine.shift;
  return (
    <div className="ig-pill-row ig-pill-row--lyrics" data-state="playing">
      <span className="ig-art ig-art--pill" aria-hidden="true">
        <img src={track.cover} alt="" draggable={false} />
      </span>
      <span className="ig-pill-lyric">
        <AnimatePresence initial={false}>
          <motion.span
            key={key}
            initial={{ opacity: 0, y: shift }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -shift }}
            transition={{ duration: REDUCED ? 0 : lyricsMotion.pillLine.duration, ease: lyricsMotion.pillLine.ease }}
          >
            <span className="ig-pill-lyric__text" data-kind={isLine ? "line" : "title"}>
              {isLine ? line!.text : `${track.title} · ${track.artist}`}
            </span>
          </motion.span>
        </AnimatePresence>
      </span>
      {/* Screen readers: one polite announcement per line, debounced (spec §6.11 «Доступность»); hidden here. */}
      <Eq />
    </div>
  );
}

function CollapsedFrame({ pb, palette }: { pb: Playback; palette: LyricsPalette }) {
  const geo = useMemo(() => readIslandGeometry(), []);
  return (
    <Frame label="(а) пилюля · текущая строка · цвет обложки" collapsed>
      <Island size={geo.pillLyrics} pill tint palette={palette}>
        <PillLyric pb={pb} />
      </Island>
    </Frame>
  );
}

// ───────────────────────────── (б) Home with the «Текст» button ─────────────────────────────
const TABS: { id: string; title: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: "home", title: "Главная", Icon: IconHome },
  { id: "clipboard", title: "Буфер", Icon: IconClipboard },
  { id: "text", title: "Текст", Icon: IconText },
  { id: "notes", title: "Заметки", Icon: IconNote },
];
const TOOLS: { title: string; Icon: (p: IconProps) => ReactNode }[] = [
  { title: "Область", Icon: IconRegion },
  { title: "Весь экран", Icon: IconScreen },
  { title: "Текст с экрана", Icon: IconScanText },
  { title: "QR-код", Icon: IconQr },
  { title: "Пипетка", Icon: IconPipette },
  { title: "Чистый текст", Icon: IconCleanText },
  { title: "Запись экрана", Icon: IconRecord },
  { title: "Команда", Icon: IconCommand },
  { title: "Ещё", Icon: IconMore },
];
const DOCK = [IconFolder, IconTerminal, IconCode, IconGlobe, IconSettings];
const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

function PanelHeadTabs() {
  return (
    <header className="pv-panel-head">
      <nav className="ig-tabbar" role="tablist" aria-label="Вкладки острова">
        {TABS.map(({ id, title, Icon }) => (
          <button key={id} className="ig-tab" role="tab" aria-selected={id === "home"}>
            {id === "home" && <span className="ig-tab-thumb" />}
            <Icon size={16} />
            <span>{title}</span>
          </button>
        ))}
      </nav>
      <div className="pv-panel-head-right">
        <span className="pv-head-clock">
          <span className="ig-num pv-head-time">14:32</span>
          <span className="pv-caption">вт, 10 нояб.</span>
        </span>
        <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" aria-label="Настройки">
          <IconSettings />
        </button>
        <button className="ig-glass-control ig-glass-control--icon" aria-label="Свернуть">
          <IconCollapse />
        </button>
      </div>
    </header>
  );
}

function Seek({ pb }: { pb: Playback }) {
  const pct = Math.min(100, (pb.pos / pb.track.durationMs) * 100);
  return (
    <div className="pv-seek pv-ly-seek">
      <span className="pv-time ig-num">{fmt(pb.pos)}</span>
      <input className="ig-glass-slider" type="range" min={0} max={100} value={pct} readOnly style={{ "--ig-value": `${pct}%` } as CSSProperties} aria-label="Позиция трека" />
      <span className="pv-time ig-num">{fmt(pb.track.durationMs)}</span>
    </div>
  );
}

function Transport({ pb }: { pb: Playback }) {
  return (
    <>
      <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} aria-label="Предыдущий трек" onClick={pb.nextTrack}>
        <IconPrevious size={18} />
      </motion.button>
      <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg pv-play" {...tap} aria-label="Пауза" onClick={pb.togglePlay}>
        <IconPause size={18} />
      </motion.button>
      <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} aria-label="Следующий трек" onClick={pb.nextTrack}>
        <IconNext size={18} />
      </motion.button>
    </>
  );
}

function HomeBody({ pb, onLyrics }: { pb: Playback; onLyrics: () => void }) {
  return (
    <div className="pv-panel">
      <PanelHeadTabs />
      <div className="pv-panel-body">
        <div className="pv-home">
          <div className="pv-home-left">
            <section className="ig-glass-card pv-player" aria-label="Мини-плеер">
              <div className="pv-player-top">
                <span className="ig-art pv-art-shadow" aria-hidden="true">
                  <img src={pb.track.cover} alt="" draggable={false} />
                </span>
                <div className="pv-player-meta">
                  <span className="pv-caption">Сейчас играет · Плеер</span>
                  <span className="pv-track ig-truncate">{pb.track.title}</span>
                  <span className="pv-artist ig-truncate">{pb.track.artist}</span>
                  <div className="pv-player-controls">
                    <Transport pb={pb} />
                    <motion.button
                      className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-lyrics-toggle"
                      data-available="synced"
                      {...tap}
                      aria-label="Текст песни"
                      title="Текст песни (синхронный)"
                      aria-pressed={false}
                      onClick={onLyrics}
                    >
                      <IconLyrics size={18} />
                    </motion.button>
                  </div>
                </div>
              </div>
              <Seek pb={pb} />
            </section>
            <section className="ig-glass-card pv-volume" aria-label="Громкость">
              <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Выключить звук">
                <IconVolume size={16} />
              </button>
              <input className="ig-glass-slider ig-glass-slider--accent" type="range" min={0} max={100} value={64} readOnly style={{ "--ig-value": "64%" } as CSSProperties} aria-label="Громкость" />
              <span className="pv-vol-value ig-num">64%</span>
              <button className="ig-glass-control pv-device">
                <IconSpeaker size={14} />
                <span>Динамики</span>
              </button>
            </section>
          </div>
          <section className="pv-tools" aria-label="Быстрые инструменты">
            {TOOLS.map(({ title, Icon }) => (
              <button key={title} className="ig-glass-control ig-glass-control--tile">
                <Icon />
                <span>{title}</span>
              </button>
            ))}
          </section>
          <section className="ig-glass-card pv-dock" aria-label="Док">
            {DOCK.map((Icon, i) => (
              <button key={i} className="ig-glass-control ig-glass-control--icon ig-glass-control--lg pv-dock-app" aria-label="Ярлык">
                <Icon size={22} />
              </button>
            ))}
            <span className="pv-dock-sep" aria-hidden="true" />
            <button className="ig-glass-control ig-glass-control--icon ig-glass-control--lg ig-glass-control--ghost pv-dock-add" aria-label="Добавить ярлык">
              <IconPlus />
            </button>
            <span className="pv-dock-hint">Перетащите сюда приложение или папку</span>
          </section>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── (в)/(г) lyrics view ─────────────────────────────
type LyricsVariant = "synced" | "loading" | "plain" | "none";

function SyncedLines({ pb, lite }: { pb: Playback; lite?: boolean }) {
  const { track, pos } = pb;
  const active = activeLineIndex(track.lines, pos);
  const viewport = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [y, setY] = useState(0);
  // Opening the view / changing the track jumps to the active line without a scroll animation (data-instant).
  const [instant, setInstant] = useState(true);
  useLayoutEffect(() => {
    setInstant(true);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    return () => cancelAnimationFrame(id);
  }, [track]);
  useLayoutEffect(() => {
    const vp = viewport.current;
    const el = lineRefs.current[Math.max(0, active)];
    if (!vp || !el) return;
    // offsetTop ignores transforms → stable target; anchor = --ig-lyrics-anchor (30 %) of the viewport.
    setY(Math.round(vp.clientHeight * 0.3 - el.offsetTop));
  }, [active, track]);
  return (
    <div ref={viewport} className="ig-lyrics" data-seekable="true" data-lite={lite || undefined} data-reduced={REDUCED || instant || undefined} tabIndex={0} aria-label="Текст песни">
      <ol className="ig-lyrics__track" style={{ "--ly-y": `${y}px` } as CSSProperties}>
        {track.lines.map((l, i) => {
          const state = lineState(i, active);
          const interlude = l.text === "";
          let dots = 0;
          if (interlude && state === "active") {
            const end = track.lines[i + 1]?.timeMs ?? l.timeMs + lyricsMotion.interludeMs;
            dots = Math.min(3, Math.floor(((pos - l.timeMs) / (end - l.timeMs)) * 3) + 1);
          }
          return (
            <li
              key={`${track.title}-${i}`}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className="ig-lyrics__line"
              data-state={state}
              data-level={lyricLevel(i, active)}
              aria-current={state === "active" ? "true" : undefined}
              style={{ "--ly-step": staggerSteps(i, active) } as CSSProperties}
            >
              {interlude ? (
                <span className="ig-lyrics__dots" aria-label="Проигрыш">
                  {[0, 1, 2].map((d) => (
                    <i key={d} data-on={d < dots} />
                  ))}
                </span>
              ) : (
                <span className="ig-lyrics__text">{l.text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LyricsColumn({ pb, variant, lite }: { pb: Playback; variant: LyricsVariant; lite?: boolean }) {
  if (variant === "synced") return <SyncedLines pb={pb} lite={lite} />;
  if (variant === "plain")
    return (
      <div className="ig-lyrics ig-lyrics--plain" tabIndex={0} aria-label="Текст песни">
        <ol className="ig-lyrics__track">
          {pb.track.lines.filter((l) => l.text).map((l, i) => (
            <li key={i} className="ig-lyrics__line">
              <span className="ig-lyrics__text">{l.text}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  if (variant === "loading")
    return (
      <div className="ig-lyrics" aria-busy="true" aria-label="Текст загружается">
        <div className="ig-lyrics-skeleton" aria-hidden="true">
          <i style={{ width: "72%" }} />
          <i style={{ width: "58%" }} />
          <i style={{ width: "80%" }} />
          <i style={{ width: "46%" }} />
        </div>
        <p className="ig-lyrics-credit" style={{ padding: "16px 10px 0", margin: 0 }}>
          Текст загружается…
        </p>
      </div>
    );
  return (
    <div className="ig-lyrics-state" role="status">
      <span className="ig-lyrics-state__icon" aria-hidden="true">
        <IconLyrics size={22} />
      </span>
      <span className="ig-lyrics-state__title">Текста пока нет</span>
      <span className="ig-lyrics-state__text">Для этой песни не нашлось текста. Попробуйте позже — мы проверим снова при следующем запуске трека.</span>
    </div>
  );
}

function LyricsBody({ pb, variant, onBack, lite, pillOn, onPill }: { pb: Playback; variant: LyricsVariant; onBack: () => void; lite?: boolean; pillOn: boolean; onPill: () => void }) {
  const caption = variant === "plain" ? "Без синхронизации" : variant === "synced" ? "Синхронный · LRCLIB" : variant === "loading" ? "Ищем текст…" : "Не найден";
  return (
    <div className="pv-panel">
      <header className="pv-panel-head">
        <div className="pv-ly-head-left">
          <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} aria-label="Назад к плееру" title="Назад (Esc)" onClick={onBack}>
            <IconBack />
          </motion.button>
          <span className="pv-ly-head-title">
            <b>Текст песни</b>
            <span className="ig-lyrics-credit">{caption}</span>
          </span>
        </div>
        <div className="pv-panel-head-right">
          <button className="ig-chip" aria-pressed={pillOn && variant === "synced"} disabled={variant !== "synced"} onClick={onPill} title="Показывать текущую строку в свёрнутой пилюле">
            {pillOn ? <IconCheck size={14} /> : <IconLyrics size={14} />}
            <span>В пилюле</span>
          </button>
          <button className="ig-glass-control ig-glass-control--icon" aria-label="Свернуть">
            <IconCollapse />
          </button>
        </div>
      </header>
      <div className="pv-panel-body">
        <div className="ig-lyrics-view">
          <aside className="ig-lyrics-side">
            <span className="ig-art" aria-hidden="true">
              {variant === "none" && !pb.track ? <IconMusic size={32} /> : <img src={pb.track.cover} alt="" draggable={false} />}
            </span>
            <span className="ig-lyrics-side__title ig-truncate">{pb.track.title}</span>
            <span className="ig-lyrics-side__artist ig-truncate">{pb.track.artist}</span>
            <div className="ig-lyrics-side__controls">
              <Transport pb={pb} />
            </div>
            <Seek pb={pb} />
          </aside>
          <LyricsColumn pb={pb} variant={variant} lite={lite} />
        </div>
      </div>
    </div>
  );
}

function PanelFrame({ pb, label, startView, variant = "synced", theme = THEME, lite }: { pb: Playback; label: string; startView: "home" | "lyrics"; variant?: LyricsVariant; theme?: LyricsTheme; lite?: boolean }) {
  const geo = useMemo(() => readIslandGeometry(), []);
  const [view, setView] = useState(startView);
  const [pillOn, setPillOn] = useState(true);
  const palette = paletteFor(pb.track, theme);
  const lyrics = view === "lyrics";
  return (
    <Frame label={label}>
      <Island size={geo.panel} pill={false} tint={lyrics} palette={palette} lite={lite}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            style={{ height: "100%" }}
            initial={{ opacity: 0, x: REDUCED ? 0 : lyrics ? 16 : -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: REDUCED ? 0 : lyrics ? -12 : 16 }}
            transition={{ ...springs.view, opacity: { duration: 0.12 } }}
          >
            {lyrics ? (
              <LyricsBody pb={pb} variant={variant} lite={lite} onBack={() => setView("home")} pillOn={pillOn} onPill={() => setPillOn((v) => !v)} />
            ) : (
              <HomeBody pb={pb} onLyrics={() => setView("lyrics")} />
            )}
          </motion.div>
        </AnimatePresence>
      </Island>
    </Frame>
  );
}

// ───────────────────────────── page ─────────────────────────────
function Readout({ pb }: { pb: Playback }) {
  return (
    <span className="pv-ly-readout">
      {(["dark", "light"] as const).map((th) => {
        const p = paletteFor(pb.track, th);
        return (
          <span key={th}>
            {" "}
            {th}:
            {[p.a, p.b, p.c].map((c) => (
              <i key={c} className="pv-ly-swatch" style={{ background: c }} />
            ))}{" "}
            {c2(paletteContrast(p))}:1
          </span>
        );
      })}
    </span>
  );
}
const c2 = (n: number) => n.toFixed(1);

function Page() {
  const pb = usePlayback();
  const palette = paletteFor(pb.track, THEME);

  if (SOLO) {
    document.body.classList.add("pv-ly-solo");
    return (
      <>
        {SOLO === "collapsed" && <CollapsedFrame pb={pb} palette={palette} />}
        {SOLO === "home" && <PanelFrame pb={pb} label="" startView="home" />}
        {SOLO === "lyrics" && <PanelFrame pb={pb} label="" startView="lyrics" lite={LITE} />}
        {(SOLO === "loading" || SOLO === "plain" || SOLO === "none") && <PanelFrame pb={pb} label="" startView="lyrics" variant={SOLO} />}
      </>
    );
  }

  return (
    <main className="pv-ly-page">
      <header>
        <h1>Текст песен — v0.4/0.5</h1>
        <p>
          Синхронный текст: строка в пилюле и вид «Текст песни» на острове, окрашенном под обложку. Все строки, названия и исполнители выдуманы для макета. Прокрутка в превью идёт по таймеру; размытие — статичными ступенями
          0 / 1 / 2 / 3 px, только прозрачность и translateY, без scale. Спецификация: docs/design-spec.md §6.11.
        </p>
        <div className="pv-ly-toolbar">
          <button className="ig-glass-control" onClick={pb.nextTrack}>
            Сменить трек (переход цвета 400 мс)
          </button>
          <button className="ig-glass-control" onClick={pb.togglePlay}>
            {pb.playing ? "Пауза" : "Пуск"}
          </button>
          <span className="pv-ly-readout">
            {fmt(pb.pos)} · строка {activeLineIndex(pb.track.lines, pb.pos) + 1}/{pb.track.lines.length}
          </span>
          <Readout pb={pb} />
          <a href="?theme=light">светлая</a>
          <a href="?theme=dark">тёмная</a>
          <a href="?solo=lyrics&theme=light&lite=1">(г) светлая + «Лёгкий» целиком</a>
          <a href="?reduced=1">reduced motion</a>
        </div>
      </header>
      <div className="pv-ly-grid">
        <figure>
          <CollapsedFrame pb={pb} palette={palette} />
          <figcaption>
            <b>(а) Свёрнутая пилюля.</b> 384×36, мини-обложка 24 · текущая строка (13px bold, 1 строка, многоточие) · эквалайзер. Пилюля окрашена тем же слоем, что и раскрытый вид (верх градиента).
          </figcaption>
        </figure>
        <figure>
          <PanelFrame pb={pb} label="(б) Главная · кнопка «Текст» на плеере" startView="home" />
          <figcaption>
            <b>(б) Главная.</b> Кнопка «Текст песни» — справа в ряду транспорта, точка-индикатор, если найден синхронный текст. Нажмите — откроется вид (в).
          </figcaption>
        </figure>
        <figure>
          <PanelFrame pb={pb} label="(в) текст песни · тёмная тема" startView="lyrics" />
          <figcaption>
            <b>(в) Вид «Текст песни».</b> Весь остров — градиент из цветов обложки; слева обложка 176, название, транспорт; справа строки: активная белая, соседи приглушены и размыты ступенями. Клик по строке — перемотка.
          </figcaption>
        </figure>
        <figure>
          <PanelFrame pb={pb} label="(г) светлая палитра · «Лёгкий»: без blur" startView="lyrics" theme="light" lite />
          <figcaption>
            <b>(г) Светлая тема + «Лёгкий».</b> Палитра светлее (контраст белого ≥ 4.6:1 вместо 6:1), размытия нет — только прозрачность, без каскада задержек.
          </figcaption>
        </figure>
      </div>
      <h2 className="pv-ly-section">Состояния</h2>
      <div className="pv-ly-grid">
        <figure>
          <PanelFrame pb={pb} label="загрузка" startView="lyrics" variant="loading" />
          <figcaption>
            <b>Загрузка.</b> Скелет из 4 полос (пульс прозрачности только пока идёт запрос).
          </figcaption>
        </figure>
        <figure>
          <PanelFrame pb={pb} label="без синхронизации" startView="lyrics" variant="plain" />
          <figcaption>
            <b>Только обычный текст.</b> Без подсветки и автопрокрутки, 17px, обычный скролл колесом. Пилюля в этом режиме показывает название, а не строку.
          </figcaption>
        </figure>
        <figure>
          <PanelFrame pb={pb} label="текста нет" startView="lyrics" variant="none" />
          <figcaption>
            <b>Текста нет.</b> Понятное пустое состояние; кнопка «Текст» на плеере в этом случае без точки.
          </figcaption>
        </figure>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion={REDUCED ? "always" : "user"}>
      <GlassFilters />
      <Page />
    </MotionConfig>
  </StrictMode>,
);
