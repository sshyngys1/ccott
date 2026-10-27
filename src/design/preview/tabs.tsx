// Owner: Designer. Wave-2 tab mock-ups for the design preview (spec §6.2–§6.8). Reference DOM for F1/F2 — not app code.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { listItem, pressScale, springs } from "../motion";
import { ProgressRing } from "../ProgressRing";
import { useScrollFade } from "../useScrollFade";
import {
  IconBold,
  IconBraces,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconCleanText,
  IconClipboard,
  IconCopy,
  IconFile,
  IconItalic,
  IconLink,
  IconListBullet,
  IconMusic,
  IconNext,
  IconNote,
  IconPause,
  IconPin,
  IconPlay,
  IconPlus,
  IconPrevious,
  IconReset,
  IconSearch,
  IconSpeaker,
  IconSwap,
  IconText,
  IconTimer,
  IconTrash,
  IconUndo,
  IconVolume,
  IconVolumeMute,
  IconWarning,
  type IconProps,
} from "../icons";
import { CLIPS, FOLDERS, JSON_BROKEN, MONITORS, NOTES, TEXT_SAMPLE, TIMER_PRESETS, type MockClip } from "./mockData";

export type Variant = "default" | "empty" | "alt";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

/** Russian plural: plural(5, ["символ", "символа", "символов"]). Preview-only helper. */
function plural(n: number, forms: readonly [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function Eq({ playing = true }: { playing?: boolean }) {
  return (
    <span className="ig-eq" data-playing={playing} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

// ───────────────────────────── Pill: compact live activities (§6.7) ─────────────────────────────

export type PillState = "idle" | "activity" | "paused" | "timer" | "timerDone" | "toast";

export function PillContent({ state, time }: { state: PillState; time: string }) {
  if (state === "activity" || state === "paused") {
    const playing = state === "activity";
    return (
      <div className="ig-pill-row" data-state={playing ? "playing" : "paused"}>
        <span className="ig-art ig-art--pill" aria-hidden="true">
          <span className="pv-art-fill" />
        </span>
        <span className="ig-pill-title">
          <b>Полярный свет</b> · Lumen Drift
        </span>
        <Eq playing={playing} />
      </div>
    );
  }
  if (state === "timer" || state === "timerDone") {
    const done = state === "timerDone";
    return (
      <div className="ig-pill-row" data-state={done ? "done" : "running"}>
        <span className="pv-pill-ring">
          <ProgressRing value={done ? 1 : 0.84} size={22} stroke={2.5} state={done ? "done" : "running"} />
        </span>
        <span className="ig-pill-title">{done ? "Время вышло" : "Таймер"}</span>
        <span className="ig-pill-time">{done ? "0:00" : "4:12"}</span>
      </div>
    );
  }
  if (state === "toast") {
    return (
      <div className="ig-pill-row">
        <span className="pv-badge-ok" aria-hidden="true">
          <IconCheck size={14} />
        </span>
        <span className="pv-pill-label">Скопировано</span>
        <span className="pv-pill-preview ig-truncate">github.com/island-win/…</span>
      </div>
    );
  }
  return (
    <div className="ig-pill-row ig-pill-row--idle">
      <span className="ig-pill-time">{time}</span>
      <span className="pv-pill-weather">
        <IconCloudSmall />
        <span className="ig-num">12°</span>
      </span>
    </div>
  );
}

function IconCloudSmall() {
  return (
    <svg width={16} height={16} viewBox="0 0 20 20" className="ig-icon" aria-hidden="true">
      <path d="M6 15.5h8.25a3.25 3.25 0 0 0 .4-6.48A4.75 4.75 0 0 0 5.5 8.1 3.7 3.7 0 0 0 6 15.5Z" />
    </svg>
  );
}

// ───────────────────────────── Home (§6.2) ─────────────────────────────

function PlayerCard({ empty }: { empty: boolean }) {
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(38);
  return (
    <section className="ig-glass-card pv-player" aria-label="Мини-плеер">
      <div className="pv-player-top">
        <span className="ig-art pv-art-shadow" aria-hidden="true">
          {empty ? <IconMusic size={32} /> : <span className="pv-art-fill" />}
        </span>
        <div className="pv-player-meta">
          <span className="pv-caption">{empty ? "Плеер" : "Сейчас играет · Spotify"}</span>
          <span className="pv-track ig-truncate">{empty ? "Ничего не играет" : "Полярный свет"}</span>
          <span className="pv-artist ig-truncate">{empty ? "Запустите любой плеер" : "Lumen Drift"}</span>
          <div className="pv-player-controls">
            <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} disabled={empty} aria-label="Предыдущий трек">
              <IconPrevious size={18} />
            </motion.button>
            <motion.button
              className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg pv-play"
              {...tap}
              disabled={empty}
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Пауза" : "Воспроизвести"}
            >
              {playing && !empty ? <IconPause size={18} /> : <IconPlay size={18} />}
            </motion.button>
            <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} disabled={empty} aria-label="Следующий трек">
              <IconNext size={18} />
            </motion.button>
          </div>
        </div>
      </div>
      <div className="pv-seek">
        <span className="pv-time ig-num">{empty ? "–:––" : "1:24"}</span>
        <input
          className="ig-glass-slider"
          type="range"
          min={0}
          max={100}
          value={empty ? 0 : pos}
          disabled={empty}
          onChange={(e) => setPos(Number(e.target.value))}
          style={{ "--ig-value": `${empty ? 0 : pos}%` } as CSSProperties}
          aria-label="Позиция трека"
        />
        <span className="pv-time ig-num">{empty ? "–:––" : "3:41"}</span>
      </div>
    </section>
  );
}

function VolumeCard() {
  const [vol, setVol] = useState(64);
  const [muted, setMuted] = useState(false);
  return (
    <section className="ig-glass-card pv-volume" aria-label="Громкость">
      <motion.button
        className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
        {...tap}
        aria-pressed={muted}
        aria-label={muted ? "Включить звук" : "Выключить звук"}
        onClick={() => setMuted((m) => !m)}
      >
        {muted ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
      </motion.button>
      <input
        className="ig-glass-slider ig-glass-slider--accent"
        type="range"
        min={0}
        max={100}
        value={vol}
        data-muted={muted}
        onChange={(e) => {
          setVol(Number(e.target.value));
          setMuted(false);
        }}
        style={{ "--ig-value": `${vol}%` } as CSSProperties}
        aria-label="Громкость"
      />
      <span className="pv-vol-value ig-num">{muted ? "Без звука" : `${vol}%`}</span>
      <button className="ig-glass-control pv-device">
        <IconSpeaker size={16} />
        Динамики
        <IconChevronDown size={14} />
      </button>
    </section>
  );
}

export function HomeTab({ variant, tools, dock }: { variant: Variant; tools: { title: string; Icon: (p: IconProps) => ReactNode }[]; dock: { title: string; Icon: (p: IconProps) => ReactNode }[] }) {
  return (
    <div className="pv-home">
      <div className="pv-home-left">
        <PlayerCard empty={variant === "empty"} />
        <VolumeCard />
      </div>
      <section className="pv-tools" aria-label="Быстрые инструменты">
        {tools.map(({ title, Icon }) => (
          <motion.button key={title} className="ig-glass-control ig-glass-control--tile" {...tap}>
            <Icon />
            <span>{title}</span>
          </motion.button>
        ))}
      </section>
      <section className="ig-glass-card pv-dock" aria-label="Док">
        {dock.map(({ title, Icon }) => (
          <motion.button key={title} className="ig-glass-control ig-glass-control--icon ig-glass-control--lg pv-dock-app" {...tap} title={title} aria-label={title}>
            <Icon size={22} />
          </motion.button>
        ))}
        <span className="pv-dock-sep" aria-hidden="true" />
        <button className="ig-glass-control ig-glass-control--icon ig-glass-control--lg ig-glass-control--ghost pv-dock-add" aria-label="Добавить ярлык">
          <IconPlus />
        </button>
        <span className="pv-dock-hint">Перетащите сюда приложение или папку</span>
      </section>
    </div>
  );
}

// ───────────────────────────── Clipboard (§6.4) ─────────────────────────────

const KIND_ICON = { text: IconText, link: IconLink, files: IconFile } as const;

function ClipRow({ clip, selected, onSelect, onPin, onDelete }: { clip: MockClip; selected: boolean; onSelect: () => void; onPin: () => void; onDelete: () => void }) {
  const media = clip.kind === "image";
  const Lead = clip.kind === "image" ? null : KIND_ICON[clip.kind];
  return (
    <motion.li
      layout="position"
      {...listItem}
      transition={springs.list}
      className={media ? "ig-list-row ig-list-row--media" : "ig-list-row"}
      role="option"
      aria-selected={selected}
      onMouseDown={onSelect}
      title="Клик — вставить · Shift+клик — только скопировать"
    >
      {media ? (
        <span className="ig-thumb pv-shot" aria-hidden="true" />
      ) : (
        <span className="ig-list-row__lead" data-kind={clip.kind} aria-hidden="true">
          {Lead && <Lead size={16} />}
        </span>
      )}
      <span className="ig-list-row__body">
        <span className="ig-list-row__title" data-kind={clip.kind}>
          {media ? "Снимок экрана" : clip.preview}
        </span>
        <span className="ig-list-row__meta">
          {clip.extra && <span>{clip.extra} ·</span>}
          <span>{clip.app}</span>
          <span>·</span>
          <span>{clip.ago}</span>
        </span>
      </span>
      <span className="ig-list-row__actions">
        <button
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
          aria-pressed={clip.pinned}
          aria-label={clip.pinned ? "Открепить" : "Закрепить"}
          title={clip.pinned ? "Открепить" : "Закрепить"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onPin}
        >
          <IconPin size={16} />
        </button>
        <button
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm ig-glass-control--danger"
          aria-label="Удалить"
          title="Удалить (Del)"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onDelete}
        >
          <IconTrash size={16} />
        </button>
      </span>
    </motion.li>
  );
}

export function ClipboardTab({ variant, focus }: { variant: Variant; focus: boolean }) {
  const [clips, setClips] = useState<MockClip[]>(() => (variant === "empty" ? [] : CLIPS));
  const [query, setQuery] = useState(variant === "alt" ? "счёт-фактура" : "");
  const [sel, setSel] = useState(2);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollFade(scrollRef);

  const shown = useMemo(() => clips.filter((c) => (c.preview + c.app).toLowerCase().includes(query.trim().toLowerCase())), [clips, query]);
  const pinned = shown.filter((c) => c.pinned);
  const recent = shown.filter((c) => !c.pinned);
  const ordered = [...pinned, ...recent];

  const row = (c: MockClip) => (
    <ClipRow
      key={c.id}
      clip={c}
      selected={ordered[sel]?.id === c.id}
      onSelect={() => setSel(ordered.findIndex((o) => o.id === c.id))}
      onPin={() => setClips((all) => all.map((o) => (o.id === c.id ? { ...o, pinned: !o.pinned } : o)))}
      onDelete={() => setClips((all) => all.filter((o) => o.id !== c.id))}
    />
  );

  return (
    <div
      className="pv-clipboard"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") setSel((s) => Math.min(ordered.length - 1, s + 1));
        if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
      }}
    >
      <div className="pv-clip-head">
        <label className="ig-search pv-grow">
          <IconSearch size={16} />
          <input className="ig-glass-input" placeholder="Поиск в истории буфера" value={query} onChange={(e) => setQuery(e.target.value)} data-focus-visible={focus || undefined} aria-label="Поиск в истории буфера" />
          <kbd className="ig-kbd">Ctrl F</kbd>
        </label>
        <motion.button className="ig-glass-control ig-glass-control--danger" {...tap} disabled={clips.length === 0} onClick={() => setClips((all) => all.filter((c) => c.pinned))}>
          <IconTrash size={16} />
          Очистить
        </motion.button>
      </div>

      <div className="ig-glass-card pv-clip-card">
        {ordered.length === 0 ? (
          clips.length === 0 ? (
            <div className="ig-empty">
              <span className="ig-empty__icon">
                <IconClipboard size={22} />
              </span>
              <span className="ig-empty__title">История буфера пуста</span>
              <span className="ig-empty__text">Скопируйте текст, ссылку, картинку или файлы — запись появится здесь. Закреплённые записи не удаляются при очистке.</span>
            </div>
          ) : (
            <div className="ig-empty">
              <span className="ig-empty__icon">
                <IconSearch size={22} />
              </span>
              <span className="ig-empty__title">Ничего не найдено</span>
              <span className="ig-empty__text">По запросу «{query}» записей нет. Поиск идёт по тексту, ссылкам и именам файлов.</span>
              <button className="ig-glass-control ig-glass-control--sm pv-empty-action" onClick={() => setQuery("")}>
                Сбросить поиск
              </button>
            </div>
          )
        ) : (
          <div ref={scrollRef} className="ig-scroll ig-scroll-fade pv-fill">
            <div>
              <LayoutGroup>
                {pinned.length > 0 && (
                  <>
                    <h4 className="ig-section-label pv-label-first">
                      <IconPin size={12} />
                      Закреплённые
                    </h4>
                    <ul className="ig-list" role="listbox" aria-label="Закреплённые">
                      <AnimatePresence initial={false}>{pinned.map(row)}</AnimatePresence>
                    </ul>
                  </>
                )}
                <h4 className="ig-section-label">Недавние</h4>
                <ul className="ig-list" role="listbox" aria-label="Недавние">
                  <AnimatePresence initial={false}>{recent.map(row)}</AnimatePresence>
                </ul>
              </LayoutGroup>
            </div>
          </div>
        )}
      </div>

      <footer className="pv-hints" aria-label="Подсказки">
        <span>
          <kbd className="ig-kbd">↑</kbd>
          <kbd className="ig-kbd">↓</kbd> выбрать
        </span>
        <span>
          <kbd className="ig-kbd">Enter</kbd> вставить
        </span>
        <span>
          <kbd className="ig-kbd">Shift</kbd>+клик — только скопировать
        </span>
        <span>
          <kbd className="ig-kbd">Del</kbd> удалить
        </span>
      </footer>
    </div>
  );
}

