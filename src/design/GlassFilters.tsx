// Owner: Designer. SVG filter defs for the "Meniscus" glass. Mount once (App.tsx). Ids are prefixed `ig-`.
//
//  url(#ig-refraction) — subtle liquid refraction. Use as `backdrop-filter` (class .ig-glass--refract) or `filter`
//                        on SMALL elements only (controls, thumbs, mini-artwork ≤ ~120×120): feDisplacementMap is
//                        CPU/GPU-heavy and re-runs on every repaint of the filtered area.
//  url(#ig-goo)        — gooey merge for shapes budding out of the pill (toast droplet, badges). Apply to a layer
//                        that contains ONLY opaque shapes (no text): the alpha threshold would eat glyph edges.
//  url(#ig-noise)      — grain overlay as a filter (alternative to the cached --ig-noise tile used by .ig-glass).

export const GLASS_FILTER_IDS = {
  refraction: "ig-refraction",
  goo: "ig-goo",
  noise: "ig-noise",
} as const;

export function GlassFilters() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <defs>
        {/* Low-frequency turbulence, softened → smooth "water lens" warp of a few px. */}
        <filter
          id={GLASS_FILTER_IDS.refraction}
          x="-5%"
          y="-5%"
          width="110%"
          height="110%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.026" numOctaves={2} seed={11} result="ig-turb" />
          <feGaussianBlur in="ig-turb" stdDeviation={2} result="ig-turb-soft" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="ig-turb-soft"
            scale={14}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Classic goo: blur, then a steep alpha curve re-sharpens the merged silhouette; source is composited on top. */}
        <filter id={GLASS_FILTER_IDS.goo} x="-20%" y="-50%" width="140%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={6} result="ig-goo-blur" />
          <feColorMatrix
            in="ig-goo-blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
            result="ig-goo-shape"
          />
          <feComposite in="SourceGraphic" in2="ig-goo-shape" operator="atop" />
        </filter>

        {/* Fine monochrome grain blended over the source. */}
        <filter id={GLASS_FILTER_IDS.noise} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} stitchTiles="stitch" result="ig-grain" />
          <feColorMatrix
            in="ig-grain"
            type="matrix"
            values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0.06 0"
            result="ig-grain-mono"
          />
          <feComposite in="ig-grain-mono" in2="SourceGraphic" operator="in" result="ig-grain-clip" />
          <feBlend in="SourceGraphic" in2="ig-grain-clip" mode="overlay" />
        </filter>
      </defs>
    </svg>
  );
}
