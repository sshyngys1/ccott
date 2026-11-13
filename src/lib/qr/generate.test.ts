import { afterEach, expect, it, vi } from "vitest";
import qrcode from "qrcode-generator";
import { setLanguage } from "../../i18n";
import { copyQrImage, generateQr, MAX_QR_BYTES } from "./generate";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("generates QR modules, four-module quiet zone and a safe SVG preview", () => {
  const qr = generateQr("https://example.com/ccott");
  expect(qr.size % 4).toBe(1);
  expect(qr.modules).toHaveLength(qr.size);
  expect(qr.modules.every(row => row.length === qr.size)).toBe(true);
  expect(qr.modules[0].slice(0,7)).toEqual(Array(7).fill(true));
  const svg = decodeURIComponent(qr.dataUrl.split(",")[1]);
  expect(svg).toContain(`<svg`);
  expect(svg).toContain(`viewBox="0 0 ${(qr.size+8)*4} ${(qr.size+8)*4}"`);
  expect(decodeURIComponent(generateQr("</svg><script>alert(1)</script>").dataUrl)).not.toContain("<script>");
});
it("encodes Cyrillic/emoji as UTF-8 and enforces the byte limit before generation", () => {
  expect(qrcode.stringToBytes("Привет 🌍")).toEqual([...new TextEncoder().encode("Привет 🌍")]);
  expect(generateQr("Привет 🌍").modules).not.toEqual(generateQr("?????? ?").modules);
  expect(() => generateQr("a".repeat(MAX_QR_BYTES))).not.toThrow();
  expect(() => generateQr("я".repeat(MAX_QR_BYTES/2+1))).toThrow(/1800/);
  expect(() => generateQr("a".repeat(MAX_QR_BYTES+1))).toThrow(/1800/);
});
it.each(["ru","en"] as const)("%s gives understandable empty/length feedback", lang => {
  setLanguage(lang);
  expect(() => generateQr("")).toThrow(lang === "ru" ? "Введите текст" : "Enter text");
  expect(() => generateQr("a".repeat(MAX_QR_BYTES+1))).toThrow(lang === "ru" ? "слишком длинный" : "too long");
});
it("copies a real PNG-typed blob with an integer-scaled, white quiet zone", async () => {
  const fills: unknown[][] = [];
  const context = {fillStyle:"",fillRect(...args:number[]){ fills.push([this.fillStyle,...args]); }};
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(callback => callback(new Blob(["test-png"],{type:"image/png"})));
  let copied: Blob | undefined;
  vi.stubGlobal("ClipboardItem",class { constructor(public data:Record<string,Promise<Blob>>){ } });
  const write = vi.fn(async (items:{data:Record<string,Promise<Blob>>}[]) => {copied=await items[0].data["image/png"];});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{write}});
  const qr = generateQr("CCOTT");
  expect(await copyQrImage(qr)).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
  expect(copied?.type).toBe("image/png");
  expect(fills[0]).toEqual(["#ffffff",0,0,(qr.size+8)*8,(qr.size+8)*8]);
  expect(fills[1]).toEqual(["#000000",32,32,8,8]);
});
it("reports unavailable clipboard support without throwing", async () => {
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined});
  expect(await copyQrImage(generateQr("CCOTT"))).toBe(false);
});
