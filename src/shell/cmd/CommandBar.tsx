// Owner: F1 (Frontend-Shell) / F2. Production Command Bar component (spec §6.10, contracts §20).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { getLanguage, t, useT } from "../../i18n";
import { invoke, mockUrlParams } from "../../ipc";
import { durations, easings, springs } from "../../design/motion";
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
} from "../../design/icons";
import type { CmdItem } from "../../shared/types";
import { useIslandStore } from "../../store";
import {
  calculateCurrencyConversion,
  cachedCurrencyCatalog,
  fetchRatesForBase,
  type CurrencyRates,
} from "../../lib/cmd/currency";
import { currencyCompletion, currencyName, currencySuggestions } from "../../lib/cmd/currencyCompletion";
import {
  evaluateLocalFeatures,
  getQuickHints,
  mapBackendItem,
  type GroupedResults,
  type HeroCardData,
  type QuickHint,
  type UnifiedCmdItem,
} from "../../lib/cmd/ranking";

import { resultDelay } from "../../design/fx/commandMotion";
import "./commandMotion.css";
import { isReminderCommand, parseReminder } from "../../lib/reminders/parse";
import { reminderPreview } from "../../lib/reminders/format";
import { isFeatureEnabled } from "../../lib/features";
import { primeAudio } from "../../lib/timer/chime";
import { showToast } from "../toast";

export interface CommandBarProps {
  onClose: () => void;
  onHeightChange?: (height: number) => void;
  autoFocus?: boolean;
}

/**
 * Height calculation rule (spec §6.10):
 * - Header: 52px
 * - Footer: 36px
 * - Banner: 44px (36px + 8px margin-top)
 * - Hero card: 90px (74px + 8px margin-top + 8px margin-bottom)
 * - Group section label: 24px
 * - Row slot: 48px (46px + 2px gap)
 * - List vertical padding: 16px (8px top + 8px bottom)
 * - Clamped: min 160px, max 420px.
 * - Empty state: 368px (shows 5 complete rows).
 * - Not found: 280px (header + footer + 176px message + list padding).
 */
export function calcCmdBarHeight({
  query,
  itemsCount,
  groupsCount,
  hasHero,
  hasBanner,
}: {
  query: string;
  itemsCount: number;
  groupsCount: number;
  hasHero: boolean;
  hasBanner: boolean;
}): number {
  const HEADER_H = 52;
  const FOOTER_H = 36;
  const BANNER_H = 44;
  const HERO_H = 90;
  const GROUP_H = 24;
  const ROW_H = 48;
  const PAD_H = 16;
  const NOT_FOUND_H = 176; // Icon, title, wrapped RU/EN hint, gaps and empty-state padding.
  const MIN_H = 160;
  const MAX_H = 420;

  if (query.trim() === "") {
    const hintsCount = 5;
    return HEADER_H + FOOTER_H + GROUP_H + hintsCount * ROW_H + PAD_H; // 368px
  }

  if (itemsCount === 0 && !hasHero) {
    return HEADER_H + FOOTER_H + NOT_FOUND_H + PAD_H;
  }

  if (itemsCount === 0 && hasHero) {
    const bannerH = hasBanner ? BANNER_H : 0;
    return Math.max(MIN_H, HEADER_H + FOOTER_H + bannerH + HERO_H); // 178px or 222px
  }

  const bannerH = hasBanner ? BANNER_H : 0;
  const heroH = hasHero ? HERO_H : 0;
  const groupsH = groupsCount * GROUP_H;
  const rowsH = itemsCount * ROW_H;
  const total = HEADER_H + FOOTER_H + bannerH + heroH + groupsH + rowsH + PAD_H;

  return Math.max(MIN_H, Math.min(MAX_H, total));
}

