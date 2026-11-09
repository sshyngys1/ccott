import { HeadsetPill, useHeadsetConnect } from "../lib/audio/HeadsetPill";
import { AgentBadge, AgentsPill } from "../modules/agents/Agents";
import { AGENTS_PRIORITY, useAgents } from "../modules/agents/store";
import { DownloadsPill } from "../lib/downloads/DownloadsPill";
import { DOWNLOADS_PRIORITY, useDownloadsActive } from "../lib/downloads/store";
import { t, useT, localizeMessage } from "../i18n";
import { useDockStore } from "../lib/dock/store";
import { useFeatureEnabled } from "../lib/features";
import { needsTallPanel } from "../lib/tiles/layout";
import { useTilesEditStore } from "../lib/tiles/store";
import { useDockDrop } from "./useDockDrop";
import { useShelfCount, useShelfStore } from "../modules/shelf/store";
import { IconShelf } from "../modules/shelf/IconShelf";
import { requestShell } from "../shared/shellBus";
// Owner: F1 (Frontend-Shell). One element morphs between the resting pill and the expanded panel (spec §15).
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { hoveredPill, panelBox, readIslandGeometry, type BoxSize } from "../design/geometry";
import { IconBack, IconCheck, IconCollapse, IconSettings, IconFile, IconFolder } from "../design/icons";
import { durations, easings, fades, overshoot, pressScale, springs, tabSlide, viewSlide } from "../design/motion";
import { usePointerLight } from "../design/usePointerLight";
import { mockUrlParams, registerHoverTarget } from "../ipc";
import { modules as registry } from "../modules/registry";
import type { IslandModule } from "../shared/types";
import { useIslandStore, type PillToast as PillToastState } from "../store";
import { useHoverSync } from "../store/useHoverSync";
import { formatDate, useClock } from "./clock";
import { useActiveCompact } from "./compact";
import { useScreenPreload } from "./preloadScreens";
import { useShapeSync } from "./shape";
import { openSettingsWindow } from "./settings/openWindow";
import { useShellBus } from "./shellBus";
import { Tabs, tabId, tabPanelId } from "./Tabs";
import { orderVisibleTabs } from "./tabs/order";
import { useTabsEditStore } from "./tabs/store";
import { useKeyboardFocus } from "./useKeyboardFocus";
import { usePrewarm } from "./usePrewarm";
import { useLiteSync, useModeSync, useSettingsSync, useThemeSync, useToastSync, useVibrancySync } from "./useShellSync";
import { BatteryIndicator } from "../lib/battery/BatteryIndicator";
import { WhatsNewView } from "./WhatsNewView";
import { LyricsCaption, LyricsPillChip, LyricsView } from "./LyricsView";
import { LyricsPill, useLyricsPillActive } from "../lib/lyrics/LyricsPill";
import { LyricsTint } from "../lib/lyrics/LyricsTint";
import { useLyricsController, useLyricsStore } from "../lib/lyrics/store";
import { usePillFitStore } from "../lib/lyrics/pillFit";
import { useMediaStore } from "../lib/media/store";
import { CommandBar, calcCmdBarHeight } from "./cmd/CommandBar";
import { evaluateLocalFeatures } from "../lib/cmd/ranking";
import { useState } from "react";
import { AttachWave } from "../design/fx/AttachWave";
import { DropChoiceView } from "./dropChoice/DropChoiceView";
import { resetDropChoice, useDropChoiceStore } from "./dropChoice/store";
import "./shell.css";

type PillState = "idle" | "activity" | "toast";
type TransitionKind = "expand" | "collapse" | "pill" | "cmdExpand" | "cmdCollapse" | "cmdResize";

function ScreenFallback() {
  const t = useT();
  return <div className="ig-empty" role="status" data-screen-fallback="true">{t("loadingScreen")}</div>;
}

/** Pill content swap: `swap` = a change between pill states (quick crossfade), otherwise the panel hand-over timing. */
const pillLayer = {
  initial: { opacity: 0 },
  enter: (swap: boolean) => ({ opacity: 1, transition: swap ? fades.pillSwap : fades.pillIn }),
  exit: (swap: boolean) => ({ opacity: 0, transition: swap ? fades.pillSwap : fades.pillOut }),
};

