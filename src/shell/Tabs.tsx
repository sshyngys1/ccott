import { t, useT } from "../i18n";
// Owner: F1. Tab strip of the expanded panel: Designer's .ig-tabbar/.ig-tab/.ig-tab-thumb + WAI-ARIA tabs + edit mode (§23).
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  IconCheck,
  IconClose,
  IconPlus,
  IconReset,
  IconSettings,
} from "../design/icons";
import { durations, easings, springs } from "../design/motion";
import {
  disableFeatureList,
  enableFeatureList,
  MODULE_FEATURE,
} from "../lib/features";
import { DockMenu } from "../modules/home/DockMenu";
import type { IslandModule, ModuleId } from "../shared/types";
import { useIslandStore } from "../store";
import { patchSettings } from "./settings/patchSettings";
import {
  getDisabledTabModules,
  reorderTabOrder,
  resetTabsPatch,
} from "./tabs/order";
import { useTabsEditStore } from "./tabs/store";

export const tabId = (id: ModuleId) => `ig-tab-${id}`;
export const tabPanelId = (id: ModuleId) => `ig-tabpanel-${id}`;

interface TabsProps {
  modules: readonly IslandModule[];
  allModules?: readonly IslandModule[];
  active: ModuleId;
  onSelect: (id: ModuleId) => void;
}

