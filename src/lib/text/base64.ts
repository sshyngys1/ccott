// Base64 (RFC 4648) with UTF-8 text on the plain side.

export type Base64Result = { ok: true; value: string } | { ok: false; error: string };

export const BASE64_ERROR = "Это не Base64: допустимы A–Z, a–z, 0–9, «+», «/» и «=» в конце";
export const BASE64_NOT_UTF8 = "Это Base64, но внутри не текст UTF-8";

const CHUNK = 0x8000;

export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * Lenient decoder: whitespace/line breaks inside the input are ignored, the URL-safe alphabet («-», «_») is accepted
 * and missing «=» padding is restored. Anything else is an error; so is a payload that is not valid UTF-8.
 */
export function base64Decode(input: string): Base64Result {
  const compact = input.replace(/\s+/g, "");
  if (!compact) return { ok: false, error: BASE64_ERROR };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return { ok: false, error: BASE64_ERROR };
  const body = compact.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (body.length % 4 === 1) return { ok: false, error: BASE64_ERROR };
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return { ok: false, error: BASE64_ERROR };
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: BASE64_NOT_UTF8 };
  }
}