function PillIdle() {
  useT();
  const time = useClock();
  const shelfEnabled = useFeatureEnabled("shelf");
  const count = useShelfStore(s => s.items.length);
  return (
    <div className="ig-pill-row ig-pill-row--idle">
      <time className="ig-pill-time ig-num" aria-label={t("currentTime")}>
        {time}
      </time>
      {shelfEnabled && count > 0 && <button type="button" className="ig-shelf-badge" aria-label={t("shelf.count", { count })}
        onClick={() => { void requestShell({ type: "openTab", tab: "shelf" }); }}><IconShelf size={16} /><span className="ig-num">{count}</span></button>}
      <BatteryIndicator variant="pill" />
    </div>
  );
}

export function PillToast({ label, preview, previewKey, onClick, actionLabel, color, actions, shortcut, title, detail, onShown, reminderId }: Omit<PillToastState, "id">) {
  useT();
  useEffect(() => { onShown?.(); }, [onShown]);
  const wholeAction = onClick && !actionLabel && !actions?.length;
  const Tag = wholeAction ? "button" : "div";
  return (
    <div className={`ig-pill-feedback${shortcut ? " ig-pill-feedback--shortcut" : ""}`} role="status" title={title ? reminderId ? title : localizeMessage(title) : localizeMessage(label)}>
    <Tag className={wholeAction ? "ig-pill-row ig-pill-action" : "ig-pill-row"} onClick={wholeAction ? onClick : undefined} title={wholeAction ? t("capture.openFolder") : undefined}>
      {!shortcut && (color && /^#[\da-f]{6}$/i.test(color) ? <span className="ig-pill-color" style={{backgroundColor:color}} aria-hidden="true" /> : <span className="ig-pill-badge" aria-hidden="true">
        <IconCheck size={14} />
      </span>)}
      {shortcut ? <span className="ig-pill-hotkey-message">
        <span className="ig-pill-hotkey-line">
          <span className="ig-pill-label ig-pill-label--solo ig-truncate">{localizeMessage(label)}</span>
          <span className="ig-pill-shortcut">{shortcut}</span>
        </span>
        {detail && <span className="ig-pill-hotkey-detail">{localizeMessage(detail)}</span>}
      </span> : <span className={preview ? "ig-pill-label" : "ig-pill-label ig-pill-label--solo ig-truncate"}>{localizeMessage(label)}</span>}
      {preview && <span className="ig-pill-preview ig-truncate">{previewKey ? t(previewKey) : preview}</span>}
      {onClick && actionLabel && <button type="button" className="ig-glass-control ig-glass-control--sm" onClick={onClick}>{localizeMessage(actionLabel)}</button>}
      {actions?.map((action) => <button key={action.icon} type="button"
        className={`ig-glass-control ig-glass-control--sm${action.text || action.icon === "settings" ? "" : " ig-glass-control--icon"}`}
        title={localizeMessage(action.label)} aria-label={localizeMessage(action.label)}
        onClick={action.onClick}>
        {action.text || action.icon === "settings" ? localizeMessage(action.label) : action.icon === "folder" ? <IconFolder size={14} /> : <IconFile size={14} />}
      </button>)}
    </Tag>
    </div>
  );
}

function HeadClock() {
  useT();
  const time = useClock();
  return (
    <span className="ig-head-clock">
      <span className="ig-head-time ig-num">{time}</span>
      <span className="ig-head-date">{formatDate(new Date())}</span>
    </span>
  );
}

/** True when the element took focus because of a mouse/touch press (it does not match `:focus-visible`). */
function focusIsFromPointer(el: EventTarget): boolean {
  try {
    return el instanceof Element && !el.matches(":focus-visible");
  } catch {
    return false; // no :focus-visible support → treat as keyboard focus (the old behaviour)
  }
}

interface IslandProps {
  /** Tabs and live activities. Must be a stable list (module-level); defaults to the registry. */
  modules?: readonly IslandModule[];
}