export function Tabs({ modules, allModules, active, onSelect }: TabsProps) {
  useT();
  const registeredModules = allModules ?? modules;
  const refs = useRef(new Map<ModuleId, HTMLButtonElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const tabbarRef = useRef<HTMLElement>(null);
  const [iconsOnly, setIconsOnly] = useState(modules.length >= 6);

  const { editing, setEditing, setMenuOpen } = useTabsEditStore();
  const mode = useIslandStore((s) => s.mode);
  const view = useIslandStore((s) => s.view);
  const liteMode = useIslandStore((s) => s.settings.liteMode);
  const tabOrder = useIslandStore((s) => s.settings.tabOrder);
  const disabledFeatures = useIslandStore((s) => s.settings.disabledFeatures);
  const reduce = useReducedMotion();
  const animateLayout = mode === "expanded" && !liteMode && !reduce;

  const [menu, setMenu] = useState<"context" | "add" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const [movingId, setMovingId] = useState<ModuleId | null>(null);
  const [targetId, setTargetId] = useState<ModuleId | null>(null);
  const gesture = useRef<{
    id: ModuleId;
    target: ModuleId;
    x: number;
    y: number;
    moved: boolean;
    pointerId: number;
    captureEl: HTMLElement | null;
  } | null>(null);
  const suppressClick = useRef(false);

  // Measure the full-label strip independently of the displayed mode, avoiding resize oscillation.
  const titles = modules.map(module => module.title).join("\n");
  useLayoutEffect(() => {
    const root = rootRef.current;
    const nav = tabbarRef.current;
    if (!root || !nav) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const available = (editing ? nav.parentElement : root)?.clientWidth ?? 0;
      if (!available) { setIconsOnly(modules.length >= 6); return; }
      const copy = nav.cloneNode(true) as HTMLElement;
      copy.dataset.measuring = "true";
      copy.removeAttribute("role");
      copy.setAttribute("aria-hidden", "true");
      copy.inert = true;
      Object.assign(copy.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", width: "max-content", maxWidth: "none" });
      copy.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
      copy.querySelectorAll<HTMLElement>(".ig-tab-label").forEach(element => { element.style.display = "inline"; });
      root.append(copy);
      const needed = copy.getBoundingClientRect().width;
      copy.remove();
      const addWidth = editing ? root.querySelector<HTMLElement>(".ig-tab-add")?.offsetWidth ?? 0 : 0;
      const addGap = addWidth && nav.parentElement ? parseFloat(getComputedStyle(nav.parentElement).columnGap) || 0 : 0;
      setIconsOnly(needed > available - addWidth - addGap);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [titles, editing, modules.length, disabledFeatures]);

  const releasePointer = useCallback(
    (drag: { pointerId: number; captureEl: HTMLElement | null } | null) => {
      if (!drag?.captureEl) return;
      try {
        if (drag.captureEl.hasPointerCapture?.(drag.pointerId) ?? true) {
          drag.captureEl.releasePointerCapture?.(drag.pointerId);
        }
      } catch {
        // Ignore if pointer capture was already released or synthetic.
      }
    },
    [],
  );

  const cancelDrag = useCallback(() => {
    const drag = gesture.current;
    gesture.current = null;
    suppressClick.current = false;
    setMovingId(null);
    setTargetId(null);
    releasePointer(drag);
  }, [releasePointer]);

  const exitEditing = useCallback(() => {
    cancelDrag();
    setMenu(null);
    if (
      document.activeElement instanceof HTMLElement &&
      rootRef.current?.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    setEditing(false);
  }, [cancelDrag, setEditing]);

  const disabledTabModules = useMemo(
    () => getDisabledTabModules(registeredModules, tabOrder, disabledFeatures),
    [registeredModules, tabOrder, disabledFeatures],
  );

  useEffect(() => {
    setMenuOpen(menu !== null);
    return () => setMenuOpen(false);
  }, [menu, setMenuOpen]);

  useEffect(() => {
    if (!editing) {
      cancelDrag();
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (!useTabsEditStore.getState().editing) return;
      (refs.current.get(active) ?? refs.current.get("home"))?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // Only focus when entering edit mode, not on every active tab switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, cancelDrag]);

  useEffect(() => () => cancelDrag(), [cancelDrag]);

  useEffect(() => {
    if (mode === "collapsed" || view !== "tabs") {
      cancelDrag();
      setMenu(null);
      if (editing) exitEditing();
      else setEditing(false);
    }
  }, [mode, view, editing, cancelDrag, exitEditing, setEditing]);

  useEffect(() => {
    if (!editing && !menu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelDrag();
      if (menu) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        anchor?.focus?.();
        return;
      }
      if (editing) {
        event.preventDefault();
        event.stopPropagation();
        exitEditing();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [editing, menu, anchor, cancelDrag, exitEditing]);

  const finishDrag = () => {
    const drag = gesture.current;
    if (!drag || !editing) return;
    gesture.current = null;
    setMovingId(null);
    setTargetId(null);
    releasePointer(drag);
    if (drag.moved) {
      suppressClick.current = true;
      if (drag.id !== drag.target) {
        const nextOrder = reorderTabOrder(registeredModules, tabOrder, drag.id, drag.target);
        void patchSettings({ tabOrder: nextOrder });
      }
    }
  };

  const hideTab = (id: ModuleId) => {
    const feature = MODULE_FEATURE[id];
    if (!feature) return;
    cancelDrag();
    setMenu(null);
    void patchSettings({ disabledFeatures: disableFeatureList(disabledFeatures, feature) });
    if (active === id) {
      onSelect("home");
    }
    requestAnimationFrame(() => {
      refs.current.get("home")?.focus();
    });
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (editing || registeredModules.length <= 1) return;
    event.preventDefault();
    setAnchor(event.currentTarget);
    setMenuPoint({ x: event.clientX, y: event.clientY });
    setMenu("context");
  };

  const navigateTabs = (e: ReactKeyboardEvent<HTMLElement>, fromIndex: number) => {
    if (modules.length === 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (fromIndex + 1) % modules.length;
    else if (e.key === "ArrowLeft") next = (fromIndex - 1 + modules.length) % modules.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = modules.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = modules[next];
    onSelect(target.id);
    refs.current.get(target.id)?.focus();
  };

  const onNormalKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const index = modules.findIndex((m) => m.id === active);
    navigateTabs(e, index < 0 ? 0 : index);
  };

  const portalContainer = rootRef.current?.closest<HTMLElement>(".ig-panel") ?? rootRef.current;

  const menuOverlay =
    menu && anchor && portalContainer ? (
      <DockMenu
        anchor={anchor}
        container={portalContainer}
        className="ig-tabs-menu"
        placement="below"
        point={menu === "context" ? menuPoint : null}
        close={closeMenu}
        items={
          menu === "context"
            ? [
                {
                  id: "customize-tabs",
                  label: t("tabs.customizeAction"),
                  icon: <IconSettings size={16} />,
                  select: () => {
                    setEditing(true);
                  },
                },
              ]
            : disabledTabModules.map((mod) => {
                const Icon = mod.icon;
                const feature = MODULE_FEATURE[mod.id]!;
                return {
                  id: mod.id,
                  label: mod.title,
                  icon: <Icon size={16} />,
                  select: () => {
                    void patchSettings({
                      disabledFeatures: enableFeatureList(disabledFeatures, feature),
                    });
                  },
                };
              })
        }
      />
    ) : null;

  if (!editing) {
    if (modules.length <= 1) {
      return (
        <div ref={rootRef} className="ig-tabs-root ig-tabs-root--single">
          <div className="ig-tabbar-slot" onContextMenu={openContextMenu} />
          {menuOverlay}
        </div>
      );
    }

    return (
      <div ref={rootRef} className="ig-tabs-root" data-icons-only={iconsOnly || undefined}>
        <LayoutGroup id="ig-shell-tabs">
          <nav
            ref={tabbarRef}
            className="ig-tabbar"
            role="tablist"
            aria-label={t("islandTabs")}
            onKeyDown={onNormalKeyDown}
            onContextMenu={openContextMenu}
          >
            {modules.map((m) => {
              const selected = m.id === active;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  ref={(el) => {
                    if (el) refs.current.set(m.id, el);
                    else refs.current.delete(m.id);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(m.id)}
                  className="ig-tab"
                  aria-selected={selected}
                  // The panel only exists for the active tab (see Island.tsx), so only that tab may point at it.
                  aria-controls={selected ? tabPanelId(m.id) : undefined}
                  aria-label={m.title}
                  title={m.title}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(m.id)}
                >
                  {selected && (
                    <motion.span
                      layoutId="ig-shell-tab-thumb"
                      className="ig-tab-thumb"
                      transition={springs.tab}
                    />
                  )}
                  <Icon size={16} />
                  <span className="ig-tab-label">{m.title}</span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>
        {menuOverlay}
      </div>
    );
  }

  const tabMotion = {
    initial: { opacity: 0, y: reduce ? 0 : 2 },
    animate: { opacity: 1, y: reduce ? 0 : -1 },
    exit: { opacity: 0 },
    transition: { layout: springs.list, duration: durations.med, ease: easings.out },
  };

  return (
    <div ref={rootRef} className="ig-tabs-root" data-editing="true" data-icons-only={iconsOnly || undefined}>
      <div className="ig-tabs-edit-left">
        <nav
          ref={tabbarRef}
          className="ig-tabbar"
          data-editing="true"
          role="tablist"
          aria-label={t("islandTabs")}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {/* Keep hit-test tab entries stable during drag; only commit order on pointerup. */}
            {modules.map((m, index) => {
              const selected = m.id === active;
              const Icon = m.icon;
              const removable = m.id !== "home" && Boolean(MODULE_FEATURE[m.id]);
              return (
                <motion.div
                  key={m.id}
                  {...tabMotion}
                  layout={animateLayout ? "position" : false}
                  layoutDependency={modules}
                  data-editing="true"
                  data-removable={removable || undefined}
                  data-tab-id={m.id}
                  data-reordering={movingId === m.id}
                  data-drop-target={targetId === m.id && movingId !== m.id}
                  className="ig-tab-entry"
                >
                  <button
                    ref={(el) => {
                      if (el) refs.current.set(m.id, el);
                      else refs.current.delete(m.id);
                    }}
                    type="button"
                    role="tab"
                    id={tabId(m.id)}
                    data-island-keyboard="true"
                    className="ig-tab"
                    aria-selected={selected}
                    aria-controls={selected ? tabPanelId(m.id) : undefined}
                    aria-label={m.title}
                    title={m.title}
                    tabIndex={selected ? 0 : -1}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const captureEl = event.currentTarget;
                      try {
                        captureEl.setPointerCapture?.(event.pointerId);
                      } catch {
                        // Ignore if pointer capture is unsupported for synthetic events.
                      }
                      gesture.current = {
                        id: m.id,
                        target: m.id,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                        pointerId: event.pointerId,
                        captureEl,
                      };
                      suppressClick.current = false;
                    }}
                    onPointerMove={(event) => {
                      const drag = gesture.current;
                      if (
                        !drag ||
                        !editing ||
                        (event.pointerId !== undefined &&
                          drag.pointerId !== undefined &&
                          event.pointerId !== drag.pointerId)
                      ) {
                        return;
                      }
                      if (
                        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6 &&
                        !drag.moved
                      ) {
                        return;
                      }
                      drag.moved = true;
                      setMovingId(drag.id);
                      const targetEl = document
                        .elementFromPoint?.(event.clientX, event.clientY)
                        ?.closest<HTMLElement>("[data-tab-id]");
                      if (targetEl && tabbarRef.current?.contains(targetEl)) {
                        const nextTarget =
                          (targetEl.dataset.tabId as ModuleId | undefined) ?? drag.id;
                        drag.target = nextTarget;
                        setTargetId(nextTarget);
                      }
                    }}
                    onPointerUp={(event) => {
                      const drag = gesture.current;
                      if (
                        !drag ||
                        (event.pointerId !== undefined &&
                          drag.pointerId !== undefined &&
                          event.pointerId !== drag.pointerId)
                      ) {
                        return;
                      }
                      finishDrag();
                    }}
                    onPointerCancel={() => cancelDrag()}
                    onLostPointerCapture={() => {
                      if (gesture.current) cancelDrag();
                    }}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      onSelect(m.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        suppressClick.current = false;
                      }
                      if (
                        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
                        e.altKey &&
                        modules.length > 1
                      ) {
                        e.preventDefault();
                        const nextIdx =
                          (index + (e.key === "ArrowLeft" ? -1 : 1) + modules.length) %
                          modules.length;
                        const nextOrder = reorderTabOrder(
                          registeredModules,
                          tabOrder,
                          m.id,
                          modules[nextIdx].id,
                        );
                        void patchSettings({ tabOrder: nextOrder });
                        return;
                      }
                      if (e.key === "Delete" && removable) {
                        e.preventDefault();
                        hideTab(m.id);
                        return;
                      }
                      navigateTabs(e, index);
                    }}
                  >
                    {selected && <span className="ig-tab-thumb" />}
                    <Icon size={16} />
                    <span className="ig-tab-label">{m.title}</span>
                  </button>
                  {removable && (
                    <button
                      type="button"
                      data-island-keyboard="true"
                      className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-tab-remove"
                      title={t("tabs.hideNamed", { name: m.title })}
                      aria-label={t("tabs.hideNamed", { name: m.title })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        hideTab(m.id);
                      }}
                    >
                      <IconClose size={10} />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </nav>

        {disabledTabModules.length > 0 && (
          <button
            type="button"
            data-island-keyboard="true"
            className="ig-glass-control ig-glass-control--icon ig-glass-control--sm ig-glass-control--ghost ig-tab-add"
            title={t("tabs.add")}
            aria-label={t("tabs.add")}
            aria-haspopup="menu"
            aria-expanded={menu === "add"}
            onClick={(e) => {
              setAnchor(e.currentTarget);
              setMenuPoint(null);
              setMenu(menu === "add" ? null : "add");
            }}
          >
            <IconPlus size={14} />
          </button>
        )}
      </div>

      <div className="ig-tabs-edit-actions">
        <button
          type="button"
          className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost"
          onClick={() => {
            cancelDrag();
            void patchSettings(resetTabsPatch(disabledFeatures));
          }}
        >
          <IconReset size={14} />
          <span>{t("reset")}</span>
        </button>
        <button
          type="button"
          className="ig-glass-control ig-glass-control--sm ig-glass-control--accent"
          onClick={exitEditing}
        >
          <IconCheck size={14} />
          <span>{t("done")}</span>
        </button>
      </div>

      {menuOverlay}
    </div>
  );
}
