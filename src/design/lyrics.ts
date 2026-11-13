// Owner: Designer. Synced-lyrics design logic (spec §6.11): cover palette → tint tokens, active line, blur levels.
// Pure functions (tested in lyrics.test.ts) + one browser helper (`paletteFromImage`) that samples a 24×24 canvas.
import { contrastRatio, hexToRgb, type RGB } from "./contrast";
import { lyricsMotion } from "./motion";

export type LyricsTheme = "dark" | "light";

/** Three tint stops (hex) written on the island as --ig-lyrics-bg-a/b/c. Text on top is always white. */
export interface LyricsPalette {
  a: string;
  b: string;
  c: string;
}

/**
 * Minimum contrast of white text on every stop. Dark theme goes deeper (calmer at night), light theme stays brighter
 * but still passes WCAG AA for the active line (bold 22px is "large text" — 3:1 would do; we keep 4.5:1 for the pill
 * line, which is 13px).
 */
export const LYRICS_CONTRAST: Record<LyricsTheme, number> = { dark: 6, light: 4.6 };

/** No artwork / not decoded yet: deep meniscus teal → blue → ink (same values as tokens.css fallbacks). */
export const LYRICS_FALLBACK: LyricsPalette = { a: "#0f5c55", b: "#173f66", c: "#121a2e" };

const WHITE: RGB = [255, 255, 255];

// ── colour space helpers ──
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Dominant colours of a small RGBA bitmap (e.g. 24×24 = 576 px from `getImageData`).
 * 1. Quantise every opaque pixel to 3 bits per channel (512 buckets), accumulate the average colour per bucket.
 * 2. Weight = alpha × (0.25 + chroma): saturated pixels win over large grey/black areas, but a grey cover still has a colour.
 * 3. Take the heaviest bucket, then the next ones that differ by ≥ 28° in hue (or ≥ 0.2 in lightness) — up to `max`.
 */
export function dominantColors(data: ArrayLike<number>, max = 3): RGB[] {
  const sum = new Float64Array(512 * 4); // r, g, b, weight
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.5) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const w = alpha * (0.25 + chroma);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    sum[key * 4] += r * w;
    sum[key * 4 + 1] += g * w;
    sum[key * 4 + 2] += b * w;
    sum[key * 4 + 3] += w;
  }
  const buckets: { rgb: RGB; w: number }[] = [];
  for (let k = 0; k < 512; k++) {
    const w = sum[k * 4 + 3];
    if (w > 0) buckets.push({ rgb: [sum[k * 4] / w, sum[k * 4 + 1] / w, sum[k * 4 + 2] / w], w });
  }
  buckets.sort((x, y) => y.w - x.w);
  const picked: RGB[] = [];
  for (const { rgb } of buckets) {
    if (picked.length >= max) break;
    const [h, s, l] = rgbToHsl(rgb);
    const distinct = picked.every((p) => {
      const [ph, ps, pl] = rgbToHsl(p);
      const bothChromatic = s > 0.15 && ps > 0.15;
      return (bothChromatic && hueDistance(h, ph) >= 28) || Math.abs(l - pl) >= 0.2;
    });
    if (distinct) picked.push(rgb);
  }
  return picked;
}

/**
 * One tint stop: keep the hue, clamp saturation (vivid but not neon; greys stay grey), then lower lightness until
 * white text reaches `LYRICS_CONTRAST[theme]`. `depth` makes the secondary stops darker (b = 0.85, c = 0.55 of a).
 */
export function lyricsTone(rgb: RGB, theme: LyricsTheme, depth = 1): RGB {
  const [h, s0, l0] = rgbToHsl(rgb);
  const s = s0 < 0.1 ? s0 : Math.min(0.82, Math.max(0.38, s0 * 1.15));
  let l = Math.min(l0, theme === "dark" ? 0.4 : 0.5) * depth;
  let out = hslToRgb(h, s, l);
  while (contrastRatio(WHITE, out) < LYRICS_CONTRAST[theme] && l > 0.02) {
    l -= 0.015;
    out = hslToRgb(h, s, l);
  }
  return out;
}

/** Palette for the tint from raw RGBA pixels. Fewer than 3 distinct colours → derived stops (hue +24°, deeper). */
export function lyricsPalette(data: ArrayLike<number>, theme: LyricsTheme): LyricsPalette {
  const colors = dominantColors(data, 3);
  if (colors.length === 0) return LYRICS_FALLBACK;
  const [h, s, l] = rgbToHsl(colors[0]);
  const second = colors[1] ?? hslToRgb((h + 24) % 360, s, l);
  const third = colors[2] ?? colors[0];
  return {
    a: rgbToHex(lyricsTone(colors[0], theme, 1)),
    b: rgbToHex(lyricsTone(second, theme, 0.85)),
    c: rgbToHex(lyricsTone(third, theme, 0.55)),
  };
}

/** CSS variables for the island element (React `style`). */
export function lyricsPaletteStyle(p: LyricsPalette): Record<`--ig-lyrics-bg-${"a" | "b" | "c"}`, string> {
  return { "--ig-lyrics-bg-a": p.a, "--ig-lyrics-bg-b": p.b, "--ig-lyrics-bg-c": p.c };
}

/** Browser only: draws the decoded artwork into a 24×24 canvas and extracts the palette (≈ 0.1 ms, once per track). */
export function paletteFromImage(img: CanvasImageSource, theme: LyricsTheme, size = 24): LyricsPalette {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return LYRICS_FALLBACK;
    ctx.drawImage(img, 0, 0, size, size);
    return lyricsPalette(ctx.getImageData(0, 0, size, size).data, theme);
  } catch {
    return LYRICS_FALLBACK; // tainted canvas, undecodable image
  }
}

/** Minimum white-text contrast over all stops (used by tests and the preview's readout). */
export function paletteContrast(p: LyricsPalette): number {
  return Math.min(...[p.a, p.b, p.c].map((hex) => contrastRatio(WHITE, hexToRgb(hex))));
}

// ── lines ──
export interface TimedLine {
  timeMs: number;
}

/** Index of the line that is active at `positionMs` (binary search; −1 before the first line). */
export function activeLineIndex(lines: readonly TimedLine[], positionMs: number, leadMs: number = lyricsMotion.leadMs): number {
  const t = positionMs + leadMs;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 0 = active, 1–3 = neighbours (static blur steps), 4 = far (no filter at all — usually outside the viewport). */
export type LyricLevel = 0 | 1 | 2 | 3 | 4;
export const FAR_DISTANCE = 7;

export function lyricLevel(index: number, active: number): LyricLevel {
  if (active < 0) return index === 0 ? 1 : (Math.min(3, index + 1) as LyricLevel); // intro: everything is "upcoming"
  const d = Math.abs(index - active);
  if (d >= FAR_DISTANCE) return 4;
  return Math.min(3, d) as LyricLevel;
}

export function lineState(index: number, active: number): "past" | "active" | "next" {
  return index < active ? "past" : index === active ? "active" : "next";
}

/** Transition delay steps for a line (only lines below the active one lag behind). */
export function staggerSteps(index: number, active: number): number {
  return index <= active ? 0 : Math.min(lyricsMotion.maxStaggerSteps, index - active);
}
