import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface DockMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  select: () => void;
}

/** Portal above the dock's clipped glass surface, constrained to the Home panel. */
export function DockMenu({
  anchor,
  container,
  items,
  close,
  placement = "above",
  point = null,
  className,
}: {
  anchor: HTMLElement;
  container: HTMLElement;
  items: DockMenuItem[];
  close: () => void;
  placement?: "above" | "below";
  point?: { x: number; y: number } | null;
  className?: string;
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
      const leftTarget = point
        ? point.x - parent.left
        : placement === "below"
          ? button.left - parent.left
          : button.right - parent.left - bounds.width;
      const topTarget = placement === "below"
        ? button.bottom - parent.top + gap
        : button.top - parent.top - bounds.height - gap;
      setPosition({
        left: Math.max(0, Math.min(leftTarget, parent.width - bounds.width)),
        top: Math.max(0, Math.min(topTarget, parent.height - bounds.height)),
      });
    };
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !anchor.contains(event.target as Node)) {
        if (node.contains(document.activeElement) && document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        close();
      }
    };
    place();
    node.querySelector<HTMLButtonElement>("button")?.focus();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, container, close, placement, point]);
  return createPortal(
    <div
      ref={menu}
      role="menu"
      className={className ? `ig-glass-card hm-dock-menu ${className}` : "ig-glass-card hm-dock-menu"}
      style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (menu.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
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
      }}
    >
      {items.map((item, index) => (<button
        key={item.id}
        type="button"
        role="menuitem"
        data-island-keyboard="true"
        className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost hm-dock-menu-item"
        tabIndex={index === active ? 0 : -1}
        onFocus={() => setActive(index)}
        onClick={(event) => {
          event.currentTarget.blur();
          close();
          item.select();
        }}
      >
        {item.icon}<span>{item.label}</span>
      </button>))}
    </div>,
    container
  );
}
