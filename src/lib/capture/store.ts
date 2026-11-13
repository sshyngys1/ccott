import { create } from "zustand";
import { localizeMessage, t } from "../../i18n";
import { captureOpenFolder, capturePickColor, captureStart } from "../../ipc/capture";
import { httpUrl, openHttpUrl } from "../../ipc/links";
import { requestShell } from "../../shared/shellBus";
import type { CaptureAction, CaptureMode, ClipItem } from "../../shared/types";

interface Feedback { message: string; onClick?: () => void; color?: string; preview?: string; actionLabel?: string }
export const useCaptureStore = create<{ busy: boolean; feedback: Feedback | null }>(() => ({ busy:false, feedback:null }));
let expectedEcho: "image" | "text" | null = null;
/** History still stores captures; its generic toast must not replace Saved/OCR feedback. */
export function consumeCaptureEcho(item: ClipItem): boolean {
  // Rust classifies a decoded URL as `link`, while OCR and QR both copy textual data.
  const matches = item.kind === expectedEcho || (expectedEcho === "text" && item.kind === "link");
  if (!matches || !/^(?:island-win|ccott)\.exe$/i.test(item.sourceApp)) return false;
  expectedEcho = null; return true;
}
function feedback(message: string, onClick?: () => void, extra: Pick<Feedback, "color" | "preview" | "actionLabel"> = {}) { useCaptureStore.setState({ feedback:{ message, onClick, ...extra } }); }
export async function runCapture(mode: CaptureMode, action: CaptureAction): Promise<void> {
  if (useCaptureStore.getState().busy) return;
  useCaptureStore.setState({ busy:true });
  expectedEcho = action === "ocr" || action === "qr" ? "text" : "image";
  try {
    await requestShell({ type:"collapse" });
    const result = await captureStart(mode, action);
    if (!result) { expectedEcho = null; return; }
    if (result.action === "save") {
      feedback(t("capture.saved"), () => { void captureOpenFolder().catch(() => feedback(t("capture.folderError"))); });
    } else if (result.action === "ocr") {
      if (!result.text) expectedEcho = null;
      feedback(t(result.text ? "capture.textCopied" : "capture.noText"));
    } else if (result.action === "qr") {
      if (!result.text) expectedEcho = null;
      const url = httpUrl(result.text ?? "");
      feedback(t(result.text ? "qr.copied" : "qr.notFound"), url ? () => { void openHttpUrl(url).catch(() => feedback(t("qr.openError"))); } : undefined, url ? { actionLabel:t("qr.open") } : {});
    } else feedback(t("copied"));
  } catch (error) {
    expectedEcho = null;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    feedback(message ? localizeMessage(message) : t("capture.error"));
  } finally { useCaptureStore.setState({ busy:false }); }
}
export async function runPickColor(): Promise<void> {
  if (useCaptureStore.getState().busy) return;
  useCaptureStore.setState({ busy:true }); expectedEcho = "text";
  try {
    await requestShell({ type:"collapse" });
    const result = await capturePickColor();
    if (!result) { expectedEcho = null; return; }
    feedback(t("copied"), undefined, { preview:result.hex, color:result.hex });
  } catch { expectedEcho = null; feedback(t("color.error")); }
  finally { useCaptureStore.setState({ busy:false }); }
}
export function resetCaptureStore(): void { expectedEcho = null; useCaptureStore.setState({ busy:false, feedback:null }); }
