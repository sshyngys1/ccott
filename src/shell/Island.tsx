import { t, useT, localizeMessage } from "../i18n";
import { useDockStore } from "../lib/dock/store";
import { useDockDrop } from "./useDockDrop";
// Owner: F1 (Frontend-Shell). One element morphs between the resting pill and the expanded panel (spec §15).
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { hoveredPill, readIslandGeometry, type BoxSize } from "../design/geometry";
import { IconBack, IconCheck, IconCollapse, IconSettings } from "../design/icons";
import { fades, layerScale, overshoot, pressScale, springs, tabSlide, viewSlide } from "../design/motion";
import { usePointerLight } from "../design/usePointerLight";
import { registerHoverTarget } from "../ipc";
import { modules as registry } from "../modules/registry";
import type { IslandModule } from "../shared/types";
import { useIslandStore, type PillToast as PillToastState } from "../store";
import { useHoverSync } from "../store/useHoverSync";
import { formatDate, useClock } from "./clock";
import { useActiveCompact } from "./compact";
import { settingsScreen } from "./settings/deferred";
import { useScreenPreload } from "./preloadScreens";
import { useShapeSync } from "./shape";
import { useShellBus } from "./shellBus";
import { Tabs, tabId, tabPanelId } from "./Tabs";
import { useKeyboardFocus } from "./useKeyboardFocus";
import { usePrewarm } from "./usePrewarm";
import { useModeSync, useSettingsSync, useThemeSync, useToastSync, useVibrancySync } from "./useShellSync";
import "./shell.css";

type PillState = "idle" | "activity" | "toast";
type TransitionKind = "expand" | "collapse" | "pill";

const SettingsView = settingsScreen.Screen;

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
  return (
    <div className="ig-pill-row ig-pill-row--idle">
      <time className="ig-pill-time ig-num" aria-label={t("currentTime")}>
        {time}
      </time>
    </div>
  );
}

