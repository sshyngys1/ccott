import { t, useT, localizeMessage } from "../../i18n";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconBraces, IconCheck, IconCleanText, IconCopy, IconQr, IconSwap, IconUndo, IconWarning, type IconProps } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { copyText } from "../../lib/copy";
import { generateQr, type GeneratedQr } from "../../lib/qr/generate";
import { QrPanel } from "./QrPanel";
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
  qr?: boolean;
  items: { id: TransformId; label: string; title?: string; Icon?: (p: IconProps) => ReactNode }[];
}

const GROUPS: Group[] = [
  {
    get label() { return t("keyboardLayout"); },
    items: [
      { id: "layout", label: "RU ⇄ EN", get title() { return t("fixTextTypedWithTheWrongKeyboardLayout"); }, Icon: IconSwap },
      { id: "translit", get label() { return t("transliterate"); }, get title() { return t("cyrillicLatin"); } },
    ],
  },
  {
    get label() { return t("case"); },
    items: [
      { id: "upper", get label() { return t("uppercase"); } },
      { id: "lower", get label() { return t("lowercase"); } },
      { id: "title", get label() { return t("titleCase"); } },
      { id: "sentence", get label() { return t("sentenceCase"); } },
    ],
  },
  {
    get label() { return t("whitespace"); },
    items: [
      { id: "trim", get label() { return t("trimEdges"); }, get title() { return t("trimWhitespaceAtTheStartAndEndOfLines"); } },
      { id: "collapse", get label() { return t("collapseWhitespace"); }, get title() { return t("reduceRepeatedSpacesAndBlankLinesToOne"); }, Icon: IconCleanText },
    ],
  },
  {
    get label() { return t("format"); },
    qr: true,
    items: [
      { id: "jsonPretty", get label() { return t("formatJson"); }, Icon: IconBraces },
      { id: "jsonMin", get label() { return t("minifyJson"); } },
      { id: "b64enc", get label() { return t("encodeBase64"); } },
      { id: "b64dec", get label() { return t("decodeBase64"); } },
    ],
  },
];

export function TextTab() {
  useT();
  const text = useTextStore((s) => s.text);
  const error = useTextStore((s) => s.error);
  const last = useTextStore((s) => s.last);
  const canUndo = useTextStore((s) => s.history.length > 0);
  const selection = useTextStore((s) => s.selection);
  const { edit, apply, undo } = useTextStore.getState();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qr,setQr] = useState<GeneratedQr | null>(null);
  const [qrError,setQrError] = useState<string | null>(null);

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
      await requestShell({ type: "toast", get text() { return t("couldnTCopy"); } });
      return;
    }
    await requestShell({ type: "toast", get text() { return t("copied"); } });
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };
  const onQr = () => {
    const el = areaRef.current;
    const start = el?.selectionStart ?? 0, end = el?.selectionEnd ?? 0;
    try { setQr(generateQr(start !== end ? text.slice(start,end) : text)); setQrError(null); }
    catch (error) { setQrError(error instanceof Error ? error.message : t("qr.tooLong",{limit:1800})); }
  };

  return (
    <div className="tx-root">
      <h2 className="mod-sr-only">{t("text")}</h2>
      <div className="ig-field mod-fill" data-invalid={error ? true : undefined}>
        {qr ? <QrPanel qr={qr} onClose={() => {setQr(null); requestAnimationFrame(() => areaRef.current?.focus());}} /> : <textarea
          ref={areaRef}
          className="ig-textarea ig-textarea--mono"
          value={text}
          spellCheck={false}
          placeholder={t("pasteOrTypeTextThenChooseAToolOnTheRight")}
          aria-label={t("textToTransform")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "tx-error" : undefined}
          onChange={(e) => {edit(e.target.value);setQrError(null);}}
        />}
        {(error || qrError) && !qr && (
          <div className="tx-banner-wrap">
            <div id="tx-error" className="ig-banner ig-banner--danger" role="alert">
              <IconWarning size={16} />
              <span>{localizeMessage(qrError ?? error ?? "")}</span>
            </div>
          </div>
        )}
        {!qr && <div className="ig-field-bar ig-field-bar--footer">
          <span className="ig-num mod-caption tx-stats" aria-live="off">
            {formatStats(stats)}
          </span>
          <span className="ig-field-bar__spacer" />
          <motion.button type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost" {...tap} disabled={!canUndo} onClick={undo}>
            <IconUndo size={16} />
            {t("undo")}</motion.button>
          <motion.button type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--accent" {...tap} disabled={empty} onClick={() => void onCopy()}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? t("copied") : t("copy")}
          </motion.button>
        </div>}
      </div>

      <section className="tx-transforms" aria-label={t("textTools")}>
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
              {g.qr && (
                <motion.button
                  type="button"
                  className="ig-glass-control ig-glass-control--sm tx-transform"
                  {...tap}
                  disabled={empty}
                  onClick={onQr}
                >
                  <IconQr size={16} />
                  {t("qrCode")}
                </motion.button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
