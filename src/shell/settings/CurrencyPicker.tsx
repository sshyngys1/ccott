import { useId, useRef, useState } from "react";
import { useT, type TranslationKey } from "../../i18n";
import { CURRENCY_CODES } from "../../lib/cmd/currency";

export function CurrencyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const label = (code: string) => code ? `${code} — ${t(`settings.currency.${code}` as TranslationKey)}` : t("settings.currencyNone");
  const codes = ["", ...CURRENCY_CODES.filter(code => label(code).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))];
  // Preserve a valid code written by a newer build, even if this build does not name it.
  const selected = CURRENCY_CODES.includes(value) || !value ? label(value) : value;
  const choose = (code: string) => { onChange(code); setOpen(false); setQuery(""); input.current?.focus(); };
  return (
    <div className="ig-currency-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <input ref={input} id="ig-default-currency" className="ig-glass-input" role="combobox"
        aria-label={t("settings.defaultCurrency")} aria-autocomplete="list" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-activedescendant={open && codes[active] !== undefined ? `${id}-${active}` : undefined}
        placeholder={t("settings.currencySearch")} value={open ? query : selected}
        onClick={() => { setOpen(true); setActive(query.trim() ? 1 : 0); }}
        onChange={event => { setQuery(event.target.value); setActive(event.target.value.trim() ? 1 : 0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); setQuery(""); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            const next = open ? (active + (event.key === "ArrowDown" ? 1 : -1) + codes.length) % codes.length : query.trim() ? 1 : 0;
            setActive(next);
            document.getElementById(`${id}-${next}`)?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (codes[active] !== undefined) choose(codes[active]);
          }
        }} />
      {open && <ul id={id} role="listbox" aria-label={t("settings.defaultCurrency")} className="ig-list ig-currency-picker__options">
        {codes.map((code, index) => <li key={code} id={`${id}-${index}`} role="option" aria-selected={code === value}
          className="ig-list-row ig-list-row--compact" data-active={index === active}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(code)}>{label(code)}</li>)}
      </ul>}
    </div>
  );
}
