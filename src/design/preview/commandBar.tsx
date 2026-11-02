// Owner: Designer. Wave-3 / v0.3 Command Bar interactive mockup for the design preview.
// Reference DOM and interaction model for F1/F2 — not production code.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cmdItem } from "../motion";
import {
  IconApp,
  IconCalculator,
  IconClose,
  IconCode,
  IconCommand,
  IconConverter,
  IconFile,
  IconFolder,
  IconGlobe,
  IconImage,
  IconPercent,
  IconPlay,
  IconRuler,
  IconSearch,
  IconSettings,
  IconTerminal,
  IconTimer,
  IconWarning,
} from "../icons";
import {
  MOCK_CMD_HINTS,
  MOCK_CMD_ITEMS,
  MOCK_HERO_ANSWERS,
  type MockCmdHint,
  type MockCmdItem,
  type MockHeroAnswer,
} from "./mockData";

export type CmdStandState =
  | "live"
  | "empty"
  | "results"
  | "few"
  | "calc"
  | "convert"
  | "loading"
  | "error"
  | "notfound";

export interface CommandBarProps {
  lang?: "ru" | "en";
  state?: CmdStandState;
  onClose?: () => void;
  autoFocus?: boolean;
  onHeightChange?: (height: number) => void;
}

/**
 * Height rule (§6.10):
 * - Header (input): 52px
 * - Footer (hints): 36px
 * - Base fixed: 88px (52 + 36)
 * - Banner (offline error / loading rate): 44px (36px + 8px margin-top)
 * - Hero card (calc / converter): 90px (74px + 8px margin-top + 8px margin-bottom)
 * - Group section label: 24px
 * - Row height slot: 48px (46px row + 2px margin)
 * - List vertical padding: 16px (8px top + 8px bottom)
 * - Empty state: 368px (shows 5 complete rows without cut-off)
 * - Not found state: 180px (compact centered)
 * - Min: 160px, Max: 420px (smooth scroll with soft bottom gradient mask beyond max)
 */
export function calcCmdBarHeight({
  query,
  state,
  itemsCount,
  groupsCount,
  hasHero,
  hasBanner,
}: {
  query: string;
  state?: CmdStandState;
  itemsCount: number;
  groupsCount: number;
  hasHero: boolean;
  hasBanner: boolean;
}): number {
  const HEADER_H = 52;
  const FOOTER_H = 36;
  const BANNER_H = 44; // 36px + 8px margin-top
  const HERO_H = 90; // 74px + 8px margin-top + 8px margin-bottom
  const GROUP_H = 24; // 24px label
  const ROW_H = 48; // 46px row + 2px gap
  const PAD_H = 16; // 8px top + 8px bottom padding
  const MIN_H = 160;
  const MAX_H = 420;

  // Empty state: exactly 5 hints fit completely without being cut off
  if (query.trim() === "" || state === "empty") {
    const hintsCount = 5;
    return HEADER_H + FOOTER_H + GROUP_H + hintsCount * ROW_H + PAD_H; // 368px
  }

  // Not found state: compact centered empty message
  if (itemsCount === 0 && !hasHero) {
    return 180;
  }

  // Pure instant answer (Calculator / Converter / Offline / Loading) with no list items below
  if (itemsCount === 0 && hasHero) {
    const bannerH = hasBanner ? BANNER_H : 0;
    return Math.max(MIN_H, HEADER_H + FOOTER_H + bannerH + HERO_H); // 178px or 222px
  }

  // Results list (optionally with Banner / Hero / Groups / Rows)
  const bannerH = hasBanner ? BANNER_H : 0;
  const heroH = hasHero ? HERO_H : 0;
  const groupsH = groupsCount * GROUP_H;
  const rowsH = itemsCount * ROW_H;
  const total = HEADER_H + FOOTER_H + bannerH + heroH + groupsH + rowsH + PAD_H;

  return Math.max(MIN_H, Math.min(MAX_H, total));
}