export function Island({ modules = registry }: IslandProps) {
  useT();
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mode = useIslandStore((s) => s.mode);
  const hoverInside = useIslandStore((s) => s.hoverInside);
  const hoverSuppressed = useIslandStore((s) => s.hoverSuppressed);
  const activeTab = useIslandStore((s) => s.activeTab);
  const setActiveTab = useIslandStore((s) => s.setActiveTab);
  const view = useIslandStore((s) => s.view);
  const setView = useIslandStore((s) => s.setView);
  const toast = useIslandStore((s) => s.toast);
  const theme = useIslandStore((s) => s.theme);
  const vibrancy = useIslandStore((s) => s.vibrancy);
  const quickTiles = useIslandStore((s) => s.settings.quickTiles);
  const tabOrder = useIslandStore((s) => s.settings.tabOrder);
  const disabledFeatures = useIslandStore((s) => s.settings.disabledFeatures);
  const tabsEditing = useTabsEditStore((s) => s.editing);
  const dockEnabled = useFeatureEnabled("dock");
  const shelfEnabled = useFeatureEnabled("shelf");
  const visibleModules = useMemo(
    () => orderVisibleTabs(modules, tabOrder, disabledFeatures),
    [modules, tabOrder, disabledFeatures],
  );
  const showTabBar = tabsEditing || visibleModules.length > 1;
  const compactHead = !showTabBar;
  const activeHidden = activeTab !== "home" && !visibleModules.some((m) => m.id === activeTab);
  useEffect(() => {
    if (activeHidden) setActiveTab("home");
  }, [activeHidden, setActiveTab]);
  const tall = useMemo(() => needsTallPanel(quickTiles, disabledFeatures), [quickTiles, disabledFeatures]);
  const expanded = mode === "expanded";
  const hover = !expanded && hoverInside && !hoverSuppressed;
  const whatsNewOpen = view === "whatsNew";
  const lyricsFeature = useFeatureEnabled("lyrics");
  const hasMediaSession = useMediaStore((s) => s.media.hasSession);
  const lyricsOpen = expanded && view === "lyrics" && lyricsFeature;
  const subView = whatsNewOpen || lyricsOpen;
  const cmdOpen = expanded && view === "cmd";
  const dropChoiceActive = useDropChoiceStore((s) => s.active);
  const dropChoiceOpen = expanded && dropChoiceActive;

  useEffect(() => {
    if (mode === "collapsed" && useDropChoiceStore.getState().active) {
      resetDropChoice();
    }
  }, [mode]);
  const [cmdHeight, setCmdHeight] = useState(() => {
    // Browser mock deep link `?cmdQuery=…` opens with the matching height.
    const q = mockUrlParams()?.get("cmdQuery");
    if (!q) return 368;
    const local = evaluateLocalFeatures(q);
    return calcCmdBarHeight({
      query: q,
      itemsCount: local.commands.length,
      groupsCount: local.commands.length > 0 ? 1 : 0,
      hasHero: Boolean(local.math || local.units || local.currencyQuery),
      hasBanner: false,
    });
  });

  useLyricsController();
  useEffect(() => {
    // The lyrics view needs a playing session and the feature; otherwise it closes (no empty view).
    if (view === "lyrics" && (!lyricsFeature || (expanded && !hasMediaSession))) setView("tabs");
  }, [view, lyricsFeature, expanded, hasMediaSession, setView]);
  useThemeSync();
  useLiteSync();
  useVibrancySync();
  useSettingsSync();
  useScreenPreload();
  useToastSync();
  useModeSync(mode);
  const controls = useHoverSync();
  const keyboard = useKeyboardFocus(ref);
  const prepareExpand = usePrewarm(ref);
  useShellBus(controls, keyboard.release, visibleModules, prepareExpand);
  useDockDrop(controls);

  // Hover source: Tauri → Rust cursor poller (no-op here); browser → mock pointerenter/pointerleave on this element.
  useEffect(() => registerHoverTarget(ref.current), []);
  usePointerLight(ref);

  // Sizes come from the design tokens; re-read when theme/vibrancy (which may override tokens) change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => readIslandGeometry(), [theme, vibrancy]);

  const compact = useActiveCompact(modules);
  const agentSessions = useAgents();
  const showAgents = agentSessions.some(s => s.state === "waiting") && (compact?.compact?.priority ?? -Infinity) < AGENTS_PRIORITY;
  useShelfCount(shelfEnabled);
  const rawShelfDrop = useShelfStore(s => s.dropTarget === "pill");
  const shelfDrop = shelfEnabled && rawShelfDrop;
  const downloadsActive = useDownloadsActive();
  const downloadsEnabled = useIslandStore((s) => s.settings.downloadsMonitor);
  const showDownloads = downloadsEnabled && downloadsActive && (compact?.compact?.priority ?? -Infinity) < DOWNLOADS_PRIORITY;
  const headset = useHeadsetConnect();
  const doNotDisturb = useIslandStore((s) => s.doNotDisturb);
  const showHeadset = Boolean(headset && !doNotDisturb && !(downloadsEnabled && downloadsActive));
  const lyricsPillActive = useLyricsPillActive();
  // The lyric line replaces the plain media activity only (timer, downloads, agents, headset keep their higher priority).
  const CompactView = showDownloads ? DownloadsPill : showAgents ? AgentsPill : showHeadset ? HeadsetPill : compact?.id === "home" && lyricsPillActive ? LyricsPill : compact?.compact?.View;
  const lyricsPillShown = CompactView === LyricsPill;
  const pillState: PillState = shelfDrop ? "idle" : toast ? "toast" : CompactView ? "activity" : "idle";
  const toastSize = toast?.shortcut || toast?.reminderId
    ? { ...geo.pillToast, width: Math.min(geo.panel.width, geo.pillToast.width + geo.pill.width) }
    : geo.pillToast;
  const lyricsFitWidth = usePillFitStore((s) => s.width);
  const pillBase: BoxSize = pillState === "toast" ? toastSize : pillState === "activity" ? (lyricsPillShown ? { ...geo.pillLyrics, width: Math.min(geo.panel.width, Math.max(geo.pillLyrics.width, lyricsFitWidth ?? 0)) } : geo.pillActivity) : geo.pill;
  // Cover colouring: the lyrics pill (collapsed) or the lyrics view (expanded).
  const lyricsPalette = useLyricsStore((s) => s.palette);
  const tintOn = !shelfDrop && (lyricsOpen && !dropChoiceOpen && !cmdOpen || !expanded && pillState === "activity" && lyricsPillShown);
  const panelSize = useMemo(
    () => panelBox(geo, { dock: dockEnabled, tabBar: showTabBar, tall }),
    [geo, dockEnabled, showTabBar, tall],
  );
  const cmdSize: BoxSize = {
    width: geo.cmd.width,
    height: cmdHeight,
    radius: geo.cmd.radius,
  };
  const size: BoxSize = cmdOpen
    ? cmdSize
    : expanded
    ? panelSize
    : hover
    ? hoveredPill(pillBase, geo.pillHoverGrow)
    : pillBase;
  // One crossfade layer per distinct pill content: a different activity module is a different layer.
  const pillKey = pillState === "activity" ? `pill-activity-${showDownloads ? "downloads" : showAgents ? "agents" : showHeadset && headset ? `headset-${headset.id}` : lyricsPillShown ? "lyrics" : compact?.id}` : pillState === "toast" ? `pill-toast-${toast?.id}` : `pill-${pillState}`;

  // Which spring drives this change: expand / collapse when the mode flips, "pill" for hover growth and activity changes.
  // Derived during render (idempotent under StrictMode) so the very first frame already uses the right spring.
  const kindRef = useRef<TransitionKind>("pill");
  const prevRef = useRef({ mode, hover, pillKey, panelHeight: panelSize.height, pillWidth: pillBase.width });
  const prev = prevRef.current;
  if (prev.mode !== mode) kindRef.current = expanded ? "expand" : "collapse";
  else if (expanded && prev.panelHeight !== panelSize.height) kindRef.current = "expand";
  else if (prev.hover !== hover || prev.pillKey !== pillKey || (!expanded && prev.pillWidth !== pillBase.width)) kindRef.current = "pill";
  prevRef.current = { mode, hover, pillKey, panelHeight: panelSize.height, pillWidth: pillBase.width };

  // Shape → Rust: a covering shape when a transition starts, the exact one when Motion reports it finished (no per-frame IPC).
  const settleShape = useShapeSync(ref, size, geo.top, overshoot(springs[kindRef.current]));

  // Keep the definition stable across content renders. Motion passes this same object to its lifecycle callbacks,
  // so a cancelled transition's late completion cannot restore expensive glass during a newer resize (even A→B→A).
  const resizeTarget = useMemo(
    () => ({ width: size.width, height: size.height, borderRadius: size.radius }),
    [size.width, size.height, size.radius],
  );
  const resizeTargetRef = useRef(resizeTarget);
  useLayoutEffect(() => { resizeTargetRef.current = resizeTarget; }, [resizeTarget]);
  useEffect(() => {
    const el = ref.current;
    return () => { el?.removeAttribute("data-resizing"); };
  }, []);

  const activeModule =
    visibleModules.find((m) => m.id === activeTab) ??
    visibleModules.find((m) => m.id === "home") ??
    visibleModules[0];
  const ActiveTab = activeModule?.Tab;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return; // a module may claim Escape (e.g. clear its search) via preventDefault
    if (dropChoiceOpen) {
      resetDropChoice();
      controls.collapseNow();
      return;
    }
    if (keyboard.isActive()) {
      // The keys came to us only because a field holds the keyboard: Escape hands it back and closes the island
      // (a second Escape would already go to the other window).
      keyboard.release();
      controls.collapseNow();
    } else if (subView) setView("tabs");
    else controls.collapseNow();
  };

  // Keyboard focus (Tab) expands the island. Focus from a mouse press must not: pressing a pill activity focuses its
  // button, the expansion would swap the pill out before the mouseup, and the click (→ openTab) would never happen.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && focusIsFromPointer(e.target)) return;
    controls.expandNow();
  };

  // Tab focus leaving the island collapses it unless hover owns the collapse. Only cmd waits for explicit actions
  // or native focus-changed, since its DOM blur can be a WebView2 focus hand-off.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const dock = useDockStore.getState();
    const tabsEdit = useTabsEditStore.getState();
    const tilesEdit = useTilesEditStore.getState();
    if (dock.dragging || dock.interacting || tabsEdit.editing || tabsEdit.menuOpen || tilesEdit.editing) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    const state = useIslandStore.getState();
    if (state.view === "cmd") return;
    if (state.hoverInside) return;
    controls.collapseNow();
  };

  const bodyEnter = { opacity: 0, y: tabSlide.enter };
  const bodyExit = { opacity: 0, y: tabSlide.exit };

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={ref}
        className={`${expanded ? "ig-glass ig-island" : "ig-glass ig-glass--pill ig-island"}${tintOn ? " ig-glass--lyrics" : ""}`}
        data-mode={mode}
        data-tall={tall}
        data-dock={dockEnabled}
        data-hover={hover}
        data-shelf-drop={shelfDrop}
        role="region"
        aria-label="Dynamic Island"
        tabIndex={0}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        initial={false}
        animate={resizeTarget}
        transition={springs[kindRef.current]}
        onAnimationStart={(definition) => {
          // Runs before Motion starts writing size frames; reversing a resize keeps the cheap glass in place.
          if (definition === resizeTargetRef.current) ref.current?.setAttribute("data-resizing", "true");
        }}
        onAnimationComplete={(definition) => {
          if (definition !== resizeTargetRef.current) return;
          ref.current?.removeAttribute("data-resizing");
          settleShape();
        }}
        // Centered in CSS (left/right 0 + auto margins), not with `x: -50%`: a transform promotes the island to its own
        // compositor layer, and resizing that layer made the GPU process block for 300–450 ms on the first frame.
        style={{ top: geo.top }}
      >
        <LyricsTint palette={lyricsPalette} on={tintOn} />
        <AttachWave />
        <AnimatePresence initial={false} custom={kindRef.current === "pill"}>
          {expanded ? (
            cmdOpen ? (
              <motion.div
                key="cmd"
                className="ig-island-layer ig-island-layer--cmd"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fades.panelIn }}
                exit={{ opacity: 0, transition: fades.panelOut }}
              >
                <CommandBar
                  onClose={() => {
                    void keyboard.release();
                    controls.collapseNow();
                  }}
                  onHeightChange={setCmdHeight}
                />
              </motion.div>
            ) : dropChoiceOpen ? (
              <motion.div
                key="drop-choice"
                className="ig-island-layer ig-island-layer--panel"
                style={{ height: panelSize.height }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fades.panelIn }}
                exit={{ opacity: 0, transition: fades.panelOut }}
              >
                <DropChoiceView />
              </motion.div>
            ) : (
              <motion.div
                key="panel"
              className="ig-island-layer ig-island-layer--panel"
              style={{ height: panelSize.height }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: fades.panelIn }}
              exit={{ opacity: 0, transition: fades.panelOut }}
            >
              <div className="ig-panel" data-compact-head={compactHead ? "true" : undefined}>
                <header
                  className="ig-panel-head"
                  data-editing-tabs={tabsEditing && !subView ? "true" : undefined}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {subView ? (
                      <motion.div
                        key={whatsNewOpen ? "whats-new-head" : "lyrics-head"}
                        className="ig-settings-head"
                        initial={{ opacity: 0, x: viewSlide.enter }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: viewSlide.enter }}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        <motion.button
                          type="button"
                          className={
                            compactHead
                              ? "ig-glass-control ig-glass-control--icon ig-glass-control--sm ig-glass-control--round ig-glass-control--ghost"
                              : "ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
                          }
                          aria-label={whatsNewOpen ? t("back") : t("lyrics.back")}
                          title={t("backEsc")}
                          whileTap={{ scale: pressScale }}
                          transition={springs.press}
                          onClick={() => setView("tabs")}
                        >
                          <IconBack size={compactHead ? 16 : 20} />
                        </motion.button>
                        {whatsNewOpen ? <h2 className="ig-view-title">{t("whatsNew.title")}</h2> : (
                          <span className="ig-lyrics-head-title">
                            <h2 className="ig-view-title">{t("lyrics.title")}</h2>
                            <LyricsCaption />
                          </span>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="tabs-head"
                        className="ig-tabs-head"
                        initial={{ opacity: 0, x: viewSlide.exit }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: viewSlide.exit }}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        <Tabs
                          modules={visibleModules}
                          allModules={modules}
                          active={activeModule?.id ?? activeTab}
                          onSelect={setActiveTab}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="ig-panel-head-right">
                    {lyricsOpen && <LyricsPillChip />}
                    <BatteryIndicator variant="head" />
                    <HeadClock />
                    <motion.button
                      type="button"
                      className={
                        compactHead
                          ? "ig-glass-control ig-glass-control--icon ig-glass-control--sm ig-glass-control--round ig-glass-control--ghost"
                          : "ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
                      }
                      aria-label={t("settings")}
                      title={t("settings")}
                      transition={springs.press}
                      onClick={() => {
                        controls.collapseNow();
                        void keyboard.release().then(openSettingsWindow);
                      }}
                    >
                      <IconSettings size={compactHead ? 16 : 20} />
                    </motion.button>
                    <motion.button
                      type="button"
                      className={
                        compactHead
                          ? "ig-glass-control ig-glass-control--icon ig-glass-control--sm ig-glass-control--round"
                          : "ig-glass-control ig-glass-control--icon"
                      }
                      aria-label={t("collapse")}
                      title={t("collapseEsc")}
                      whileTap={{ scale: pressScale }}
                      transition={springs.press}
                      onClick={controls.collapseNow}
                    >
                      <IconCollapse size={compactHead ? 16 : 20} />
                    </motion.button>
                  </div>
                </header>
                <div
                  className="ig-panel-body"
                  role={subView ? "region" : "tabpanel"}
                  aria-label={whatsNewOpen ? t("whatsNew.title") : lyricsOpen ? t("lyrics.title") : !showTabBar ? activeModule?.title : undefined}
                  id={!subView && activeModule ? tabPanelId(activeModule.id) : undefined}
                  aria-labelledby={!subView && activeModule && showTabBar ? tabId(activeModule.id) : undefined}
                  tabIndex={subView ? undefined : 0}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {subView ? (
                      <motion.div
                        key={whatsNewOpen ? "whats-new" : "lyrics"}
                        style={{ height: "100%" }}
                        initial={bodyEnter}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        exit={bodyExit}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        {whatsNewOpen ? <WhatsNewView showTitle={false} /> : <LyricsView />}
                      </motion.div>
                    ) : (
                      ActiveTab && (
                        <motion.div
                          key={activeModule.id}
                          style={{ height: "100%" }}
                          initial={bodyEnter}
                          animate={{ opacity: 1, x: 0, y: 0 }}
                          exit={bodyExit}
                          transition={{ ...springs.tab, opacity: fades.pillSwap }}
                        >
                          <Suspense fallback={<ScreenFallback />}>
                            <ActiveTab />
                          </Suspense>
                        </motion.div>
                      )
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )
        ) : (
            <motion.div
              key={pillKey}
              className="ig-island-layer"
              custom={kindRef.current === "pill"}
              variants={pillState === "toast" ? {
                initial: { opacity: 0, y: reduce ? 0 : viewSlide.enter },
                enter: { opacity: 1, y: 0, transition: { duration: durations.med, ease: easings.out } },
                exit: { opacity: 0, y: reduce ? 0 : -viewSlide.enter, transition: { duration: durations.med, ease: easings.out } },
              } : pillLayer}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              {shelfDrop ? <div className="ig-pill-row ig-shelf-drop" role="status"><IconShelf size={16} /><span>{t("shelf.drop")}</span></div> : pillState === "toast" && toast ? (
                <PillToast {...toast} />
              ) : CompactView ? (
                <div className="ig-agent-content"><CompactView /><AgentBadge /></div>
              ) : (
                <div className="ig-agent-content"><PillIdle /><AgentBadge /></div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </MotionConfig>
  );
}
