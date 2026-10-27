import qrcode from "qrcode-generator";
import { t } from "../../i18n";

// M correction leaves room for typical links/text while bounding CPU work and preview density.
export const MAX_QR_BYTES = 1800;
export interface GeneratedQr { size: number; modules: boolean[][]; dataUrl: string }
qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));

export function generateQr(text: string): GeneratedQr {
  if (!text) throw new Error(t("qr.empty"));
  const error = () => new Error(t("qr.tooLong", {limit:MAX_QR_BYTES}));
  if (new TextEncoder().encode(text).length > MAX_QR_BYTES) throw error();
  try {
    const qr = qrcode(0, "M"); qr.addData(text, "Byte"); qr.make();
    const size = qr.getModuleCount();
    const modules = Array.from({length:size}, (_,y) => Array.from({length:size}, (_,x) => qr.isDark(y,x)));
    // Four modules of quiet zone; user text is encoded into modules, never inserted into SVG markup.
    return {size, modules, dataUrl:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({cellSize:4,margin:16,scalable:true}))}`};
  } catch { throw error(); }
}

export function qrCanvas(qr: GeneratedQr): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scale = 8;
  canvas.width = canvas.height = (qr.size+8)*scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("couldnTCopy"));
  // Black/white are QR image data, independent of the UI theme.
  context.fillStyle = "#ffffff"; context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle = "#000000";
  qr.modules.forEach((row,y) => row.forEach((dark,x) => { if(dark) context.fillRect((x+4)*scale,(y+4)*scale,scale,scale); }));
  return canvas;
}
export async function copyQrImage(qr: GeneratedQr): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    const canvas = qrCanvas(qr);
    const png = new Promise<Blob>((resolve,reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encode failed")), "image/png"));
    void png.catch(() => {});
    // Start the clipboard write during the click; ClipboardItem resolves encoding asynchronously.
    await navigator.clipboard.write([new ClipboardItem({"image/png":png})]);
    return true;
  } catch { return false; }
}