function getLeadIcon(item: MockCmdItem): ReactNode {
  if (item.title === "Telegram") {
    return (
      <span className="ig-cmd-app-badge ig-cmd-app-badge--tg" aria-label="Telegram">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
        </svg>
      </span>
    );
  }
  if (item.title.includes("Chrome")) return <IconGlobe size={18} />;
  if (item.title.includes("Code")) return <IconCode size={18} />;
  if (item.title.includes("Терминал")) return <IconTerminal size={18} />;
  if (item.title.includes("YouTube")) return <IconPlay size={18} />;
  if (item.title.includes("png")) return <IconImage size={18} />;
  if (item.title.includes("xlsx") || item.title.includes(".md")) return <IconFile size={18} />;
  if (item.title.includes("папке") || item.meta.includes("Documents") || item.meta.includes("Screenshots")) return <IconFolder size={18} />;
  if (item.title.includes("буфер")) return <IconSettings size={18} />;
  if (item.kind === "app") return <IconApp size={18} />;
  if (item.kind === "file") return <IconFile size={18} />;
  if (item.kind === "calc") return <IconCalculator size={18} />;
  if (item.kind === "convert") return <IconConverter size={18} />;
  if (item.kind === "command") return <IconTimer size={18} />;
  return <IconCommand size={18} />;
}

function getHintIcon(kind: MockCmdHint["kind"]): ReactNode {
  switch (kind) {
    case "calc":
      return <IconCalculator size={16} />;
    case "percent":
      return <IconPercent size={16} />;
    case "convert":
      return <IconConverter size={16} />;
    case "ruler":
      return <IconRuler size={16} />;
    case "timer":
      return <IconTimer size={16} />;
    case "file":
      return <IconFile size={16} />;
    default:
      return <IconSearch size={16} />;
  }
}

