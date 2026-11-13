// Owner: Designer. WCAG 2.x contrast helpers used to verify token pairs (see contrast.test.ts, design-spec §10).

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

/** "#rrggbb" | "#rgb" → [r,g,b] 0..255. */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Source-over composite of a translucent colour over an opaque one (sRGB space, as browsers do). */
export function over(top: RGBA, bottom: RGB): RGB {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)) as unknown as RGB;
}

/** WCAG relative luminance. */
export function luminance(rgb: RGB): number {
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Contrast of translucent text over a stack of translucent surfaces on an opaque backdrop.
 * `layers` are bottom → top (e.g. [panel surface, raised tile]).
 */
export function stackContrast(text: RGBA, layers: readonly RGBA[], backdrop: RGB): number {
  const bg = layers.reduce<RGB>((acc, layer) => over(layer, acc), backdrop);
  return contrastRatio(over(text, bg), bg);
}
