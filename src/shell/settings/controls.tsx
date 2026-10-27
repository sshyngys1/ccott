// Owner: F1. Small controls of the settings view: segmented control and a slider row that commits on release.
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { springs } from "../../design/motion";
import { sliderPercent } from "./monitors";

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** `.ig-segmented` radiogroup with the sliding thumb (the same recipe as the tab bar). */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const group = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <LayoutGroup id={group}>
      <div className="ig-segmented" role="radiogroup" aria-label={label}>
        {options.map((o, index) => (
          <button
            key={o.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            className="ig-tab"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={index === selected ? 0 : -1}
            data-island-keyboard="true"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = options.length - 1;
              else if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onChange(options[next].value);
              refs.current[next]?.focus();
            }}
          >
            {value === o.value && <motion.span layoutId={`${group}-thumb`} className="ig-tab-thumb" transition={springs.tab} />}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

interface SliderRowProps {
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called on release (native `change`), never on every `input` tick. */
  onCommit: (value: number) => void;
}

/** `.ig-setting-row--stacked`: title + live value «150 мс», range below. Follows the finger, commits once on `change`. */
export function SliderRow({ title, value, min, max, step, onCommit }: SliderRowProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commitRef.current(Number(el.value));
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  // The committed value arrived from the store (possibly clamped by the backend): stop showing the local draft.
  useEffect(() => setDraft(null), [value]);

  const shown = draft ?? value;
  return (
    <div className="ig-setting-row ig-setting-row--stacked">
      <span className="ig-setting-row__label">
        <span className="ig-setting-row__title">{title}</span>
        <span className="ig-setting-row__value">{shown} мс</span>
      </span>
      <input
        ref={ref}
        className="ig-glass-slider ig-glass-slider--accent"
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        style={{ "--ig-value": sliderPercent(shown, min, max) } as CSSProperties}
        aria-label={`${title}, мс`}
      />
    </div>
  );
}