// ───────────────────────────── Text (§6.5) ─────────────────────────────

type TransformId = "layout" | "translit" | "upper" | "lower" | "title" | "sentence" | "trim" | "collapse" | "jsonPretty" | "jsonMin" | "b64enc" | "b64dec";

const TRANSFORM_GROUPS: { label: string; items: { id: TransformId; label: string; Icon?: (p: IconProps) => ReactNode }[] }[] = [
  { label: "Раскладка", items: [{ id: "layout", label: "RU ⇄ EN", Icon: IconSwap }, { id: "translit", label: "Транслит" }] },
  {
    label: "Регистр",
    items: [
      { id: "upper", label: "ВЕРХНИЙ" },
      { id: "lower", label: "нижний" },
      { id: "title", label: "Каждое Слово" },
      { id: "sentence", label: "Как в предложении" },
    ],
  },
  { label: "Пробелы", items: [{ id: "trim", label: "Обрезать края" }, { id: "collapse", label: "Сжать пробелы", Icon: IconCleanText }] },
  {
    label: "Формат",
    items: [
      { id: "jsonPretty", label: "JSON красиво", Icon: IconBraces },
      { id: "jsonMin", label: "JSON в строку" },
      { id: "b64enc", label: "В Base64" },
      { id: "b64dec", label: "Из Base64" },
    ],
  },
];

