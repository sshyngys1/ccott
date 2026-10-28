import { useCallback, useEffect, useRef, useState } from "react";
import { t, useT } from "../../i18n";
import { IconClose, IconFile, IconFolder, IconPlus, IconTrash } from "../../design/icons";
import { DockMenu } from "./DockMenu";
import {
  chooseDockItems,
  dragDockItem,
  initDock,
  movedIds,
  openDockItem,
  removeDockItem,
  reorderDock,
  useDockStore,
} from "../../lib/dock/store";

export function Dock() {
  useT();
  const { items, dragging } = useDockStore();
  const [menu, setMenu] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [moving, setMoving] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    target: string;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    void initDock();
    return () => useDockStore.setState({ interacting: false });
  }, []);
  const finish = (cancel = false) => {
    const drag = gesture.current;
    if (!drag)
      return;
    gesture.current = null;
    setMoving(null);
    setTargetId(null);
    useDockStore.setState({ interacting: false });
    if (drag?.moved) {
      suppressClick.current = true;
      if (!cancel)
        void reorderDock(movedIds(useDockStore.getState().items, drag.id, drag.target));
    }
  };
  return <section
    ref={root}
    className="hm-dock ig-glass-card"
    aria-label={t("dock.title")}
    data-dragging={dragging}
    onKeyDown={event => {
      if (event.key === "Escape") {
        setMenu(null);
        finish(true);
      }
    }}
  >
    {!items.length && <span className="hm-dock-hint">{t("dock.empty")}</span>}
    {items.map((item, index) => <div
      className="hm-dock-entry"
      data-dock-id={item.id}
      data-reordering={moving === item.id}
      data-drop-target={targetId === item.id && moving !== item.id}
      key={item.id}
    >
      <button
        type="button"
        className="ig-glass-control ig-glass-control--icon ig-glass-control--lg hm-dock-app"
        title={item.name}
        aria-label={item.name}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          void openDockItem(item.id);
        }}
        onContextMenu={event => {
          event.preventDefault();
          setAnchor(event.currentTarget);
          setMenu(menu === item.id ? null : item.id);
        }}
        onPointerDown={event => {
          if (event.button !== 0)
            return;
          gesture.current = { id: item.id, target: item.id, x: event.clientX, y: event.clientY, moved: false };
          suppressClick.current = false;
          useDockStore.setState({ interacting: true });
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={event => {
          const dragGesture = gesture.current;
          if (!dragGesture)
            return;
          if (Math.hypot(event.clientX - dragGesture.x, event.clientY - dragGesture.y) < 6 && !dragGesture.moved)
            return;
          dragGesture.moved = true;
          const panel = root.current?.closest(".ig-island");
          const bounds = panel?.getBoundingClientRect();
          if (bounds && (
            event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom
          )) {
            gesture.current = null;
            suppressClick.current = true;
            setMoving(null);
            setTargetId(null);
            if (event.currentTarget.hasPointerCapture?.(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            void dragDockItem(dragGesture.id);
            return;
          }
          setMoving(dragGesture.id);
          const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dock-id]");
          if (target && root.current?.contains(target)) {
            dragGesture.target = target.dataset.dockId ?? dragGesture.id;
            setTargetId(dragGesture.target);
          }
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onKeyDown={event => {
          if (event.key === "Delete") {
            event.preventDefault();
            void removeDockItem(item.id);
          }
          else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const next = items[(index + (event.key === "ArrowLeft" ? -1 : 1) + items.length) % items.length];
            if (event.altKey)
              void reorderDock(movedIds(items, item.id, next.id));
            else
              root.current?.querySelector<HTMLButtonElement>(`[data-dock-id="${CSS.escape(next.id)}"] > button`)?.focus();
          }
        }}
      >
        {item.icon ? <img
          src={item.icon}
          alt=""
          draggable={false}
        /> : <IconFile />}
      </button>
      <button
        type="button"
        className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost hm-dock-remove"
        title={t("dock.removeNamed", { name: item.name })}
        aria-label={t("dock.remove")}
        onClick={() => {
          setMenu(null);
          void removeDockItem(item.id);
        }}
      >
        <IconClose size={12} />
      </button>
    </div>)}
    <div className="hm-dock-entry hm-dock-add-wrap">
      <button
        type="button"
        className="ig-glass-control ig-glass-control--icon ig-glass-control--lg ig-glass-control--ghost hm-dock-add"
        title={t("dock.add")}
        aria-label={t("dock.add")}
        aria-haspopup="menu"
        aria-expanded={menu === "add"}
        disabled={items.length >= 12}
        onClick={event => {
          setAnchor(event.currentTarget);
          setMenu(menu === "add" ? null : "add");
        }}
      >
        <IconPlus />
      </button>
    </div>
    {dragging && <span className="hm-dock-drop-label">{t("dock.drop")}</span>}
    {menu && anchor && root.current && <DockMenu
      anchor={anchor}
      container={root.current.closest<HTMLElement>(".hm-home") ?? root.current}
      close={closeMenu}
      items={menu === "add" ? [
        {
          id: "file",
          label: t("dock.pickFile"),
          icon: <IconFile size={16} />,
          select: () => {
            void chooseDockItems(false);
          }
        },
        {
          id: "folder",
          label: t("dock.pickFolder"),
          icon: <IconFolder size={16} />,
          select: () => {
            void chooseDockItems(true);
          }
        },
      ] : [{
        id: "remove",
        label: t("dock.remove"),
        icon: <IconTrash size={16} />,
        select: () => {
          void removeDockItem(menu);
        }
      }]}
    />}
  </section>;
}
