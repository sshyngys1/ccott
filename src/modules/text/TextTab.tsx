import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconBraces, IconCheck, IconCleanText, IconCopy, IconSwap, IconUndo, IconWarning, type IconProps } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { copyText } from "../../lib/copy";
import { pickPrefill } from "../../lib/text/prefill";
import { formatStats, textStats } from "../../lib/text/stats";
import { useTextStore } from "../../lib/text/store";
import type { TransformId } from "../../lib/text/transforms";
import { invoke } from "../../ipc";
import { requestShell } from "../../shared/shellBus";
import "../../lib/ui.css";
import "./text.css";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

interface Group {
  label: string;
  items: { id: TransformId; label: string; title?: string; Icon?: (p: IconProps) => ReactNode }[];
}

const GROUPS: Group[] = [
  {
    label: "Раскладка",
    items: [
      { id: "layout", label: "RU ⇄ EN", title: "Исправить текст, набранный в не той раскладке", Icon: IconSwap },
      { id: "translit", label: "Транслит", title: "Кириллица → латиница" },
    ],
  },
  {
    label: "Регистр",
    items: [
      { id: "upper", label: "ВЕРХНИЙ" },
      { id: "lower", label: "нижний" },
      { id: "title", label: "Каждое Слово" },
      { id: "sentence", label: "Как в предложении" },
    ],
  },
  {
    label: "Пробелы",
    items: [
      { id: "trim", label: "Обрезать края", title: "Убрать пробелы в начале и конце строк" },
      { id: "collapse", label: "Сжать пробелы", title: "Повторяющиеся пробелы и пустые строки → по одному", Icon: IconCleanText },
    ],
  },
  {
    label: "Формат",
    items: [
      { id: "jsonPretty", label: "JSON красиво", Icon: IconBraces },
      { id: "jsonMin", label: "JSON в строку" },
      { id: "b64enc", label: "В Base64" },
      { id: "b64dec", label: "Из Base64" },
    ],
  },
];

export function TextTab() {
  const text = useTextStore((s) => s.text);
  const error = useTextStore((s) => s.error);
  const last = useTextStore((s) => s.last);
  const canUndo = useTextStore((s) => s.history.length > 0);
  const selection = useTextStore((s) => s.selection);
  const { edit, apply, undo } = useTextStore.getState();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Offer the fresh clipboard text once per session when the field is empty.
  useEffect(() => {
    const s = useTextStore.getState();
    if (s.prefilled) return;
    s.markPrefilled();
    if (s.text) return;
    let cancelled = false;
    invoke("clipboard_list", { query: "", limit: 20 })
      .then((items) => {
        const fresh = pickPrefill(items, Date.now());
        if (!cancelled && fresh && !useTextStore.getState().text) useTextStore.getState().prefill(fresh);
      })
      .catch((err: unknown) => console.warn("[island] clipboard_list (prefill) failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the replaced part selected after a transform applied to a selection.
  useLayoutEffect(() => {
    if (selection && areaRef.current) {
      areaRef.current.setSelectionRange(selection[0], selection[1]);
      useTextStore.getState().clearSelection();
    }
  }, [selection, text]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const stats = textStats(text);
  const empty = text.length === 0;

  const onApply = (id: TransformId) => {
    const el = areaRef.current;
    apply(id, el?.selectionStart ?? 0, el?.selectionEnd ?? 0);
  };

  const onCopy = async () => {
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) {
      await requestShell({ type: "toast", text: "Не удалось скопировать" });
      return;
    }
    await requestShell({ type: "toast", text: "Скопировано" });
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="tx-root">
      <h2 className="mod-sr-only">Текст</h2>
      <div className="ig-field mod-fill" data-invalid={error ? true : undefined}>
        <textarea
          ref={areaRef}
          className="ig-textarea ig-textarea--mono"
          value={text}
          spellCheck={false}
          placeholder="Вставьте или наберите текст — затем выберите преобразование справа"
          aria-label="Текст для преобразования"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "tx-error" : undefined}
          onChange={(e) => edit(e.target.value)}
        />
        {error && (
          <div className="tx-banner-wrap">
            <div id="tx-error" className="ig-banner ig-banner--danger" role="alert">
              <IconWarning size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}
        <div className="ig-field-bar ig-field-bar--footer">
          <span className="ig-num mod-caption tx-stats" aria-live="off">
            {formatStats(stats)}
          </span>
          <span className="ig-field-bar__spacer" />
          <motion.button type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost" {...tap} disabled={!canUndo} onClick={undo}>
            <IconUndo size={16} />
            Отменить
          </motion.button>
          <motion.button type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--accent" {...tap} disabled={empty} onClick={() => void onCopy()}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? "Скопировано" : "Копировать"}
          </motion.button>
        </div>
      </div>

      <section className="tx-transforms" aria-label="Преобразования">
        {GROUPS.map((g) => (
          <div key={g.label} className="tx-group">
            <h4 className="ig-section-label mod-label-flush">{g.label}</h4>
            <div className="tx-grid">
              {g.items.map(({ id, label, title, Icon }) => (
                <motion.button
                  key={id}
                  type="button"
                  className="ig-glass-control ig-glass-control--sm tx-transform"
                  {...tap}
                  title={title}
                  data-selected={last === id && !error ? true : undefined}
                  disabled={empty}
                  onClick={() => onApply(id)}
                >
                  {Icon && <Icon size={16} />}
                  <span className="ig-truncate">{label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
