import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevronDown } from "../../design/icons";
import { useT } from "../../i18n";
import type { OcrLanguage } from "../../shared/types";

interface OcrLanguagePickerProps {
  value: string;
  languages: OcrLanguage[];
  onChange: (value: string) => void;
}

/** Keep the menu inside the island: native select popups can lose its keyboard focus. */
export function OcrLanguagePicker({ value, languages, onChange }: OcrLanguagePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<(HTMLLIElement | null)[]>([]);
  const options = [{ tag: "auto", name: t("ocrLanguage.auto") }, ...languages];
  const selected = options.findIndex((language) => language.tag === value);

  useEffect(() => {
    if (open) optionsRef.current[Math.max(0, selected)]?.focus();
  }, [open, selected]);

  const choose = (tag: string) => {
    onChange(tag);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[index].tag);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    } else return;
    event.preventDefault();
    optionsRef.current[next]?.focus();
    optionsRef.current[next]?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <div onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={button}
        id="ig-ocr-language"
        type="button"
        role="combobox"
        className="ig-glass-control ig-glass-control--sm"
        aria-label={t("ocrLanguage.label")}
        aria-describedby="ig-ocr-hint"
        aria-expanded={open}
        aria-controls={open ? "ig-ocr-options" : undefined}
        aria-haspopup="listbox"
        data-island-keyboard="true"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="ig-truncate">{options[selected]?.name ?? value}</span>
        <IconChevronDown size={14} />
      </button>
      {open && (
        <ul id="ig-ocr-options" className="ig-list ig-scroll ig-monitor-picker" role="listbox" aria-label={t("ocrLanguage.label")}>
          {options.map((language, index) => (
            <li
              key={language.tag}
              ref={(element) => { optionsRef.current[index] = element; }}
              className="ig-list-row ig-list-row--compact"
              role="option"
              aria-selected={language.tag === value}
              tabIndex={index === Math.max(0, selected) ? 0 : -1}
              data-island-keyboard="true"
              title={language.name}
              onClick={() => choose(language.tag)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className="ig-truncate">{language.name}</span>
              {language.tag === value && <IconCheck size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
