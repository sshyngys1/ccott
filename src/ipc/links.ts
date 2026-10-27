import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from ".";

export function httpUrl(text: string): string | null {
  try { const url = new URL(text.trim()); return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null; }
  catch { return null; }
}
export async function openHttpUrl(text: string): Promise<void> {
  const url = httpUrl(text);
  if (!url) return;
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
