// Owner: F1. The monitor picker stays inside the island; native select popups cannot hold its focus.
import { useRef, useState, type KeyboardEvent } from "react";
import { IconCheck } from "../../design/icons";
import type { MonitorOption } from "./monitors";

interface MonitorPickerProps {
  value: string;
  options: readonly MonitorOption[];
  onChange: (value: string) => void;
}

/** Manual-selection listbox: arrows move focus, Enter/Space commit, one Tab stop. */
export function MonitorPicker({ value, options, onChange }: MonitorPickerProps) {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const active = options.some((o) => o.value === focused) ? focused : value;
  const tabIndex = Math.max(0, options.findIndex((o) => o.value === active));

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % options.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(options[index].value);
      return;
    } else return;
    e.preventDefault();
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <ul className="ig-list ig-scroll ig-monitor-picker" role="listbox" aria-label="Монитор">
      {options.map((option, index) => (
        <li
          key={option.value}
          ref={(el) => { refs.current[index] = el; }}
          className="ig-list-row ig-list-row--compact"
          role="option"
          aria-selected={option.value === value}
          tabIndex={index === tabIndex ? 0 : -1}
          data-island-keyboard="true"
          title={option.label}
          onFocus={() => setFocused(option.value)}
          onClick={(e) => { e.currentTarget.focus(); onChange(option.value); }}
          onKeyDown={(e) => onKeyDown(e, index)}
        >
          <span className="ig-truncate">{option.label}</span>
          {option.value === value && <IconCheck size={14} />}
        </li>
      ))}
    </ul>
  );
}
