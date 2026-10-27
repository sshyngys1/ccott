import { t } from "../i18n";
// Owner: F1. Pill toasts: the one place that applies «Не беспокоить» and hands the store a fresh toast.
import type { UpdateInfo } from "../shared/types";
import { useIslandStore, type PillToast } from "../store";

let seq = 0;

/** Mask password/token-like single-line text before storing it in the visible pill. */
export function clipboardToastPreview(text: string, preview: string = text): string {
  // At most 128 Unicode characters (256 UTF-16 code units), no whitespace or newlines.
  if (text.length < 8 || text.length > 256 || /\s/u.test(text)) return preview;
  const length = [...text].length;
  if (length < 8 || length > 128) return preview;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}\s]/u];
  return classes.filter((pattern) => pattern.test(text)).length >= 3 ? "••••••" : preview;
}

/** Shows a toast in the pill (the hold timer lives in `useToastSync`). Suppressed by doNotDisturb. */
export function showToast(toast: { label: string; preview?: string; previewKey?: PillToast["previewKey"]; onClick?: () => void; actionLabel?: string; color?: string }): void {
  const store = useIslandStore.getState();
  if (store.doNotDisturb) return;
  store.setToast({ id: ++seq, label: toast.label, preview: toast.preview ?? "", ...(toast.previewKey ? { previewKey: toast.previewKey } : {}), ...(toast.onClick ? { onClick:toast.onClick } : {}), ...(toast.actionLabel ? {actionLabel:toast.actionLabel} : {}), ...(toast.color ? {color:toast.color} : {}) });
}

/** Records an available update in the store and shows a one-time «Доступно обновление» toast per version. */
export function announceUpdate(info: UpdateInfo | null): void {
  const store = useIslandStore.getState();
  store.setAvailableUpdate(info);
  if (!info) return;
  if (store.updateToastShownFor === info.version) return;
  store.markUpdateToastShown(info.version);
  showToast({ get label() { return t("updateAvailable"); }, preview: info.version });
}
