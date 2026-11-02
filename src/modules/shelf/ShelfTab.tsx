import { useCallback, useEffect, useRef, useState } from "react";
import { IconFile, IconFolder, IconTrash } from "../../design/icons";
import { useT } from "../../i18n";
import { useDockStore } from "../../lib/dock/store";
import { formatBytes } from "../../lib/downloads/format";
import { selectShelfItem } from "./selection";
import { clearShelf, dragShelfItems, openShelfItem, refreshShelf, removeShelfItems, useShelfStore } from "./store";
import "./shelf.css";

export function ShelfTab() {
  const t = useT();
  const { items, dropTarget } = useShelfStore();
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const gesture = useRef<{ x: number; y: number; id: string; ids: string[]; pointer: number; target: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenu(null); useDockStore.setState({ interacting: false });
    if (restoreFocus) menuAnchor.current?.focus();
  }, []);
  useEffect(() => {
    void refreshShelf();
    const refresh = () => { void refreshShelf(); };
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); useDockStore.setState({ interacting: false }); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) closeMenu(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu, closeMenu]);
  useEffect(() => {
    if (menu && !items.some(item => item.id === menu)) closeMenu();
  }, [items, menu, closeMenu]);
  const visibleSelection = selected.filter(id => items.some(i => i.id === id));
  const finish = () => { gesture.current = null; useDockStore.setState({ interacting: false }); };
  const menuItem = items.find(i => i.id === menu);
  const selectedIds = (id: string, ctrl: boolean, shift: boolean) => selectShelfItem(items.map(i => i.id), visibleSelection, id, anchor.current, ctrl, shift);
  return <section className="shelf" data-shelf-drop="true" data-dragging={dropTarget === "shelf"} aria-label={t("shelf.title")}
    onKeyDown={event => {
      if (event.key === "Escape" && (menu || visibleSelection.length)) {
        event.preventDefault(); closeMenu(!!menu); setSelected([]); finish();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(items.map(i => i.id)); }
      if (event.key === "Delete" && !menu) { event.preventDefault(); void removeShelfItems(visibleSelection); }
    }}>
    <div className="shelf-toolbar">
      <span className="ig-section-label">{t("shelf.count", { count: items.length })}</span>
      <button data-island-keyboard="true" className="ig-glass-control ig-glass-control--sm" disabled={!items.length} onClick={() => { closeMenu(); void clearShelf(); }}>
        <IconTrash size={16} />{t("shelf.clear")}
      </button>
    </div>
    {!items.length ? <div className="ig-empty shelf-empty">{t("shelf.empty")}</div> :
      <div className="shelf-grid ig-glass-card ig-scroll" role="listbox" aria-label={t("shelf.title")} aria-multiselectable="true">
        {items.map(item => <button type="button" key={item.id} role="option" data-island-keyboard="true" aria-selected={visibleSelection.includes(item.id)}
          className="shelf-item ig-glass-control" data-missing={item.missing} title={item.missing ? t("shelf.missing") : item.name}
          onClick={event => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            setSelected(selectedIds(item.id, event.ctrlKey || event.metaKey, event.shiftKey));
            if (!event.shiftKey) anchor.current = item.id;
          }}
          onDoubleClick={() => { if (!item.missing) void openShelfItem(item.id, "open"); }}
          onContextMenu={event => {
            event.preventDefault(); finish();
            if (!visibleSelection.includes(item.id)) { setSelected([item.id]); anchor.current = item.id; }
            menuAnchor.current = event.currentTarget;
            setMenu(item.id); useDockStore.setState({ interacting: true });
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            suppressClick.current = false;
            const ids = visibleSelection.includes(item.id) && !event.ctrlKey && !event.shiftKey ? visibleSelection : selectedIds(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
            gesture.current = { x: event.clientX, y: event.clientY, id: item.id, ids, pointer: event.pointerId, target: event.currentTarget };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            useDockStore.setState({ interacting: true });
          }}
          onPointerMove={event => {
            const start = gesture.current;
            if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
            gesture.current = null; suppressClick.current = true;
            if (start.target.hasPointerCapture?.(start.pointer)) start.target.releasePointerCapture(start.pointer);
            setSelected(start.ids);
            const ids = start.ids.filter(id => items.some(i => i.id === id && !i.missing));
            if (item.missing || !ids.length) { finish(); return; }
            void dragShelfItems(ids);
          }}
          onPointerUp={() => { if (gesture.current) finish(); }} onPointerCancel={() => { if (gesture.current) finish(); }}
          onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const grid = event.currentTarget.parentElement!;
              const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[role="option"]'));
              const index = buttons.indexOf(event.currentTarget);
              const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
              const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step));
              buttons[next]?.focus();
              setSelected(selectedIds(items[next].id, event.ctrlKey || event.metaKey, event.shiftKey));
              if (!event.shiftKey) anchor.current = items[next].id;
            }
            if (event.key === "Enter" && !item.missing) { event.preventDefault(); void openShelfItem(item.id, "open"); }
            if (event.key === " " ) { event.preventDefault(); setSelected(selectedIds(item.id, event.ctrlKey, event.shiftKey)); anchor.current = item.id; }
          }}>
          <span className="shelf-icon" aria-hidden="true">{item.icon ? <img src={item.icon} alt="" draggable={false} /> : item.kind === "folder" ? <IconFolder size={32} /> : <IconFile size={32} />}</span>
          <span className="shelf-name">{item.name}</span>
          <span className="shelf-meta">{item.missing ? t("shelf.missing") : item.kind === "folder" ? t("shelf.folder") : item.size === null ? t("shelf.unknownSize") : formatBytes(item.size)}</span>
        </button>)}
      </div>}
    {dropTarget === "shelf" && <div className="shelf-drop-label" role="status">{t("shelf.drop")}</div>}
    {menuItem && <div ref={menuRef} role="menu" className="shelf-menu ig-glass-card" onKeyDown={event => {
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    }}>
      {!menuItem.missing && <>
        <button role="menuitem" data-island-keyboard="true" className="ig-glass-control ig-glass-control--ghost" onClick={() => { closeMenu(true); void openShelfItem(menuItem.id, "open"); }}>{t("shelf.open")}</button>
        <button role="menuitem" data-island-keyboard="true" className="ig-glass-control ig-glass-control--ghost" onClick={() => { closeMenu(true); void openShelfItem(menuItem.id, "reveal"); }}>{t("shelf.reveal")}</button>
      </>}
      <button role="menuitem" data-island-keyboard="true" className="ig-glass-control ig-glass-control--ghost" onClick={() => { closeMenu(true); void removeShelfItems(visibleSelection.includes(menuItem.id) ? visibleSelection : [menuItem.id]); }}>{t("shelf.remove")}</button>
    </div>}
  </section>;
}

