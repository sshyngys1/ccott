import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { t, useT } from "../../i18n";
import {
  IconCheck,
  IconClose,
  IconPlus,
  IconReset,
  IconSettings,
  IconSwap,
} from "../../design/icons";
import { durations, easings, pressScale, springs } from "../../design/motion";
import { useCaptureStore } from "../../lib/capture/store";
import { useFeatureEnabled } from "../../lib/features";
import {
  addTile,
  canExpandTo2x1,
  countCells,
  filterEnabledTiles,
  getHiddenTiles,
  normalizeLayout,
  needsTallPanel,
  removeTile,
  reorderTiles,
  toggleTileSize,
} from "../../lib/tiles/layout";
import { getTileDefinition } from "../../lib/tiles/registry";
import { useTilesEditStore } from "../../lib/tiles/store";
import { patchSettings } from "../../shell/settings/patchSettings";
import { DEFAULT_QUICK_TILES, QUICK_TILE_CELLS, QUICK_TILE_ROW_CELLS_3 } from "../../shared/types";
import { useIslandStore } from "../../store";
import { Dock } from "./Dock";
import { DockMenu } from "./DockMenu";
import { PlayerCard } from "./PlayerCard";
import { VolumeCard } from "./VolumeCard";
import "../../lib/ui.css";
import "./home.css";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function HomeTab() {
  useT();
  const rawTiles = useIslandStore((s) => s.settings.quickTiles);
  const disabledFeatures = useIslandStore((s) => s.settings.disabledFeatures);
  const dockEnabled = useFeatureEnabled("dock");
  const allTiles = useMemo(() => normalizeLayout(rawTiles), [rawTiles]);
  const tiles = useMemo(() => filterEnabledTiles(allTiles, disabledFeatures), [allTiles, disabledFeatures]);
  const busy = useCaptureStore((s) => s.busy);
  const { editing, setEditing } = useTilesEditStore();
  const mode = useIslandStore((s) => s.mode);
  const liteMode = useIslandStore((s) => s.settings.liteMode);
  const withTools = editing || tiles.length > 0;
  const reduce = useReducedMotion();
  const animateLayout = mode === "expanded" && !liteMode && !reduce;

  const [menu, setMenu] = useState<"context" | "add" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const [movingId, setMovingId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const homeRoot = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    target: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  // Exit edit mode on island collapse
  useEffect(() => {
    if (mode === "collapsed") {
      setEditing(false);
      setMenu(null);
    }
  }, [mode, setEditing]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        if (editing) {
          event.preventDefault();
          event.stopPropagation();
          setEditing(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [editing, menu, setEditing]);

  const finishDrag = (cancel = false) => {
    const drag = gesture.current;
    if (!drag) return;
    gesture.current = null;
    setMovingId(null);
    setTargetId(null);
    if (drag.moved) {
      suppressClick.current = true;
      if (!cancel && drag.id !== drag.target) {
        const next = reorderTiles(allTiles, drag.id, drag.target);
        void patchSettings({ quickTiles: next });
      }
    }
  };

  const hiddenTiles = useMemo(() => getHiddenTiles(allTiles, disabledFeatures), [allTiles, disabledFeatures]);
  const visibleCells = countCells(tiles);
  const totalCells = countCells(allTiles);
  const canAdd = totalCells < QUICK_TILE_CELLS && hiddenTiles.length > 0;
  // At six cells the panel remains ordinary. Keep + in the footer until adding cell seven.
  const addInFooter = visibleCells === QUICK_TILE_ROW_CELLS_3;

  const tileMotion = {
    initial: { opacity: 0, y: reduce ? 0 : 2 },
    animate: { opacity: 1, y: reduce ? 0 : editing ? -2 : 0 },
    exit: { opacity: 0 },
    transition: { layout: springs.list, duration: durations.med, ease: easings.out },
  };

  return (
    <div
      ref={homeRoot}
      className={`hm-home${withTools ? " hm-home--with-tools" : ""}`}
      data-tall={needsTallPanel(allTiles, disabledFeatures)}
      data-dock={dockEnabled}
    >
      <h2 className="mod-sr-only">{t("home")}</h2>
      <div
        className="hm-left"
        onContextMenu={(event) => {
          if (withTools) return;
          event.preventDefault();
          setAnchor(event.currentTarget);
          setMenu("context");
        }}
      >
        <PlayerCard />
        <VolumeCard />
      </div>
      {withTools && <section
        ref={root}
        className="hm-tools-wrap"
        aria-label={t("quickTools")}
        onContextMenu={(event) => {
          if (editing) return;
          event.preventDefault();
          setAnchor(event.currentTarget);
          setMenu("context");
        }}
      >
        <div className="hm-tools" data-rows={visibleCells > QUICK_TILE_ROW_CELLS_3 ? 4 : 3}>
          <AnimatePresence mode="popLayout" initial={false}>
          {/* Keep hit-test cells stable during drag; only the committed order moves on pointerup. */}
          {tiles.map((slot) => {
              const def = getTileDefinition(slot.id);
              if (!def) return null;
              const Icon = def.icon;
              const title = t(def.titleKey);
              const hint = def.hintKey ? t(def.hintKey) : title;
              const canExpand = canExpandTo2x1(allTiles, slot.id);

              if (editing) {
                return (
                  <motion.div
                    key={slot.id}
                    {...tileMotion}
                    layout={animateLayout ? "position" : false}
                    layoutDependency={tiles}
                    data-editing="true"
                    data-tile-id={slot.id}
                    data-size={slot.size}
                    data-reordering={movingId === slot.id}
                    data-drop-target={targetId === slot.id && movingId !== slot.id}
                    className="hm-tile-entry"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      gesture.current = {
                        id: slot.id,
                        target: slot.id,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                      };
                      suppressClick.current = false;
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const drag = gesture.current;
                      if (!drag) return;
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
                        ?.closest<HTMLElement>("[data-tile-id]");
                      if (targetEl && root.current?.contains(targetEl)) {
                        const newTarget = targetEl.dataset.tileId ?? drag.id;
                        drag.target = newTarget;
                        setTargetId(newTarget);
                      }
                    }}
                    onPointerUp={() => finishDrag()}
                    onPointerCancel={() => finishDrag(true)}
                  >
                    <div className="ig-glass-control ig-glass-control--tile hm-tile">
                      <Icon />
                      <span>{title}</span>
                    </div>
                    <button
                      type="button"
                      className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost hm-tile-remove"
                      title={t("tiles.removeNamed", { name: title })}
                      aria-label={t("tiles.removeNamed", { name: title })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void patchSettings({ quickTiles: removeTile(allTiles, slot.id) });
                      }}
                    >
                      <IconClose size={12} />
                    </button>
                    <button
                      type="button"
                      className="ig-glass-control hm-tile-size"
                      title={slot.size === "1x1" ? t("tiles.expand") : t("tiles.shrink")}
                      aria-label={slot.size === "1x1" ? t("tiles.expand") : t("tiles.shrink")}
                      disabled={slot.size === "1x1" && !canExpand}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void patchSettings({ quickTiles: toggleTileSize(allTiles, slot.id) });
                      }}
                    >
                      <IconSwap size={10} />
                      <span>{slot.size === "1x1" ? "2×1" : "1×1"}</span>
                    </button>
                  </motion.div>
                );
              }

              return (
                <motion.button
                  key={slot.id}
                  {...tileMotion}
                  type="button"
                  data-size={slot.size}
                  className="ig-glass-control ig-glass-control--tile hm-tile"
                  {...tap}
                  title={hint}
                  disabled={busy}
                  onClick={(event) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    void def.action(event);
                  }}
                >
                  <Icon />
                  <span>{title}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>

          {editing && canAdd && !addInFooter && (
            <div className="hm-tile-entry hm-tile-entry--add">
              <button
                type="button"
                className="ig-glass-control ig-glass-control--tile hm-tile hm-tile-add"
                title={t("tiles.add")}
                aria-label={t("tiles.add")}
                aria-haspopup="menu"
                aria-expanded={menu === "add"}
                onClick={(e) => {
                  setAnchor(e.currentTarget);
                  setMenu(menu === "add" ? null : "add");
                }}
              >
                <IconPlus size={20} />
              </button>
            </div>
          )}
        </div>

        {editing && (
          <div className="hm-tools-footer">
            {canAdd && addInFooter && (
              <button
                type="button"
                className="ig-glass-control ig-glass-control--sm"
                aria-label={t("tiles.add")}
                title={t("tiles.add")}
                aria-haspopup="menu"
                aria-expanded={menu === "add"}
                onClick={(e) => {
                  setAnchor(e.currentTarget);
                  setMenu(menu === "add" ? null : "add");
                }}
              >
                <IconPlus size={16} />
              </button>
            )}
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost"
              onClick={() =>
                void patchSettings({ quickTiles: DEFAULT_QUICK_TILES.map((t) => ({ ...t })) })
              }
            >
              <IconReset size={14} />
              <span>{t("reset")}</span>
            </button>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm ig-glass-control--accent"
              onClick={() => setEditing(false)}
            >
              <IconCheck size={14} />
              <span>{t("done")}</span>
            </button>
          </div>
        )}
      </section>}

      {menu && anchor && homeRoot.current && (
        <DockMenu
          anchor={anchor}
          container={homeRoot.current}
          close={closeMenu}
          items={
            menu === "context"
              ? [
                  {
                    id: "customize",
                    label: t("tiles.customizeAction"),
                    icon: <IconSettings size={16} />,
                    select: () => {
                      setEditing(true);
                    },
                  },
                ]
              : hiddenTiles.map((hiddenId) => {
                  const def = getTileDefinition(hiddenId)!;
                  const Icon = def.icon;
                  return {
                    id: hiddenId,
                    label: t(def.titleKey),
                    icon: <Icon size={16} />,
                    select: () => {
                      void patchSettings({ quickTiles: addTile(allTiles, hiddenId) });
                    },
                  };
                })
          }
        />
      )}

      {dockEnabled && <Dock />}
    </div>
  );
}
