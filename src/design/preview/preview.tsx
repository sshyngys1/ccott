// Owner: Designer. Static design preview: http://localhost:1430/src/design/preview/index.html (npx vite --port 1430).
// Not part of the app bundle. Uses only design tokens/classes; `pv-*` classes are preview chrome (wallpapers, frames, layout
// of the mock tabs). Wave-2 tab mock-ups live in ./tabs.tsx. URL parameters: see docs/design-spec.md (header).
import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import "../tokens.css";
import "../glass.css";
import "./preview.css";
import { GlassFilters } from "../GlassFilters";
import { fades, layerScale, pressScale, springs, viewSlide } from "../motion";
import { usePointerLight } from "../usePointerLight";
import { hoveredPill, readIslandGeometry, type BoxSize, type IslandGeometry } from "../geometry";
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
  IconMore,
  IconNote,
  IconPipette,
  IconPlay,
  IconQr,
  IconRecord,
  IconRegion,
  IconScanText,
  IconScreen,
  IconSettings,
  IconSpeaker,
  IconTerminal,
  IconText,
  type IconProps,
} from "../icons";
import { ClipboardTab, FocusGallery, HomeTab, NotesTab, PillContent, SettingsView, TextTab, type PillState, type Variant } from "./tabs";

type Theme = "dark" | "light";
type Vibrancy = "none" | "acrylic" | "mica";
type Wallpaper = "vivid" | "white" | "night";
type TabId = "home" | "clipboard" | "text" | "notes";
type View = TabId | "settings";