/** Preview-only transforms (F2 owns the real ones in src/lib/text). Layout/translit are no-ops here. */
function applyTransform(id: TransformId, s: string): { value: string } | { error: string } {
  switch (id) {
    case "upper":
      return { value: s.toUpperCase() };
    case "lower":
      return { value: s.toLowerCase() };
    case "title":
      return { value: s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) };
    case "sentence":
      return { value: s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) };
    case "trim":
      return { value: s.split("\n").map((l) => l.trim()).join("\n").trim() };
    case "collapse":
      return { value: s.replace(/[ \t]+/g, " ") };
    case "jsonPretty":
    case "jsonMin":
      try {
        return { value: JSON.stringify(JSON.parse(s), null, id === "jsonPretty" ? 2 : 0) };
      } catch {
        return { error: "Неверный JSON: строка 4, символ 3 — ожидалась «,» или «}»" };
      }
    case "b64enc":
      return { value: btoa(String.fromCharCode(...new TextEncoder().encode(s))) };
    case "b64dec":
      try {
        return { value: new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0))) };
      } catch {
        return { error: "Это не Base64: допустимы A–Z, a–z, 0–9, «+», «/» и «=» в конце" };
      }
    default:
      return { value: s };
  }
}

export function TextTab({ variant, focus }: { variant: Variant; focus: boolean }) {
  const [text, setText] = useState(variant === "empty" ? "" : variant === "alt" ? JSON_BROKEN : TEXT_SAMPLE);
  const [error, setError] = useState<string | null>(variant === "alt" ? "Неверный JSON: строка 4, символ 3 — ожидалась «,» или «}»" : null);
  const [last, setLast] = useState<TransformId | null>(variant === "alt" ? "jsonPretty" : null);
  const [history, setHistory] = useState<string[]>([]);
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split("\n").length : 0;

  return (
    <div className="pv-text">
      <div className="ig-field pv-fill" data-invalid={error ? true : undefined} data-focus-visible={focus && !error ? true : undefined}>
        <textarea
          className="ig-textarea ig-textarea--mono"
          value={text}
          spellCheck={false}
          placeholder="Вставьте или наберите текст — затем выберите преобразование справа"
          aria-label="Текст для преобразования"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <div className="pv-banner-wrap">
            <div className="ig-banner ig-banner--danger" role="alert">
              <IconWarning size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}
        <div className="ig-field-bar ig-field-bar--footer">
          <span className="ig-num pv-stats">
            {chars} {plural(chars, ["символ", "символа", "символов"])} · {words} {plural(words, ["слово", "слова", "слов"])} · {lines} {plural(lines, ["строка", "строки", "строк"])}
          </span>
          <span className="ig-field-bar__spacer" />
          <motion.button
            className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost"
            {...tap}
            disabled={history.length === 0}
            onClick={() => {
              setText(history[history.length - 1] ?? text);
              setHistory((h) => h.slice(0, -1));
              setError(null);
            }}
          >
            <IconUndo size={16} />
            Отменить
          </motion.button>
          <motion.button className="ig-glass-control ig-glass-control--sm ig-glass-control--accent" {...tap} disabled={!text}>
            <IconCopy size={16} />
            Копировать
          </motion.button>
        </div>
      </div>

      <section className="pv-transforms" aria-label="Преобразования">
        {TRANSFORM_GROUPS.map((g) => (
          <div key={g.label} className="pv-transform-group">
            <h4 className="ig-section-label pv-label-flush">{g.label}</h4>
            <div className="pv-transform-grid">
              {g.items.map(({ id, label, Icon }) => (
                <motion.button
                  key={id}
                  className="ig-glass-control ig-glass-control--sm pv-transform"
                  {...tap}
                  data-selected={last === id && !error ? true : undefined}
                  disabled={!text}
                  onClick={() => {
                    const r = applyTransform(id, text);
                    setLast(id);
                    if ("error" in r) return setError(r.error);
                    setHistory((h) => [...h.slice(-19), text]);
                    setText(r.value);
                    setError(null);
                  }}
                >
                  {Icon && <Icon size={16} />}
                  <span className="ig-truncate">{label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ───────────────────────────── Notes + timer (§6.6) ─────────────────────────────

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function TimerCard({ initialDone }: { initialDone: boolean }) {
  const [total, setTotal] = useState(5 * 60);
  const [left, setLeft] = useState(initialDone ? 0 : 252);
  const [running, setRunning] = useState(!initialDone);
  const done = left === 0;
  useEffect(() => {
    if (!running || done) return;
    const id = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running, done]);
  const state = done ? "done" : running ? "running" : left === total ? "idle" : "paused";
  return (
    <section className={done ? "ig-glass-card ig-glass-card--success pv-timer" : "ig-glass-card pv-timer"} aria-label="Таймер">
      <header className="pv-timer-head">
        <span className="pv-timer-title">
          <IconTimer size={16} />
          Таймер
        </span>
        <span className="pv-caption">{done ? "Готово" : running ? "Идёт" : state === "idle" ? "Готов к запуску" : "Пауза"}</span>
      </header>
      <div className="pv-timer-face">
        <ProgressRing value={done ? 1 : left / total} state={state} label={done ? "Время вышло" : `Осталось ${fmt(left)}`} />
        <div className="pv-timer-readout">
          {done ? (
            <>
              <IconCheck size={22} className="pv-success-icon" />
              <span className="pv-timer-done">Время вышло</span>
            </>
          ) : (
            <>
              <span className="pv-timer-time ig-num">{fmt(left)}</span>
              <span className="pv-caption">из {total / 60} мин</span>
            </>
          )}
        </div>
      </div>
      <div className="pv-timer-presets" role="group" aria-label="Длительность">
        {TIMER_PRESETS.map((m) => (
          <button
            key={m}
            className="ig-chip pv-preset"
            aria-pressed={total === m * 60}
            aria-label={`${m} мин`}
            onClick={() => {
              setTotal(m * 60);
              setLeft(m * 60);
              setRunning(false);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="pv-timer-controls">
        <motion.button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost" {...tap} aria-label="Сбросить" onClick={() => { setLeft(total); setRunning(false); }}>
          <IconReset size={18} />
        </motion.button>
        <motion.button
          className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg ig-glass-control--accent"
          {...tap}
          aria-label={running && !done ? "Пауза" : "Старт"}
          onClick={() => {
            if (done) {
              setLeft(total);
              setRunning(true);
            } else setRunning((r) => !r);
          }}
        >
          {running && !done ? <IconPause size={18} /> : <IconPlay size={18} />}
        </motion.button>
        <motion.button className="ig-glass-control ig-glass-control--sm" {...tap} onClick={() => { setLeft((l) => l + 60); setTotal((t) => t + 60); if (done) setRunning(true); }}>
          +1 мин
        </motion.button>
      </div>
    </section>
  );
}

export function NotesTab({ variant, focus }: { variant: Variant; focus: boolean }) {
  const empty = variant === "empty";
  const [folder, setFolder] = useState("Все");
  const notes = empty ? [] : NOTES;
  const [active, setActive] = useState(notes[0]?.id ?? -1);
  const note = notes.find((n) => n.id === active);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  return (
    <div className="pv-notes">
      <div className="pv-folders" role="tablist" aria-label="Папки">
        {FOLDERS.map((f) => (
          <button key={f.name} className="ig-chip" role="tab" aria-selected={folder === f.name} onClick={() => setFolder(f.name)}>
            {f.name}
            <span className="ig-chip__count">{empty ? 0 : f.count}</span>
          </button>
        ))}
        <button className="ig-chip ig-chip--add" aria-label="Новая папка" title="Новая папка">
          <IconPlus size={14} />
        </button>
      </div>

      <section className="ig-glass-card pv-note-list" aria-label="Заметки">
        <div className="pv-note-list-head">
          <span className="ig-section-label pv-label-flush">{folder === "Все" ? "Все заметки" : folder}</span>
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Новая заметка" title="Новая заметка (Ctrl+N)">
            <IconPlus size={16} />
          </button>
        </div>
        {notes.length === 0 ? (
          <div className="ig-empty pv-empty-small">
            <span className="ig-empty__icon">
              <IconNote size={20} />
            </span>
            <span className="ig-empty__title">Пока пусто</span>
            <span className="ig-empty__text">Нажмите «+», чтобы создать заметку</span>
          </div>
        ) : (
          <div ref={listRef} className="ig-scroll ig-scroll-fade pv-fill">
            <ul className="ig-list" role="listbox" aria-label="Список заметок">
              {notes.map((n) => (
                <li key={n.id} className="ig-list-row ig-list-row--compact" role="option" aria-selected={false} aria-current={n.id === active ? "true" : undefined} onMouseDown={() => setActive(n.id)}>
                  <span className="ig-list-row__body">
                    <span className="ig-list-row__title pv-note-title">{n.title}</span>
                    <span className="ig-list-row__meta">
                      {n.when} · {n.folder}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="ig-field pv-editor" data-focus-visible={focus || undefined}>
        <div className="ig-field-bar ig-field-bar--header" role="toolbar" aria-label="Форматирование">
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Жирный (Ctrl+B)" title="Жирный (Ctrl+B)" aria-pressed={!empty}>
            <IconBold size={16} />
          </button>
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Курсив (Ctrl+I)" title="Курсив (Ctrl+I)">
            <IconItalic size={16} />
          </button>
          <span className="ig-field-bar__sep" aria-hidden="true" />
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Список" title="Список">
            <IconListBullet size={16} />
          </button>
          <button className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm" aria-label="Чек-лист" title="Чек-лист">
            <IconChecklist size={16} />
          </button>
          <span className="ig-field-bar__spacer" />
          <span className="ig-status" data-state={empty ? "idle" : focus ? "saving" : "saved"}>
            {empty ? "Нет заметки" : focus ? "Сохранение…" : "Сохранено · 14:32"}
          </span>
        </div>
        <div
          className="ig-editor"
          contentEditable={!empty}
          suppressContentEditableWarning
          data-placeholder={empty ? "Создайте заметку слева" : "Начните писать…"}
          role="textbox"
          aria-multiline="true"
          aria-label="Текст заметки"
          dangerouslySetInnerHTML={{ __html: note?.body ?? "" }}
        />
      </div>

      <TimerCard initialDone={variant === "alt"} />
    </div>
  );
}

// ───────────────────────────── Settings view (§6.8) ─────────────────────────────

function Segment<T extends string>({ id, value, options, onChange, label }: { id: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <LayoutGroup id={id}>
      <div className="ig-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} className="ig-tab" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {value === o.value && <motion.span layoutId={`${id}-thumb`} className="ig-tab-thumb" transition={springs.tab} />}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

export function SettingsView() {
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [vib, setVib] = useState<"acrylic" | "mica" | "none">("acrylic");
  const [autostart, setAutostart] = useState(true);
  const [dnd, setDnd] = useState(false);
  const [hideFs, setHideFs] = useState(true);
  const [expandDelay, setExpandDelay] = useState(150);
  const [collapseDelay, setCollapseDelay] = useState(400);
  return (
    <div className="pv-settings">
      <section className="ig-glass-card pv-settings-card" aria-labelledby="pv-set-look">
        <h4 id="pv-set-look" className="ig-section-label pv-settings-label">
          Внешний вид
        </h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Тема</span>
          </span>
          <Segment id="set-theme" label="Тема" value={theme} onChange={setTheme} options={[{ value: "auto", label: "Авто" }, { value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }]} />
        </div>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Фон острова</span>
          </span>
          <Segment id="set-vib" label="Фон" value={vib} onChange={setVib} options={[{ value: "acrylic", label: "Акрил" }, { value: "mica", label: "Mica" }, { value: "none", label: "Плотный" }]} />
        </div>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Монитор</span>
            <span className="ig-setting-row__desc">Где показывать остров</span>
          </span>
          <span className="ig-select">
            <select aria-label="Монитор" defaultValue="primary">
              {MONITORS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <IconChevronDown size={14} />
          </span>
        </div>
        <p className="pv-settings-foot">«Авто» следует теме Windows. «Акрил» размывает то, что под островом; «Плотный» — без прозрачности. Изменения применяются сразу.</p>
      </section>

      <section className="ig-glass-card pv-settings-card" aria-labelledby="pv-set-behaviour">
        <h4 id="pv-set-behaviour" className="ig-section-label pv-settings-label">
          Поведение
        </h4>
        <label className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Запускать вместе с Windows</span>
          </span>
          <input type="checkbox" role="switch" className="ig-switch" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} />
        </label>
        <label className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Не беспокоить</span>
            <span className="ig-setting-row__desc">Без всплывающих сообщений в пилюле</span>
          </span>
          <input type="checkbox" role="switch" className="ig-switch" checked={dnd} onChange={(e) => setDnd(e.target.checked)} />
        </label>
        <label className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Скрывать в полноэкранных приложениях</span>
          </span>
          <input type="checkbox" role="switch" className="ig-switch" checked={hideFs} onChange={(e) => setHideFs(e.target.checked)} />
        </label>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Задержка раскрытия</span>
            <span className="ig-setting-row__value">{expandDelay} мс</span>
          </span>
          <input className="ig-glass-slider ig-glass-slider--accent" type="range" min={0} max={1000} step={50} value={expandDelay} onChange={(e) => setExpandDelay(Number(e.target.value))} style={{ "--ig-value": `${expandDelay / 10}%` } as CSSProperties} aria-label="Задержка раскрытия, мс" />
        </div>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Задержка сворачивания</span>
            <span className="ig-setting-row__value">{collapseDelay} мс</span>
          </span>
          <input className="ig-glass-slider ig-glass-slider--accent" type="range" min={0} max={2000} step={50} value={collapseDelay} onChange={(e) => setCollapseDelay(Number(e.target.value))} style={{ "--ig-value": `${collapseDelay / 20}%` } as CSSProperties} aria-label="Задержка сворачивания, мс" />
        </div>
      </section>
    </div>
  );
}

// ───────────────────────────── Focus states gallery (§6.9) ─────────────────────────────

export function FocusGallery() {
  return (
    <div className="pv-focus-grid">
      <div className="pv-focus-cell">
        <span className="pv-h3">input · :focus</span>
        <label className="ig-search">
          <IconSearch size={16} />
          <input className="ig-glass-input" data-focus-visible="true" defaultValue="счёт" aria-label="Поиск" />
          <kbd className="ig-kbd">Esc</kbd>
        </label>
      </div>
      <div className="pv-focus-cell">
        <span className="pv-h3">input · aria-invalid</span>
        <input className="ig-glass-input" aria-invalid="true" defaultValue="eyJpc2xhbmQ" aria-label="Поле с ошибкой" />
      </div>
      <div className="pv-focus-cell">
        <span className="pv-h3">.ig-field:focus-within (textarea)</span>
        <div className="ig-field pv-focus-field" data-focus-visible="true">
          <textarea className="ig-textarea ig-textarea--mono" defaultValue={"{\n  \"ok\": true\n}"} aria-label="Пример" />
        </div>
      </div>
      <div className="pv-focus-cell">
        <span className="pv-h3">.ig-editor (contenteditable)</span>
        <div className="ig-field pv-focus-field" data-focus-visible="true">
          <div className="ig-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="Пример">
            <p>
              <b>Жирный</b>, <i>курсив</i>
            </p>
          </div>
        </div>
      </div>
      <div className="pv-focus-cell">
        <span className="pv-h3">chip · switch · row (клавиатура)</span>
        <div className="pv-row">
          <button className="ig-chip" data-focus-visible="true" aria-pressed="true">
            Работа
          </button>
          <input type="checkbox" role="switch" className="ig-switch" data-focus-visible="true" defaultChecked aria-label="Пример" />
          <button className="ig-glass-control ig-glass-control--sm" data-focus-visible="true">
            Кнопка
          </button>
        </div>
      </div>
      <div className="pv-focus-cell">
        <span className="pv-h3">.ig-list-row · hover / selected / focus</span>
        <ul className="ig-list pv-focus-list">
          <li className="ig-list-row ig-list-row--compact" data-focus-visible="true">
            <span className="ig-list-row__body">
              <span className="ig-list-row__title">Фокус (Tab)</span>
            </span>
          </li>
          <li className="ig-list-row ig-list-row--compact" aria-selected="true">
            <span className="ig-list-row__body">
              <span className="ig-list-row__title">Выбрана стрелками</span>
              <span className="ig-list-row__meta">вторичный текст</span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
