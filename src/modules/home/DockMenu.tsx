import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export interface DockMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  select: () => void;
}
/** Portal above the dock's clipped glass surface, constrained to the Home panel. */
export function DockMenu({ anchor, container, items, close }: {
  anchor: HTMLElement;
  container: HTMLElement;
  items: DockMenuItem[];
  close: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node)
      return;
    const place = () => {
      const parent = container.getBoundingClientRect();
      const button = anchor.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(node).getPropertyValue("--ig-space-2")) || 0;
      setPosition({
        left: Math.max(0, Math.min(button.right - parent.left - bounds.width, parent.width - bounds.width)),
        top: Math.max(0, Math.min(button.top - parent.top - bounds.height - gap, parent.height - bounds.height)),
      });
    };
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !anchor.contains(event.target as Node))
        close();
    };
    place();
    node.querySelector<HTMLButtonElement>("button")?.focus();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, container, close]);
  return createPortal(<div ref={menu} role="menu" className="ig-glass-card hm-dock-menu" style={position} onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.focus();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End")
        return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (active + direction + items.length) % items.length;
      setActive(next);
      menu.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    }}>
   {items.map((item, index) => (<button key={item.id} type="button" role="menuitem" data-island-keyboard="true" className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost hm-dock-menu-item" tabIndex={index === active ? 0 : -1} onFocus={() => setActive(index)} onClick={() => {
      close();
      item.select();
    }}>
     {item.icon}<span>{item.label}</span>
    </button>))}
  </div>, container);
}