export function CommandBar({
  lang = "ru",
  state = "live",
  onClose,
  autoFocus = true,
  onHeightChange,
}: CommandBarProps) {
  const isEn = lang === "en";
  const inputId = useId();
  const listboxId = useId();

  // Controlled input value based on stand state presets or user typing
  const [query, setQuery] = useState(() => {
    switch (state) {
      case "calc":
        return "12*7+3";
      case "convert":
        return "100 usd в kzt";
      case "loading":
        return "100 eur в usd";
      case "error":
        return "100 gbp в kzt";
      case "notfound":
        return "xyzqwk999";
      case "results":
        return "te";
      case "few":
        return "code";
      case "empty":
        return "";
      default:
        return "";
    }
  });

  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state prop changes
  useEffect(() => {
    if (state === "calc") setQuery("12*7+3");
    else if (state === "convert") setQuery("100 usd в kzt");
    else if (state === "loading") setQuery("100 eur в usd");
    else if (state === "error") setQuery("100 gbp в kzt");
    else if (state === "notfound") setQuery("xyzqwk999");
    else if (state === "results") setQuery("te");
    else if (state === "few") setQuery("code");
    else if (state === "empty") setQuery("");
  }, [state]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Evaluate query to detect instant hero answers (Calculator / Converter)
  const heroAnswer: MockHeroAnswer | null = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (state === "loading" || (q.includes("eur") && q.includes("usd"))) return MOCK_HERO_ANSWERS.currencyLoading;
    if (state === "error" || (q.includes("gbp") && q.includes("kzt"))) return MOCK_HERO_ANSWERS.currencyOffline;
    if (state === "calc" || q.includes("*") || q.includes("+") || q.includes("/") || q.includes("-") || q.includes("12*7")) {
      return MOCK_HERO_ANSWERS.calc;
    }
    if (q.includes("%")) {
      return MOCK_HERO_ANSWERS.percent;
    }
    if (state === "convert" || q.includes("usd") || q.includes("kzt") || q.includes("доллар")) {
      return MOCK_HERO_ANSWERS.currency;
    }
    if (q.includes("км") || q.includes("мили") || q.includes("km") || q.includes("mile")) {
      return MOCK_HERO_ANSWERS.units;
    }
    return null;
  }, [query, state]);

  // Filter items
  const filteredItems: MockCmdItem[] = useMemo(() => {
    if (state === "empty") return [];
    if (state === "notfound") return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return MOCK_CMD_ITEMS.filter(
      (item) => item.title.toLowerCase().includes(q) || item.meta.toLowerCase().includes(q),
    );
  }, [query, state]);

  // Group items by category (§6.10: Applications, Files, Commands, etc.)
  const groupedItems = useMemo(() => {
    const map = new Map<string, MockCmdItem[]>();
    for (const item of filteredItems) {
      if (!map.has(item.group)) {
        map.set(item.group, []);
      }
      map.get(item.group)!.push(item);
    }
    const groupLabels: Record<string, { ru: string; en: string }> = {
      apps: { ru: "Приложения", en: "Applications" },
      files: { ru: "Файлы", en: "Files" },
      calc: { ru: "Калькулятор", en: "Calculator" },
      convert: { ru: "Конвертер", en: "Converter" },
      commands: { ru: "Команды", en: "Commands" },
    };
    const order = ["apps", "files", "calc", "convert", "commands"];
    const groups: Array<{ group: string; label: string; items: MockCmdItem[] }> = [];
    for (const g of order) {
      const items = map.get(g);
      if (items && items.length > 0) {
        groups.push({
          group: g,
          label: isEn ? groupLabels[g]?.en ?? g : groupLabels[g]?.ru ?? g,
          items,
        });
      }
    }
    return groups;
  }, [filteredItems, isEn]);

  const hasBanner = state === "error" || state === "loading";
  const hasBodyContent =
    query.trim() === "" ||
    filteredItems.length > 0 ||
    (query.trim() !== "" && filteredItems.length === 0 && !heroAnswer);

  // Notify parent of content height changes (smooth spring resize)
  const currentHeight = useMemo(() => {
    return calcCmdBarHeight({
      query,
      state,
      itemsCount: filteredItems.length,
      groupsCount: groupedItems.length,
      hasHero: Boolean(heroAnswer),
      hasBanner,
    });
  }, [query, state, filteredItems.length, groupedItems.length, heroAnswer, hasBanner]);

  useEffect(() => {
    onHeightChange?.(currentHeight);
  }, [currentHeight, onHeightChange]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<{
    isScrollable: boolean;
    scrolledTop: boolean;
    scrolledBottom: boolean;
  }>({
    isScrollable: false,
    scrolledTop: false,
    scrolledBottom: true,
  });

  const updateScrollState = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const isScrollable = el.scrollHeight > el.clientHeight + 4;
    const scrolledTop = el.scrollTop > 8;
    const scrolledBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
    setScrollState({ isScrollable, scrolledTop, scrolledBottom });
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [groupedItems, query, updateScrollState]);

  // Clamped selection index
  const safeSelectedIndex = filteredItems.length > 0 ? Math.min(selectedIndex, filteredItems.length - 1) : 0;
  const selectedItem = filteredItems[safeSelectedIndex];

  // Auto-scroll selected row into view
  useEffect(() => {
    if (filteredItems.length === 0) return;
    const item = filteredItems[safeSelectedIndex];
    if (!item) return;
    const el = document.getElementById(`cmd-item-${item.id}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [safeSelectedIndex, filteredItems]);

  const handleAction = useCallback(
    (actionName: string, secondary = false) => {
      setCopiedNotification(
        secondary
          ? `${actionName} (${isEn ? "Secondary" : "Вторичное"})`
          : `${actionName} (${isEn ? "Opened" : "Открыто"})`,
      );
      setTimeout(() => setCopiedNotification(null), 1400);
    },
    [isEn],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (heroAnswer && filteredItems.length === 0) {
        handleAction("Copied hero result");
      } else if (selectedItem) {
        handleAction(selectedItem.title, e.ctrlKey || e.metaKey);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
      } else {
        onClose?.();
      }
    }
  };

  const selectedItemId = selectedItem ? `cmd-item-${selectedItem.id}` : undefined;

  return (
    <div className="ig-cmd">
      {/* Header / Input Field */}
      <header className="ig-cmd-header">
        <span className="ig-cmd-header__icon" aria-hidden="true">
          <IconSearch size={20} />
        </span>
        <input
          ref={inputRef}
          id={inputId}
          className="ig-cmd-input"
          role="combobox"
          aria-expanded={true}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={selectedItemId}
          placeholder={isEn ? "Search apps, files, calculator, commands..." : "Поиск приложений, файлов, калькулятор, команды..."}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="ig-cmd-header__actions">
          {state === "loading" && (
            <span className="ig-cmd-footer__status" style={{ color: "var(--ig-accent-text)", fontSize: "11px" }}>
              <span className="ig-status" data-state="saving" />
              {isEn ? "Updating rates..." : "Загрузка..."}
            </span>
          )}
          {query.length > 0 && (
            <button
              className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
              aria-label={isEn ? "Clear input" : "Очистить"}
              title={isEn ? "Clear (Esc)" : "Очистить (Esc)"}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <IconClose size={14} />
            </button>
          )}
          <kbd className="ig-kbd" title={isEn ? "Close" : "Закрыть"}>
            Esc
          </kbd>
        </div>
      </header>

      {/* Network offline error banner: GBP rate from cache */}
      {state === "error" && (
        <div className="ig-cmd-banner" role="alert">
          <IconWarning size={16} />
          <span>
            {isEn
              ? "Currency network offline: showing cached rate for GBP (1 GBP = 635.40 KZT, 2h ago)"
              : "Курс валют недоступен (офлайн): показан кэш курса GBP (1 GBP = 635.40 KZT, 2 ч назад)"}
          </span>
        </div>
      )}

      {/* Network loading rate banner */}
      {state === "loading" && (
        <div className="ig-cmd-banner ig-cmd-banner--info" role="status">
          <span className="ig-status" data-state="saving" />
          <span>
            {isEn
              ? "Updating exchange rates: fetching live EUR → USD rates..."
              : "Загрузка актуального курса: запрос EUR → USD к ЕЦБ..."}
          </span>
        </div>
      )}

      {/* Hero card for instant math / conversion result */}
      {heroAnswer && (
        <div className="ig-cmd-hero" role="region" aria-label={isEn ? "Instant result" : "Мгновенный ответ"}>
          <div className="ig-cmd-hero__lead">
            {heroAnswer.kind === "calc" ? <IconCalculator size={22} /> : <IconConverter size={22} />}
          </div>
          <div className="ig-cmd-hero__body">
            <span className="ig-num ig-cmd-hero__value">{heroAnswer.value}</span>
            <span className="ig-cmd-hero__formula">{heroAnswer.formula}</span>
            <span className="ig-cmd-hero__meta">{heroAnswer.meta}</span>
          </div>
          <div className="ig-cmd-hero__action">
            <kbd className="ig-kbd">Enter</kbd>
            <span>{isEn ? "Copy" : "Скопировать"}</span>
          </div>
        </div>
      )}

      {/* Results or Empty / Hints Body */}
      {hasBodyContent && (
        <div
          ref={bodyRef}
          id={listboxId}
          className="ig-cmd-body ig-scroll"
          role="listbox"
          aria-label={isEn ? "Search results" : "Результаты"}
          data-scrollable={scrollState.isScrollable}
          data-scrolled-top={scrollState.scrolledTop}
          data-scrolled-bottom={scrollState.scrolledBottom}
          onScroll={updateScrollState}
        >
          {query.trim() === "" && (
            <div className="ig-cmd-group">
              <div className="ig-cmd-section-label">{isEn ? "Hints and shortcuts" : "Быстрые примеры"}</div>
              {MOCK_CMD_HINTS.slice(0, 5).map((hint) => (
                <div
                  key={hint.query}
                  className="ig-cmd-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setQuery(hint.query);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="ig-cmd-row__lead" data-kind={hint.kind}>
                    {getHintIcon(hint.kind)}
                  </span>
                  <span className="ig-cmd-row__body">
                    <span className="ig-cmd-row__title" style={{ fontFamily: "var(--ig-font-mono)", fontSize: "13px" }}>
                      {hint.label}
                    </span>
                    <span className="ig-cmd-row__meta">{hint.desc}</span>
                  </span>
                  <span className="ig-cmd-row__action">
                    <kbd className="ig-kbd">Tab</kbd>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Compact Nothing found state */}
          {query.trim() !== "" && filteredItems.length === 0 && !heroAnswer && (
            <div className="ig-empty" style={{ margin: "20px 0" }}>
              <div className="ig-empty__icon">
                <IconSearch size={20} />
              </div>
              <h3 className="ig-empty__title">{isEn ? "No results found" : "Ничего не найдено"}</h3>
              <p className="ig-empty__text">
                {isEn
                  ? `No results match "${query}". Try evaluating 12*7+3 or converting 100 usd in kzt.`
                  : `По запросу «${query}» ничего не найдено. Попробуйте расчёт (12*7+3) или валюту (100 usd в kzt).`}
              </p>
            </div>
          )}

          {/* Grouped filtered items */}
          {groupedItems.length > 0 && (
            <AnimatePresence initial={false}>
              {groupedItems.map((group) => (
                <div key={group.group} className="ig-cmd-group">
                  <div className="ig-cmd-section-label">{group.label}</div>
                  {group.items.map((item) => {
                    const globalIdx = filteredItems.findIndex((it) => it.id === item.id);
                    const isSelected = globalIdx === safeSelectedIndex;
                    return (
                      <motion.div
                        key={item.id}
                        id={`cmd-item-${item.id}`}
                        className="ig-cmd-row"
                        role="option"
                        aria-selected={isSelected}
                        initial={cmdItem.initial}
                        animate={cmdItem.animate}
                        exit={cmdItem.exit}
                        onClick={() => handleAction(item.title)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                      >
                        <span className="ig-cmd-row__lead" data-kind={item.kind}>
                          {getLeadIcon(item)}
                        </span>
                        <span className="ig-cmd-row__body">
                          <span className="ig-cmd-row__title">{item.title}</span>
                          <span className="ig-cmd-row__meta">{item.meta}</span>
                        </span>
                        <span className="ig-cmd-row__action">
                          <kbd className="ig-kbd">Enter</kbd>
                          <span>{item.actionHint ?? (isEn ? "Open" : "Открыть")}</span>
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Footer bar with keyboard hints following active row */}
      <footer className="ig-cmd-footer">
        <div className="ig-cmd-footer__hints">
          {/* Navigation keys */}
          <span className="ig-cmd-hint-item">
            <kbd className="ig-kbd">↑</kbd>
            <kbd className="ig-kbd">↓</kbd>
            <span>{isEn ? "Navigate" : "Выбрать"}</span>
          </span>

          {/* Calculator or converter focused / hero active */}
          {(heroAnswer && filteredItems.length === 0) || selectedItem?.kind === "calc" || selectedItem?.kind === "convert" ? (
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "Copy" : "Скопировать"}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Shift</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "With formula" : "С формулой"}</span>
              </span>
            </>
          ) : selectedItem?.kind === "app" ? (
            /* Application focused */
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "Open" : "Открыть"}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Ctrl</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "Run as administrator" : "От имени администратора"}</span>
              </span>
            </>
          ) : selectedItem?.kind === "file" ? (
            /* File focused */
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "Open" : "Открыть"}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Ctrl</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{isEn ? "Show in folder" : "Показать в папке"}</span>
              </span>
            </>
          ) : selectedItem?.kind === "command" ? (
            /* Island command focused */
            <span className="ig-cmd-hint-item">
              <kbd className="ig-kbd">Enter</kbd>
              <span>{isEn ? "Run" : "Запустить"}</span>
            </span>
          ) : (
            /* Default / empty state hints */
            <span className="ig-cmd-hint-item">
              <kbd className="ig-kbd">Tab</kbd>
              <span>{isEn ? "Use hint" : "Выбрать пример"}</span>
            </span>
          )}

          <span className="ig-cmd-hint-item">
            <kbd className="ig-kbd">Esc</kbd>
            <span>{isEn ? "Close" : "Закрыть"}</span>
          </span>
        </div>

        <div className="ig-cmd-footer__status">
          {copiedNotification ? (
            <span style={{ color: "var(--ig-success-text)", fontWeight: 600 }}>{copiedNotification}</span>
          ) : (
            <span>CCOTT</span>
          )}
        </div>
      </footer>
    </div>
  );
}