function getLeadIcon(item: UnifiedCmdItem): ReactNode {
  if (item.icon) {
    return <img className="ig-cmd-app-badge" src={item.icon} alt="" width={18} height={18} />;
  }
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
  if (/terminal|терминал/iu.test(item.title)) return <IconTerminal size={18} />;
  if (item.title.includes("YouTube")) return <IconPlay size={18} />;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(item.title)) return <IconImage size={18} />;
  if (/\.(md|xlsx?|docx?|pdf|txt|json)$/i.test(item.title)) return <IconFile size={18} />;
  if (item.kind === "folder" || item.title.includes("Documents") || item.title.includes("Downloads")) return <IconFolder size={18} />;
  if (item.kind === "app") return <IconApp size={18} />;
  if (item.kind === "file") return <IconFile size={18} />;
  if (item.kind === "calc") return <IconCalculator size={18} />;
  if (item.kind === "convert") return <IconConverter size={18} />;
  if (item.kind === "command") {
    if (item.id.includes("timer")) return <IconTimer size={18} />;
    if (item.id.includes("settings")) return <IconSettings size={18} />;
    return <IconCommand size={18} />;
  }
  return <IconCommand size={18} />;
}

function getHintIcon(kind: QuickHint["kind"]): ReactNode {
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
    default:
      return <IconSearch size={16} />;
  }
}

