// Owner: F1. Tab strip of the expanded panel: Designer's .ig-tabbar/.ig-tab/.ig-tab-thumb + WAI-ARIA tabs behaviour.
import { LayoutGroup, motion } from "motion/react";
import { useRef, type KeyboardEvent } from "react";
import { springs } from "../design/motion";
import type { IslandModule, ModuleId } from "../shared/types";

export const tabId = (id: ModuleId) => `ig-tab-${id}`;
export const tabPanelId = (id: ModuleId) => `ig-tabpanel-${id}`;

interface TabsProps {
  modules: readonly IslandModule[];
  active: ModuleId;
  onSelect: (id: ModuleId) => void;
}

export function Tabs({ modules, active, onSelect }: TabsProps) {
  const refs = useRef(new Map<ModuleId, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const index = modules.findIndex((m) => m.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % modules.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + modules.length) % modules.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = modules.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = modules[next];
    onSelect(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <LayoutGroup id="ig-shell-tabs">
      <nav className="ig-tabbar" role="tablist" aria-label="Вкладки острова" onKeyDown={onKeyDown}>
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
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(m.id)}
            >
              {selected && <motion.span layoutId="ig-shell-tab-thumb" className="ig-tab-thumb" transition={springs.tab} />}
              <Icon size={16} />
              <span>{m.title}</span>
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