export function PillToast({ label, preview, previewKey, onClick, actionLabel, color }: Pick<PillToastState, "label" | "preview" | "previewKey" | "onClick" | "actionLabel" | "color">) {
  useT();
  const wholeAction = onClick && !actionLabel;
  const Tag = wholeAction ? "button" : "div";
  return (
    <div className="ig-pill-feedback" role="status">
    <Tag className={wholeAction ? "ig-pill-row ig-pill-action" : "ig-pill-row"} onClick={wholeAction ? onClick : undefined} title={wholeAction ? t("capture.openFolder") : undefined}>
      {color && /^#[\da-f]{6}$/i.test(color) ? <span className="ig-pill-color" style={{backgroundColor:color}} aria-hidden="true" /> : <span className="ig-pill-badge" aria-hidden="true">
        <IconCheck size={14} />
      </span>}
      <span className={preview ? "ig-pill-label" : "ig-pill-label ig-pill-label--solo ig-truncate"}>{localizeMessage(label)}</span>
      {preview && <span className="ig-pill-preview ig-truncate">{previewKey ? t(previewKey) : preview}</span>}
      {onClick && actionLabel && <button type="button" className="ig-glass-control ig-glass-control--sm" onClick={onClick}>{localizeMessage(actionLabel)}</button>}
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
  const mode = useIslandStore((s) => s.mode);
  const hoverInside = useIslandStore((s) => s.hoverInside);
  const activeTab = useIslandStore((s) => s.activeTab);
  const setActiveTab = useIslandStore((s) => s.setActiveTab);
  const view = useIslandStore((s) => s.view);
  const setView = useIslandStore((s) => s.setView);
  const toast = useIslandStore((s) => s.toast);
  const theme = useIslandStore((s) => s.theme);
  const vibrancy = useIslandStore((s) => s.vibrancy);
  const expanded = mode === "expanded";
  const hover = !expanded && hoverInside;
  const settingsOpen = view === "settings";

  useThemeSync();
  useVibrancySync();
  useSettingsSync();
  useScreenPreload();
  useToastSync();
  useModeSync(mode);
  const controls = useHoverSync();
  const keyboard = useKeyboardFocus(ref);
  const prepareExpand = usePrewarm(ref);
  useShellBus(controls, keyboard.release, modules, prepareExpand);
  useDockDrop(controls);

  // Hover source: Tauri → Rust cursor poller (no-op here); browser → mock pointerenter/pointerleave on this element.
  useEffect(() => registerHoverTarget(ref.current), []);
  usePointerLight(ref);

  // Sizes come from the design tokens; re-read when theme/vibrancy (which may override tokens) change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => readIslandGeometry(), [theme, vibrancy]);

  const compact = useActiveCompact(modules);
  const CompactView = compact?.compact?.View;
  const pillState: PillState = toast ? "toast" : CompactView ? "activity" : "idle";
  const pillBase: BoxSize = pillState === "toast" ? geo.pillToast : pillState === "activity" ? geo.pillActivity : geo.pill;
  const size: BoxSize = expanded ? geo.panel : hover ? hoveredPill(pillBase, geo.pillHoverGrow) : pillBase;
  // One crossfade layer per distinct pill content: a different activity module is a different layer.
  const pillKey = pillState === "activity" && compact ? `pill-activity-${compact.id}` : `pill-${pillState}`;

  // Which spring drives this change: expand / collapse when the mode flips, "pill" for hover growth and activity changes.
  // Derived during render (idempotent under StrictMode) so the very first frame already uses the right spring.
  const kindRef = useRef<TransitionKind>("pill");
  const prevRef = useRef({ mode, hover, pillKey });
  const prev = prevRef.current;
  if (prev.mode !== mode) kindRef.current = expanded ? "expand" : "collapse";
  else if (prev.hover !== hover || prev.pillKey !== pillKey) kindRef.current = "pill";
  prevRef.current = { mode, hover, pillKey };

  // Shape → Rust: a covering shape when a transition starts, the exact one when Motion reports it finished (no per-frame IPC).
  const settleShape = useShapeSync(ref, size, geo.top, overshoot(springs[kindRef.current]));

  const activeModule = modules.find((m) => m.id === activeTab) ?? modules[0];
  const ActiveTab = activeModule?.Tab;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return; // a module may claim Escape (e.g. clear its search) via preventDefault
    if (keyboard.isActive()) {
      // The keys came to us only because a field holds the keyboard: Escape hands it back and closes the island
      // (a second Escape would already go to the other window).
      keyboard.release();
      controls.collapseNow();
    } else if (settingsOpen) setView("tabs");
    else controls.collapseNow();
  };

  // Keyboard focus (Tab) expands the island. Focus from a mouse press must not: pressing a pill activity focuses its
  // button, the expansion would swap the pill out before the mouseup, and the click (→ openTab) would never happen.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && focusIsFromPointer(e.target)) return;
    controls.expandNow();
  };

  // Focus leaving it for the outside collapses it again — unless the cursor is
  // still over the island (then the hover machine owns the collapse, so the two never fight).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const dock=useDockStore.getState();
    if(dock.dragging||dock.interacting)return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    if (useIslandStore.getState().hoverInside) return;
    controls.collapseNow();
  };

  const bodyEnter = settingsOpen ? { opacity: 0, x: viewSlide.enter } : { opacity: 0, y: tabSlide.enter };
  const bodyExit = settingsOpen ? { opacity: 0, x: viewSlide.enter } : { opacity: 0, y: tabSlide.exit };

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={ref}
        className={expanded ? "ig-glass ig-island" : "ig-glass ig-glass--pill ig-island"}
        data-mode={mode}
        data-hover={hover}
        role="region"
        aria-label="Dynamic Island"
        tabIndex={0}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        initial={false}
        animate={{ width: size.width, height: size.height, borderRadius: size.radius }}
        transition={springs[kindRef.current]}
        onAnimationComplete={settleShape}
        // Centered in CSS (left/right 0 + auto margins), not with `x: -50%`: a transform promotes the island to its own
        // compositor layer, and resizing that layer made the GPU process block for 300–450 ms on the first frame.
        style={{ top: geo.top }}
      >
        <AnimatePresence initial={false} custom={kindRef.current === "pill"}>
          {expanded ? (
            <motion.div
              key="panel"
              className="ig-island-layer ig-island-layer--panel"
              initial={{ opacity: 0, scale: layerScale.panelEnter }}
              animate={{ opacity: 1, scale: 1, transition: fades.panelIn }}
              exit={{ opacity: 0, scale: layerScale.panelExit, transition: fades.panelOut }}
            >
              <div className="ig-panel">
                <header className="ig-panel-head">
                  <AnimatePresence mode="wait" initial={false}>
                    {settingsOpen ? (
                      <motion.div
                        key="settings-head"
                        className="ig-settings-head"
                        initial={{ opacity: 0, x: viewSlide.enter }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: viewSlide.enter }}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        <motion.button
                          type="button"
                          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
                          aria-label={t("back")}
                          title={t("backEsc")}
                          whileTap={{ scale: pressScale }}
                          transition={springs.press}
                          onClick={() => setView("tabs")}
                        >
                          <IconBack />
                        </motion.button>
                        <h2 className="ig-view-title">{t("settings")}</h2>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="tabs-head"
                        initial={{ opacity: 0, x: viewSlide.exit }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: viewSlide.exit }}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        <Tabs modules={modules} active={activeModule?.id ?? activeTab} onSelect={setActiveTab} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="ig-panel-head-right">
                    <HeadClock />
                    <motion.button
                      type="button"
                      className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
                      aria-label={t("settings")}
                      title={t("settings")}
                      aria-pressed={settingsOpen}
                      whileTap={{ scale: pressScale }}
                      transition={springs.press}
                      onClick={() => setView(settingsOpen ? "tabs" : "settings")}
                    >
                      <IconSettings />
                    </motion.button>
                    <motion.button
                      type="button"
                      className="ig-glass-control ig-glass-control--icon"
                      aria-label={t("collapse")}
                      title={t("collapseEsc")}
                      whileTap={{ scale: pressScale }}
                      transition={springs.press}
                      onClick={controls.collapseNow}
                    >
                      <IconCollapse />
                    </motion.button>
                  </div>
                </header>
                <div
                  className="ig-panel-body"
                  role={settingsOpen ? "region" : "tabpanel"}
                  aria-label={settingsOpen ? t("settings") : undefined}
                  id={!settingsOpen && activeModule ? tabPanelId(activeModule.id) : undefined}
                  aria-labelledby={!settingsOpen && activeModule ? tabId(activeModule.id) : undefined}
                  tabIndex={settingsOpen ? undefined : 0}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {settingsOpen ? (
                      <motion.div
                        key="settings"
                        style={{ height: "100%" }}
                        initial={bodyEnter}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        exit={bodyExit}
                        transition={{ ...springs.view, opacity: fades.pillSwap }}
                      >
                        <Suspense fallback={<ScreenFallback />}>
                          <SettingsView />
                        </Suspense>
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
          ) : (
            <motion.div
              key={pillKey}
              className="ig-island-layer"
              custom={kindRef.current === "pill"}
              variants={pillLayer}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              {pillState === "toast" && toast ? (
                <PillToast {...toast} />
              ) : CompactView ? (
                <CompactView />
              ) : (
                <PillIdle />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </MotionConfig>
  );
}