const TABS: { id: TabId; title: string; Icon: (p: IconProps) => ReactNode }[] = [
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

const DOCK: { title: string; Icon: (p: IconProps) => ReactNode }[] = [
  { title: "Проводник", Icon: IconFolder },
  { title: "Терминал", Icon: IconTerminal },
  { title: "Редактор кода", Icon: IconCode },
  { title: "Браузер", Icon: IconGlobe },
  { title: "Параметры", Icon: IconSettings },
];

const VARIANT_LABELS: Record<View, Record<Variant, string>> = {
  home: { default: "Играет", empty: "Нет медиа", alt: "Играет" },
  clipboard: { default: "Список", empty: "Пусто", alt: "Не найдено" },
  text: { default: "Текст", empty: "Пусто", alt: "Ошибка JSON" },
  notes: { default: "Таймер идёт", empty: "Пусто", alt: "Таймер готов" },
  settings: { default: "—", empty: "—", alt: "—" },
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Preview only: tick once a minute, aligned to the minute boundary.
    let interval = 0;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  return { time, date };
}

// ───────────────────────────── Panel ─────────────────────────────

function TabBody({ view, variant, focus }: { view: View; variant: Variant; focus: boolean }) {
  switch (view) {
    case "home":
      return <HomeTab variant={variant} tools={TOOLS} dock={DOCK} />;
    case "clipboard":
      return <ClipboardTab variant={variant} focus={focus} />;
    case "text":
      return <TextTab variant={variant} focus={focus} />;
    case "notes":
      return <NotesTab variant={variant} focus={focus} />;
    case "settings":
      return <SettingsView />;
  }
}

function PanelContent({ view, onView, onCollapse, clock, variant, focus }: { view: View; onView: (v: View) => void; onCollapse: () => void; clock: { time: string; date: string }; variant: Variant; focus: boolean }) {
  const lastTab = useRef<TabId>(view === "settings" ? "home" : view);
  if (view !== "settings") lastTab.current = view;
  const settings = view === "settings";
  // Settings slide in from the right; tabs keep the vertical tab slide (spec §6.8).
  const enter = settings ? { opacity: 0, x: viewSlide.enter } : { opacity: 0, y: 6 };
  const exit = settings ? { opacity: 0, x: viewSlide.enter } : { opacity: 0, y: -4 };
  return (
    <div className="pv-panel">
      <header className="pv-panel-head">
        <AnimatePresence mode="wait" initial={false}>
          {settings ? (
            <motion.div key="settings-head" className="pv-settings-head" initial={{ opacity: 0, x: viewSlide.enter }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewSlide.enter }} transition={{ ...springs.view, opacity: fades.pillSwap }}>
              <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" whileTap={{ scale: pressScale }} transition={springs.press} aria-label="Назад" title="Назад (Esc)" onClick={() => onView(lastTab.current)}>
                <IconBack />
              </motion.button>
              <h2 className="pv-view-title">Настройки</h2>
            </motion.div>
          ) : (
            <motion.div key="tabs-head" initial={{ opacity: 0, x: viewSlide.exit }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewSlide.exit }} transition={{ ...springs.view, opacity: fades.pillSwap }}>
              <LayoutGroup id="pv-tabs">
                <nav className="ig-tabbar" role="tablist" aria-label="Вкладки острова">
                  {TABS.map(({ id, title, Icon }) => (
                    <button key={id} className="ig-tab" role="tab" aria-selected={view === id} onClick={() => onView(id)}>
                      {view === id && <motion.span layoutId="pv-tab-thumb" className="ig-tab-thumb" transition={springs.tab} />}
                      <Icon size={16} />
                      <span>{title}</span>
                    </button>
                  ))}
                </nav>
              </LayoutGroup>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pv-panel-head-right">
          <span className="pv-head-clock">
            <span className="ig-num pv-head-time">{clock.time}</span>
            <span className="pv-caption">{clock.date}</span>
          </span>
          <button
            className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
            aria-label="Настройки"
            title="Настройки"
            aria-pressed={settings}
            onClick={() => onView(settings ? lastTab.current : "settings")}
          >
            <IconSettings />
          </button>
          <button className="ig-glass-control ig-glass-control--icon" aria-label="Свернуть" title="Свернуть (Esc)" onClick={onCollapse}>
            <IconCollapse />
          </button>
        </div>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${view}-${variant}`}
          className="pv-panel-body"
          initial={enter}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={exit}
          transition={{ ...(settings ? springs.view : springs.tab), opacity: fades.pillSwap }}
        >
          <TabBody view={view} variant={variant} focus={focus} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────── Live island (inside an 800×520 window frame) ─────────────────────────────

type TransitionKind = "expand" | "collapse" | "pill";

function pillSize(geo: IslandGeometry, state: PillState): BoxSize {
  if (state === "toast") return geo.pillToast;
  if (state === "idle") return geo.pill;
  return geo.pillActivity; // media (playing/paused) and timer share --ig-pill-width-activity
}

function LiveIsland({ geo, pillState, expanded, setExpanded, clock, view, setView, variant, focus }: { geo: IslandGeometry; pillState: PillState; expanded: boolean; setExpanded: (v: boolean) => void; clock: { time: string; date: string }; view: View; setView: (v: View) => void; variant: Variant; focus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointerLight(ref);
  const [hover, setHover] = useState(false);
  const [kind, setKind] = useState<TransitionKind>("pill");
  const prevExpanded = useRef(expanded);
  useEffect(() => {
    if (prevExpanded.current !== expanded) setKind(expanded ? "expand" : "collapse");
    prevExpanded.current = expanded;
  }, [expanded]);

  const base = pillSize(geo, pillState);
  const size: BoxSize = expanded ? geo.panel : hover ? hoveredPill(base, geo.pillHoverGrow) : base;

  return (
    <motion.div
      ref={ref}
      className={expanded ? "ig-glass pv-island" : "ig-glass ig-glass--pill pv-island"}
      data-hover={!expanded && hover}
      initial={false}
      animate={{ width: size.width, height: size.height, borderRadius: size.radius }}
      transition={springs[kind]}
      style={{ top: geo.top }}
      onHoverStart={() => {
        setKind("pill");
        setHover(true);
      }}
      onHoverEnd={() => {
        if (!expanded) setKind("pill");
        setHover(false);
      }}
      onClick={() => !expanded && setExpanded(true)}
    >
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div key="panel" className="pv-island-layer pv-island-layer--panel" style={{ width: geo.panel.width, height: geo.panel.height }} initial={{ opacity: 0, scale: layerScale.panelEnter }} animate={{ opacity: 1, scale: 1, transition: fades.panelIn }} exit={{ opacity: 0, scale: layerScale.panelExit, transition: fades.panelOut }}>
            <PanelContent view={view} onView={setView} onCollapse={() => setExpanded(false)} clock={clock} variant={variant} focus={focus} />
          </motion.div>
        ) : (
          <motion.div key={`pill-${pillState}`} className="pv-island-layer" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fades.pillIn }} exit={{ opacity: 0, transition: fades.pillOut }}>
            <PillContent state={pillState} time={clock.time} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ───────────────────────────── Static pills & goo demo ─────────────────────────────

function StaticPill({ size, state, hover = false, time, label }: { size: BoxSize; state: PillState; hover?: boolean; time: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointerLight(ref);
  return (
    <figure className="pv-state">
      <div className="pv-state-stage">
        <div ref={ref} className="ig-glass ig-glass--pill pv-static-pill" data-hover={hover} style={{ width: size.width, height: size.height, borderRadius: size.radius }}>
          <div className="pv-island-layer">
            <PillContent state={state} time={time} />
          </div>
        </div>
      </div>
      <figcaption>
        <b>{label}</b> <span className="ig-num">{Math.round(size.width)}×{Math.round(size.height)}</span>
      </figcaption>
    </figure>
  );
}

function GooDemo({ geo, time }: { geo: IslandGeometry; time: string }) {
  const [open, setOpen] = useState(() => readParam("goo", ["0", "1"] as const, "0") === "1");
  const pill = geo.pill;
  const drop = pill.height;
  const offset = open ? pill.width / 2 + drop / 2 + 10 : pill.width / 2 - drop / 2 - 4;
  return (
    <figure className="pv-state">
      <div className="pv-state-stage pv-goo-stage" onClick={() => setOpen((o) => !o)} role="button" aria-pressed={open} tabIndex={0}>
        {/* Shape layer: opaque shapes only, goo-filtered */}
        <div className="pv-goo-shapes" style={{ filter: "url(#ig-goo)" }} aria-hidden="true">
          <div className="pv-goo-pill" style={{ width: pill.width, height: pill.height, borderRadius: pill.radius }} />
          <motion.div className="pv-goo-drop" style={{ width: drop, height: drop }} initial={false} animate={{ x: offset, scale: open ? 1 : 0.7 }} transition={open ? springs.expand : springs.collapse} />
        </div>
        {/* Content layer: crisp, unfiltered */}
        <div className="pv-goo-content">
          <div className="pv-goo-pill-content" style={{ width: pill.width, height: pill.height }}>
            <PillContent state="idle" time={time} />
          </div>
          <motion.div className="pv-goo-drop-content" style={{ width: drop, height: drop }} initial={false} animate={{ x: offset, opacity: open ? 1 : 0 }} transition={open ? springs.expand : springs.collapse}>
            <IconCheck size={16} />
          </motion.div>
        </div>
      </div>
      <figcaption>
        <b>ig-goo</b> капля из пилюли — нажмите
      </figcaption>
    </figure>
  );
}

function PillStates({ geo, time }: { geo: IslandGeometry; time: string }) {
  return (
    <div className="pv-states">
      <StaticPill label="Покой" state="idle" size={geo.pill} time={time} />
      <StaticPill label="Наведение" state="idle" hover size={hoveredPill(geo.pill, geo.pillHoverGrow)} time={time} />
      <StaticPill label="Медиа · играет" state="activity" size={geo.pillActivity} time={time} />
      <StaticPill label="Медиа · пауза" state="paused" size={geo.pillActivity} time={time} />
      <StaticPill label="Таймер" state="timer" size={geo.pillActivity} time={time} />
      <StaticPill label="Таймер · готово" state="timerDone" size={geo.pillActivity} time={time} />
      <StaticPill label="Скопировано" state="toast" size={geo.pillToast} time={time} />
      <GooDemo geo={geo} time={time} />
    </div>
  );
}

// ───────────────────────────── Controls gallery ─────────────────────────────

function ControlsGallery() {
  const [vol, setVol] = useState(42);
  return (
    <div className="ig-glass pv-gallery">
      <div className="pv-gallery-col">
        <h3 className="pv-h3">.ig-glass-control</h3>
        <div className="pv-row">
          <button className="ig-glass-control">Обычная</button>
          <button className="ig-glass-control" data-pressed="true">Нажата</button>
          <button className="ig-glass-control" aria-pressed="true">Выбрана</button>
          <button className="ig-glass-control" data-focus-visible="true">Фокус</button>
          <button className="ig-glass-control" disabled>Недоступна</button>
        </div>
        <div className="pv-row">
          <button className="ig-glass-control ig-glass-control--accent">Акцент</button>
          <button className="ig-glass-control ig-glass-control--ghost">Ghost</button>
          <button className="ig-glass-control ig-glass-control--sm">Малая</button>
          <button className="ig-glass-control ig-glass-control--icon" aria-label="Иконка">
            <IconSettings />
          </button>
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg" aria-label="Круглая">
            <IconPlay size={18} />
          </button>
          <button className="ig-glass-control ig-glass-control--round">
            <IconSpeaker size={16} />
            Капсула
          </button>
        </div>
        <h3 className="pv-h3">.ig-chip · .ig-segmented · .ig-switch · .ig-progress · .ig-kbd</h3>
        <div className="pv-row">
          <button className="ig-chip">Заметка</button>
          <button className="ig-chip" aria-pressed="true">
            Работа <span className="ig-chip__count">2</span>
          </button>
          <button className="ig-chip ig-chip--add" aria-label="Добавить">
            +
          </button>
          <input type="checkbox" role="switch" className="ig-switch" aria-label="Выкл" />
          <input type="checkbox" role="switch" className="ig-switch" defaultChecked aria-label="Вкл" />
          <kbd className="ig-kbd">Enter</kbd>
          <kbd className="ig-kbd">Shift</kbd>
        </div>
        <div className="pv-row pv-row--stretch">
          <span className="ig-progress" style={{ "--ig-progress": 0.62 } as CSSProperties} />
          <span className="ig-progress" data-state="done" style={{ "--ig-progress": 1 } as CSSProperties} />
        </div>
        <h3 className="pv-h3">.ig-glass-input · .ig-glass-slider</h3>
        <div className="pv-row pv-row--stretch">
          <input className="ig-glass-input" placeholder="Плейсхолдер" />
          <input className="ig-glass-input" data-focus-visible="true" defaultValue="Фокус" />
        </div>
        <div className="pv-row pv-row--stretch">
          <input className="ig-glass-slider" type="range" value={vol} onChange={(e) => setVol(Number(e.target.value))} style={{ "--ig-value": `${vol}%` } as CSSProperties} aria-label="Слайдер" />
          <input className="ig-glass-slider ig-glass-slider--accent" type="range" value={100 - vol} onChange={(e) => setVol(100 - Number(e.target.value))} style={{ "--ig-value": `${100 - vol}%` } as CSSProperties} aria-label="Слайдер акцент" />
          <input className="ig-glass-slider ig-glass-slider--accent" type="range" defaultValue={64} data-muted="true" style={{ "--ig-value": "64%" } as CSSProperties} aria-label="Без звука" />
        </div>
      </div>
      <div className="pv-gallery-col pv-gallery-col--lens">
        <h3 className="pv-h3">.ig-glass--refract</h3>
        <div className="pv-lens-bed">
          <span className="pv-lens-text">Преломление</span>
          <motion.div className="ig-glass ig-glass--clear ig-glass--refract pv-lens" drag dragMomentum={false} dragElastic={0.1} whileDrag={{ scale: 1.06 }} transition={springs.press} />
        </div>
        <span className="pv-caption">Линзу можно перетаскивать. Только для мелких элементов.</span>
      </div>
    </div>
  );
}

// ───────────────────────────── Toolbar ─────────────────────────────

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="pv-seg">
      <span className="pv-seg-label">{label}</span>
      <div className="ig-tabbar" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} className="ig-tab" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {value === o.value && <motion.span layoutId={`pv-seg-${label}`} className="ig-tab-thumb" transition={springs.tab} />}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function readParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(location.search).get(name);
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function Preview() {
  const [theme, setTheme] = useState<Theme>(() => readParam("theme", ["dark", "light"] as const, "dark"));
  const [vibrancy, setVibrancy] = useState<Vibrancy>(() => readParam("vibrancy", ["none", "acrylic", "mica"] as const, "none"));
  const [wallpaper, setWallpaper] = useState<Wallpaper>(() => readParam("wall", ["vivid", "white", "night"] as const, "vivid"));
  const [pillState, setPillState] = useState<PillState>(() => readParam("pill", ["idle", "activity", "paused", "timer", "timerDone", "toast"] as const, "idle"));
  const [expanded, setExpanded] = useState(() => readParam("expanded", ["0", "1"] as const, "0") === "1");
  const [view, setView] = useState<View>(() => readParam("tab", ["home", "clipboard", "text", "notes", "settings"] as const, "home"));
  const [variant, setVariant] = useState<Variant>(() => readParam("v", ["default", "empty", "alt"] as const, "default"));
  const focus = readParam("focus", ["0", "1"] as const, "0") === "1";
  const solo = readParam("solo", ["0", "island", "pills", "focus"] as const, "0");
  const clock = useClock();
  const geo = useMemo(() => readIslandGeometry(), []);
  const toolbarRef = useRef<HTMLDivElement>(null);
  usePointerLight(toolbarRef);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.vibrancy = vibrancy;
  }, [theme, vibrancy]);

  const island = (
    <div className={`pv-window pv-window--${vibrancy}`}>
      {solo === "0" && (
        <span className="pv-window-label">
          прозрачное окно 800×520 · data-vibrancy="{vibrancy}"{vibrancy !== "none" ? " (нативный blur симулирован CSS)" : ""}
        </span>
      )}
      <LiveIsland geo={geo} pillState={pillState} expanded={expanded} setExpanded={setExpanded} clock={clock} view={view} setView={setView} variant={variant} focus={focus} />
    </div>
  );

  const wall = (
    <div className={`pv-wall pv-wall--${wallpaper}`} aria-hidden="true">
      <span className="pv-blob pv-blob--a" />
      <span className="pv-blob pv-blob--b" />
      <span className="pv-blob pv-blob--c" />
      <span className="pv-stripes" />
      <span className="pv-fake-window">
        <i />
        <i />
        <i />
      </span>
    </div>
  );

  // Screenshot mode: only one block, no chrome (docs/design/wave2-*.png).
  if (solo !== "0") {
    return (
      <MotionConfig reducedMotion="user">
        <GlassFilters />
        {wall}
        <main className={`pv-solo pv-solo--${solo}`}>
          {solo === "island" && island}
          {solo === "pills" && <PillStates geo={geo} time={clock.time} />}
          {solo === "focus" && (
            <div className="ig-glass pv-gallery pv-gallery--single">
              <FocusGallery />
            </div>
          )}
        </main>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <GlassFilters />
      {wall}

      <main className="pv-page">
        <div ref={toolbarRef} className="ig-glass pv-toolbar">
          <div className="pv-brand">
            <span className="pv-brand-mark" aria-hidden="true" />
            <div>
              <b>Meniscus</b>
              <span className="pv-caption">визуальный язык island-win · превью</span>
            </div>
          </div>
          <Segmented label="Тема" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }]} />
          <Segmented label="data-vibrancy" value={vibrancy} onChange={setVibrancy} options={[{ value: "none", label: "none" }, { value: "acrylic", label: "acrylic" }, { value: "mica", label: "mica" }]} />
          <Segmented label="Обои" value={wallpaper} onChange={setWallpaper} options={[{ value: "vivid", label: "Яркие" }, { value: "white", label: "Белое окно" }, { value: "night", label: "Тёмные" }]} />
        </div>

        <section className="pv-section">
          <div className="pv-section-head">
            <h2>Окно острова 800×520</h2>
            <div className="pv-row">
              <Segmented
                label="Пилюля"
                value={pillState}
                onChange={setPillState}
                options={[
                  { value: "idle", label: "Покой" },
                  { value: "activity", label: "Медиа" },
                  { value: "timer", label: "Таймер" },
                  { value: "toast", label: "Скопировано" },
                ]}
              />
              <motion.button className="ig-glass-control ig-glass-control--accent" whileTap={{ scale: pressScale }} transition={springs.press} onClick={() => setExpanded(true)} disabled={expanded}>
                Раскрыть
              </motion.button>
              <motion.button className="ig-glass-control" whileTap={{ scale: pressScale }} transition={springs.press} onClick={() => setExpanded(false)} disabled={!expanded}>
                Свернуть
              </motion.button>
            </div>
          </div>
          <div className="pv-section-head pv-section-head--sub">
            <span className="pv-caption">Вкладка открывается в раскрытой панели; шестерёнка в шапке — настройки.</span>
            <div className="pv-row">
              <Segmented
                label="Состояние вкладки"
                value={variant}
                onChange={setVariant}
                options={(["default", "empty", "alt"] as const).map((v) => ({ value: v, label: VARIANT_LABELS[view][v] }))}
              />
            </div>
          </div>
          {island}
        </section>

        <section className="pv-section">
          <h2>Состояния пилюли</h2>
          <PillStates geo={geo} time={clock.time} />
        </section>

        <section className="pv-section">
          <h2>Фокус (волна 2)</h2>
          <div className="ig-glass pv-gallery pv-gallery--single">
            <FocusGallery />
          </div>
        </section>

        <section className="pv-section">
          <h2>Контролы</h2>
          <ControlsGallery />
        </section>
      </main>
    </MotionConfig>
  );
}

// Apply theme/vibrancy before the first paint: otherwise surfaces would transition dark → light on load (and screenshots
// taken mid-transition come out grey).
document.documentElement.dataset.theme = readParam("theme", ["dark", "light"] as const, "dark");
document.documentElement.dataset.vibrancy = readParam("vibrancy", ["none", "acrylic", "mica"] as const, "none");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