export function CommandBar({
  onClose,
  onHeightChange,
  autoFocus = true,
}: CommandBarProps) {
  useT();
  const reduce = useReducedMotion();
  const [highlight, setHighlight] = useState<number | null>(null);
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState(() => mockUrlParams()?.get("cmdQuery") ?? "");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  const [backendItems, setBackendItems] = useState<CmdItem[]>([]);
  const [currencyRates, setCurrencyRates] = useState<{ rates: CurrencyRates | null; loading: boolean; error: boolean }>({
    rates: null,
    loading: false,
    error: false,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const searchGenRef = useRef(0);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // Handle local synchronous features
  const disabledFeatures = useIslandStore((s) => s.settings.disabledFeatures);
  const reminderQuery = !disabledFeatures.includes("notes") && isReminderCommand(query);
  const reminder = useMemo(() => reminderQuery ? parseReminder(query) : null, [query, reminderQuery]);
  const reminderBusy = useRef(false);
  const defaultCurrency = useIslandStore((s) => s.settings.defaultCurrency);
  const [catalog, setCatalog] = useState<CurrencyRates | null>(cachedCurrencyCatalog);
  const local = useMemo(() => evaluateLocalFeatures(query, undefined, defaultCurrency), [query, t, disabledFeatures, defaultCurrency, catalog]);
  const completion = useMemo(() => currencyCompletion(query), [query, catalog]);
  const [currencyIndex, setCurrencyIndex] = useState(0);
  const suggestions = useMemo(() => completion ? currencySuggestions(completion.fragment, catalog) : [], [completion, catalog, t]);
  const activeCurrency = suggestions[Math.min(currencyIndex, suggestions.length - 1)];
  const completionOpen = suggestions.length > 0;
  const completeCurrency = (code: string) => {
    if (!completion) return;
    setQuery(`${completion.prefix}${code}`);
    setCurrencyIndex(0);
    inputRef.current?.focus();
  };
  useEffect(() => {
    if (!completion) return;
    let cancelled = false;
    setCurrencyIndex(0);
    setCatalog(cachedCurrencyCatalog());
    void fetchRatesForBase(completion.base).then(rates => {
      if (!cancelled) setCatalog(rates);
    }, () => { /* The last cached provider catalog remains available offline. */ });
    return () => { cancelled = true; };
  }, [completion?.base]);
  useEffect(() => {
    if (completionOpen) document.getElementById(`cmd-currency-${activeCurrency}`)?.scrollIntoView?.({ block: "nearest" });
  }, [completionOpen, activeCurrency]);

  // Currency rates fetching with debounce / caching
  useEffect(() => {
    if (!local.currencyQuery) {
      setCurrencyRates({ rates: null, loading: false, error: false });
      return;
    }

    let cancelled = false;
    const base = local.currencyQuery.fromCode;

    setCurrencyRates((prev) => ({ ...prev, loading: true, error: false }));

    fetchRatesForBase(base)
      .then((rates) => {
        if (cancelled) return;
        setCurrencyRates({ rates, loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setCurrencyRates({ rates: null, loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [local.currencyQuery]);

  // Debounce cmd_search IPC call (~80ms)
  useEffect(() => {
    const q = query.trim();
    if (!q || reminderQuery) {
      setBackendItems([]);
      return;
    }

    const gen = ++searchGenRef.current;
    const timer = setTimeout(() => {
      invoke("cmd_search", { query: q, limit: 12 })
        .then((items) => {
          if (searchGenRef.current === gen) {
            setBackendItems(items);
          }
        })
        .catch(() => {
          if (searchGenRef.current === gen) {
            setBackendItems([]);
          }
        });
    }, 80);

    return () => {
      clearTimeout(timer);
    };
  }, [query, reminderQuery]);

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedNotification(t("copied"));
    setTimeout(() => setCopiedNotification(null), 1400);
  }, []);

  // Compute Hero Answer (instant math / units / currency)
  const heroAnswer: HeroCardData | null = useMemo(() => {
    if (local.math) {
      const isPercent = local.math.formula.includes("%");
      return {
        kind: "calc",
        value: `= ${local.math.value}`,
        formula: local.math.formula,
        meta: isPercent ? t("cmdCalcMetaPercent") : t("cmdCalcMetaExact"),
        plainValueToCopy: local.math.value,
        fullFormulaToCopy: `${local.math.formula} = ${local.math.value}`,
      };
    }

    if (local.units) {
      return {
        kind: "convert",
        value: local.units.value,
        formula: local.units.formula,
        meta: local.units.meta ?? t("cmdUnitsMeta"),
        plainValueToCopy: local.units.formattedNumber,
        fullFormulaToCopy: local.units.formula,
      };
    }

    if (local.currencyQuery) {
      if (currencyRates.loading) {
        return {
          kind: "convert",
          value: "…",
          formula: `${local.currencyQuery.amount} ${local.currencyQuery.fromCode} → ${local.currencyQuery.toCode}`,
          meta: t("cmdLoadingRates"),
          isLoading: true,
          plainValueToCopy: "",
          fullFormulaToCopy: "",
        };
      }

      if (currencyRates.rates) {
        const conv = calculateCurrencyConversion(local.currencyQuery, currencyRates.rates);
        if (conv) {
          return {
            kind: "convert",
            value: conv.value,
            formula: conv.formula,
            meta: conv.meta,
            stale: conv.stale,
            plainValueToCopy: conv.formattedAmount,
            fullFormulaToCopy: conv.formula,
          };
        }
      }
    }

    return null;
  }, [local.math, local.units, local.currencyQuery, currencyRates, t]);

  // Combine items into unified items list
  const unifiedItems: UnifiedCmdItem[] = useMemo(() => {
    const list: UnifiedCmdItem[] = [];
    if (reminder) {
      list.push({ id: "reminder-create", kind: "command", group: "commands", title: reminderPreview(reminder),
        subtitle: t("reminders.new"), icon: null, actionHint: t("reminders.create"),
        onExecute: async () => {
          if (reminderBusy.current || !isFeatureEnabled("notes")) return;
          reminderBusy.current = true;
          primeAudio();
          try {
            await invoke("reminders_add", reminder);
            if (isFeatureEnabled("notes")) showToast({ label: t("reminders.created") });
            onClose();
          } catch { showToast({ label: t("reminders.error") }); }
          finally { reminderBusy.current = false; }
        },
      });
      return list;
    }

    // 1) Backend items (apps & files)
    for (const b of backendItems) {
      list.push(mapBackendItem(b, onClose));
    }

    // 2) Commands
    for (const cmd of local.commands) {
      list.push({
        id: cmd.id,
        kind: "command",
        group: "commands",
        title: cmd.title,
        subtitle: cmd.subtitle,
        icon: null,
        actionHint: cmd.actionHint,
        onExecute: async () => {
          await cmd.execute();
          onClose();
        },
      });
    }

    return list;
  }, [backendItems, local.commands, onClose, reminder, t]);

  // Group items
  const groupedItems: GroupedResults[] = useMemo(() => {
    const apps = unifiedItems.filter((i) => i.group === "apps").slice(0, 5);
    const files = unifiedItems.filter((i) => i.group === "files").slice(0, 5);
    const commands = unifiedItems.filter((i) => i.group === "commands").slice(0, 3);

    const groups: GroupedResults[] = [];
    if (apps.length > 0) {
      groups.push({ group: "apps", label: t("cmdGroupApps"), items: apps });
    }
    if (files.length > 0) {
      groups.push({ group: "files", label: t("cmdGroupFiles"), items: files });
    }
    if (commands.length > 0) {
      groups.push({ group: "commands", label: t("cmdGroupCommands"), items: commands });
    }

    return groups;
  }, [unifiedItems]);

  // Flattened active items list for keyboard navigation
  const flatItems: UnifiedCmdItem[] = useMemo(() => {
    return groupedItems.flatMap((g) => g.items);
  }, [groupedItems]);

  const hasBanner = Boolean(
    (heroAnswer && heroAnswer.stale) ||
      currencyRates.error ||
      (local.currencyQuery && currencyRates.loading),
  );

  const hasBodyContent =
    query.trim() === "" ||
    flatItems.length > 0 ||
    (query.trim() !== "" && flatItems.length === 0 && !heroAnswer);

  // Height adaptive calculation
  const currentHeight = useMemo(() => {
    return calcCmdBarHeight({
      query,
      itemsCount: completionOpen ? suggestions.length : flatItems.length,
      groupsCount: completionOpen ? 1 : groupedItems.length,
      hasHero: Boolean(heroAnswer),
      hasBanner,
    });
  }, [query, flatItems.length, groupedItems.length, heroAnswer, hasBanner, completionOpen, suggestions.length]);

  useEffect(() => {
    onHeightChange?.(currentHeight);
  }, [currentHeight, onHeightChange]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
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

  const safeSelectedIndex = flatItems.length > 0 ? Math.min(selectedIndex, flatItems.length - 1) : 0;
  const selectedItem = flatItems[safeSelectedIndex];

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const row = selectedItem && document.getElementById(`cmd-item-${selectedItem.id}`);
    // The positioned body owns both offsets: scrolling moves the row and highlight together.
    setHighlight(body && row ? row.offsetTop : null);
  }, [selectedItem, query]);


  // Auto-scroll selected row into view
  useEffect(() => {
    if (flatItems.length === 0) return;
    const item = flatItems[safeSelectedIndex];
    if (!item) return;
    const el = document.getElementById(`cmd-item-${item.id}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [safeSelectedIndex, flatItems]);

  const handleHeroAction = useCallback(
    (withFormula = false) => {
      if (!heroAnswer) return;
      const textToCopy = withFormula ? heroAnswer.fullFormulaToCopy : heroAnswer.plainValueToCopy;
      if (textToCopy) {
        copyToClipboard(textToCopy);
      }
      onClose();
    },
    [heroAnswer, copyToClipboard, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (completionOpen && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrencyIndex(prev => (prev + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        completeCurrency(activeCurrency);
        return;
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (flatItems.length ? (prev + 1) % flatItems.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (flatItems.length ? (prev - 1 + flatItems.length) % flatItems.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (heroAnswer && (flatItems.length === 0 || e.shiftKey)) {
        handleHeroAction(e.shiftKey);
      } else if (selectedItem) {
        void selectedItem.onExecute({
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
        });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query.length > 0) {
        setQuery("");
      } else {
        onClose();
      }
    } else if (e.key === "Tab") {
      if (query.trim() === "") {
        e.preventDefault();
        const hints = getQuickHints();
        const hint = hints[0];
        if (hint) {
          setQuery(hint.query);
        }
      }
    }
  };

  const selectedItemId = selectedItem ? `cmd-item-${selectedItem.id}` : undefined;

  return (
    <div className="ig-cmd" data-resizing="false">
      {/* Header with Search Input */}
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
          aria-controls={completionOpen ? `${listboxId}-currencies` : listboxId}
          aria-activedescendant={completionOpen ? `cmd-currency-${activeCurrency}` : selectedItemId}
          placeholder={t("cmdPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
            setCurrencyIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="ig-cmd-header__actions">
          {currencyRates.loading && (
            <span className="ig-cmd-footer__status" style={{ color: "var(--ig-accent-text)", fontSize: "11px" }}>
              <span className="ig-cmd-shimmer" aria-hidden="true" />
              {t("cmdLoadingRates")}
            </span>
          )}
          {query.length > 0 && (
            <button
              type="button"
              className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
              aria-label={t("cmdClear")}
              title={t("cmdClearEsc")}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <IconClose size={14} />
            </button>
          )}
          <kbd className="ig-kbd" title={t("cmdHintClose")}>
            Esc
          </kbd>
        </div>
      </header>

      {/* Offline banner */}
      {heroAnswer?.stale && (
        <div className="ig-cmd-banner" role="alert">
          <IconWarning size={16} />
          <span>
            {local.currencyQuery
              ? t("cmdOfflineRatesBanner", {
                  base: local.currencyQuery.fromCode,
                  rate: heroAnswer.meta,
                  ago: t("cmdTwoHoursAgo"),
                })
              : t("cmdOfflineRatesBannerSimple")}
          </span>
        </div>
      )}

      {/* Loading exchange rates banner */}
      {local.currencyQuery && currencyRates.loading && (
        <div className="ig-cmd-banner ig-cmd-banner--info" role="status">
          <span className="ig-cmd-shimmer" aria-hidden="true" />
          <span>{t("cmdLoadingRatesBanner")}</span>
        </div>
      )}

      {/* Instant Hero result card */}
      {heroAnswer && !heroAnswer.isLoading && (
        <div
          className="ig-cmd-hero"
          role="region"
          aria-label={t("cmdInstantResult")}
          onClick={() => handleHeroAction(false)}
        >
          <div className="ig-cmd-hero__lead">
            {heroAnswer.kind === "calc" ? <IconCalculator size={22} /> : <IconConverter size={22} />}
          </div>
          <div className="ig-cmd-hero__body">
            <span className="ig-num ig-cmd-hero__value ig-cmd-value-stack">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={heroAnswer.value}
                  initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -4 }}
                  transition={{ duration: durations.med, ease: easings.out }}
                >{heroAnswer.value}</motion.span>
              </AnimatePresence>
            </span>
            <span className="ig-cmd-hero__formula">{heroAnswer.formula}</span>
            <span className="ig-cmd-hero__meta">{heroAnswer.meta}</span>
          </div>
          <div className="ig-cmd-hero__action">
            <kbd className="ig-kbd">Enter</kbd>
            <span>{t("cmdActionCopy")}</span>
          </div>
        </div>
      )}

      {/* Body: Hints or Results */}
      {completionOpen && <div id={`${listboxId}-currencies`} className="ig-cmd-body ig-scroll" role="listbox" aria-label={t("cmdCurrencies")}>
        <div className="ig-cmd-section-label">{t("cmdCurrencies")}</div>
        {suggestions.map(code => <div key={code} id={`cmd-currency-${code}`} className="ig-cmd-row"
          role="option" aria-selected={code === activeCurrency} data-currency-selected={code === activeCurrency}
          onMouseDown={event => event.preventDefault()} onClick={() => completeCurrency(code)}
          onMouseEnter={() => setCurrencyIndex(suggestions.indexOf(code))}>
          <span className="ig-cmd-row__lead"><IconConverter size={18} /></span>
          <span className="ig-cmd-row__body"><span className="ig-cmd-row__title">{code}</span>
            <span className="ig-cmd-row__meta">{currencyName(code, getLanguage())}</span></span>
          <span className="ig-cmd-row__action"><kbd className="ig-kbd">Tab</kbd><span>{t("cmdCompleteCurrency")}</span></span>
        </div>)}
      </div>}
      {!completionOpen && hasBodyContent && (
        <div
          ref={bodyRef}
          id={listboxId}
          className="ig-cmd-body ig-scroll"
          role="listbox"
          aria-label={t("cmdSearchResults")}
          data-scrollable={scrollState.isScrollable}
          data-scrolled-top={scrollState.scrolledTop}
          data-scrolled-bottom={scrollState.scrolledBottom}
          onScroll={updateScrollState}
        >
          {/* Empty state: 5 quick hints */}
          {query.trim() === "" && (
            <div className="ig-cmd-group">
              <div className="ig-cmd-section-label">{t("cmdGroupHints")}</div>
              {getQuickHints().map((hint, index) => (
                <motion.div
                  initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: durations.med, ease: easings.out, delay: reduce ? 0 : resultDelay(index) }}
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
                </motion.div>
              ))}
            </div>
          )}

          {/* Nothing found state */}
          {query.trim() !== "" && flatItems.length === 0 && !heroAnswer && (
            <div className="ig-empty ig-cmd-not-found">
              <div className="ig-empty__icon">
                <IconSearch size={20} />
              </div>
              <h3 className="ig-empty__title">{t("cmdEmptyTitle")}</h3>
              <p className="ig-empty__text">{t("cmdEmptyDesc", { query })}</p>
            </div>
          )}

          {highlight !== null && (
            <motion.div key={reduce ? selectedItem?.id : "selection"} aria-hidden="true" className="ig-cmd-highlight"
              initial={reduce ? { opacity: 0, y: highlight } : false} animate={{ opacity: 1, y: highlight }}
              transition={reduce ? { duration: durations.med } : springs.cmdSelect} />
          )}

          {/* Grouped results */}
          {groupedItems.length > 0 && (
            <AnimatePresence initial={false}>
              {groupedItems.map((group) => (
                <div key={group.group} className="ig-cmd-group">
                  <div className="ig-cmd-section-label">{group.label}</div>
                  {group.items.map((item) => {
                    const globalIdx = flatItems.findIndex((it) => it.id === item.id);
                    const isSelected = globalIdx === safeSelectedIndex;
                    return (
                      <motion.div
                        key={item.id}
                        id={`cmd-item-${item.id}`}
                        className="ig-cmd-row"
                        role="option"
                        aria-selected={isSelected}
                        initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: durations.med, ease: easings.out, delay: reduce ? 0 : resultDelay(globalIdx) }}
                        onClick={() => void item.onExecute()}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                      >
                        <span className="ig-cmd-row__lead" data-kind={item.kind}>
                          {getLeadIcon(item)}
                        </span>
                        <span className="ig-cmd-row__body">
                          <span className="ig-cmd-row__title">{item.title}</span>
                          <span className="ig-cmd-row__meta">{item.subtitle}</span>
                        </span>
                        <span className="ig-cmd-row__action">
                          <kbd className="ig-kbd">Enter</kbd>
                          <span>{item.actionHint}</span>
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

      {/* Footer bar with keyboard hints */}
      <footer className="ig-cmd-footer">
        <div className="ig-cmd-footer__hints">
          <span className="ig-cmd-hint-item">
            <kbd className="ig-kbd">↑</kbd>
            <kbd className="ig-kbd">↓</kbd>
            <span>{t("cmdHintNavigate")}</span>
          </span>

          {completionOpen ? <span className="ig-cmd-hint-item"><kbd className="ig-kbd">Tab</kbd><kbd className="ig-kbd">Enter</kbd><span>{t("cmdCompleteCurrency")}</span></span> : (heroAnswer && flatItems.length === 0) || selectedItem?.kind === "calc" || selectedItem?.kind === "convert" ? (
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdActionCopy")}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Shift</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdWithFormula")}</span>
              </span>
            </>
          ) : selectedItem?.kind === "app" ? (
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdActionOpen")}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Ctrl</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdActionRunAdmin")}</span>
              </span>
            </>
          ) : selectedItem?.kind === "file" || selectedItem?.kind === "folder" ? (
            <>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdActionOpen")}</span>
              </span>
              <span className="ig-cmd-hint-item">
                <kbd className="ig-kbd">Ctrl</kbd>
                <kbd className="ig-kbd">Enter</kbd>
                <span>{t("cmdActionReveal")}</span>
              </span>
            </>
          ) : selectedItem?.kind === "command" ? (
            <span className="ig-cmd-hint-item">
              <kbd className="ig-kbd">Enter</kbd>
              <span>{t("cmdActionRun")}</span>
            </span>
          ) : (
            <span className="ig-cmd-hint-item">
              <kbd className="ig-kbd">Tab</kbd>
              <span>{t("cmdUseHint")}</span>
            </span>
          )}

          <span className="ig-cmd-hint-item">
            <kbd className="ig-kbd">Esc</kbd>
            <span>{t("cmdHintClose")}</span>
          </span>
        </div>

        <div className="ig-cmd-footer__status">
          {copiedNotification ? (
            <span className="ig-cmd-copied"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path className="ig-cmd-check" pathLength="1" d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" /></svg>{copiedNotification}</span>
          ) : (
            <span>CCOTT</span>
          )}
        </div>
      </footer>
    </div>
  );
}
