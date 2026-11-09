// Owner: Designer. Motion presets for `motion/react`. Spec: docs/design-spec.md §9.
//
// Physics check (mass = 1): damping ratio ζ = damping / (2·√stiffness).
// Polish pass: every preset was made ~30 % faster by scaling time (stiffness × ~2, damping × ~1.4 keeps ζ, so the feel stays).
//   expand   ζ ≈ 0.68 → ~5 % overshoot: the panel "pours out" of the pill, peaks ≈ 160 ms (+5.4 %: 720 → 747 px), within 2 px ≈ 265 ms, at rest ≈ 460 ms (was 650).
//   collapse ζ ≈ 1.02 → critically damped: fast, no bounce, no wobble when it snaps back (within 2 px ≈ 220 ms, at rest ≈ 335 ms; was 305 / 450).
//   tab      ζ ≈ 0.83 → a hint of follow-through on the tab thumb.
//   press    ζ ≈ 0.80 → quick squish on pointer down, tiny rebound on release.
import type { Transition } from "motion/react";

export const springs = {
  /** Pill → panel: width/height/borderRadius of the island container. */
  expand: { type: "spring", stiffness: 700, damping: 36, mass: 1, restDelta: 0.5, restSpeed: 2 },
  /** Panel → pill. Critically damped — must never undershoot below the pill size. */
  collapse: { type: "spring", stiffness: 1350, damping: 75, mass: 1, restDelta: 0.5, restSpeed: 2 },
  /** Active-tab thumb (layoutId) and tab-content slide. */
  tab: { type: "spring", stiffness: 1000, damping: 53, mass: 1 },
  /** Scale of a control under the pointer (whileTap) and its release. */
  press: { type: "spring", stiffness: 1600, damping: 64, mass: 1 },
  /** Hover growth of the collapsed pill (+--ig-pill-hover-grow) and pill width changes between activities. */
  pill: { type: "spring", stiffness: 800, damping: 42, mass: 1 },
  /** Wave 2: settings view ↔ tabs (horizontal slide). ζ ≈ 0.9 — settles without a visible bounce. */
  view: { type: "spring", stiffness: 900, damping: 54, mass: 1 },
  /** Wave 2: list reorder (`layout` on rows: pin moves a clip to the top, new clip pushes the list). Critically damped. */
  list: { type: "spring", stiffness: 1100, damping: 66, mass: 1 },
  /** v0.3 Command Bar: pill → command bar expansion (640×420). Snappy, minimal overshoot (ζ ≈ 0.82), settles in ~220 ms. */
  cmdExpand: { type: "spring", stiffness: 850, damping: 48, mass: 1, restDelta: 0.5, restSpeed: 2 },
  /** v0.3 Command Bar: command bar → pill collapse. Critically damped (ζ ≈ 1.00), no bounce, settles in ~180 ms. */
  cmdCollapse: { type: "spring", stiffness: 1400, damping: 75, mass: 1, restDelta: 0.5, restSpeed: 2 },
  /** v0.3 Command Bar: content-based height resize when row/group count changes. Critically damped (ζ ≈ 1.00), no bounce. */
  cmdResize: { type: "spring", stiffness: 950, damping: 52, mass: 1, restDelta: 0.5, restSpeed: 2 },
  /** v0.3 Command Bar: keyboard cursor selection movement between rows. */
  cmdSelect: { type: "spring", stiffness: 1200, damping: 70, mass: 1 },
} satisfies Record<string, Transition>;

/** Durations in seconds (Motion units). CSS mirrors live in tokens.css (--ig-dur-*). */
export const durations = {
  resultStagger: 0.018,
  instant: 0.06,
  fast: 0.1,
  med: 0.16,
  slow: 0.26,
  /** How long the «Скопировано» toast stays in the pill. */
  toastHold: 1.6,
} as const;

/** Cubic-bezier easings (Motion accepts the 4-tuple). */
export const easings = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.5, 0, 0.75, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Content cross-fade inside the island (pill content ↔ panel content). */
export const fades = {
  /** Panel content appears after the shape has started to grow. */
  panelIn: { duration: durations.med, delay: 0.05, ease: easings.out },
  /** Panel content leaves immediately, faster than the shape shrinks. */
  panelOut: { duration: durations.fast * 0.7, ease: easings.in },
  /** Pill content (clock, activity) swap. */
  pillSwap: { duration: durations.fast, ease: easings.out },
  /** Pill content comes back after the shape has started to shrink. */
  pillIn: { duration: durations.fast, delay: 0.04, ease: easings.out },
  /** Pill content leaves (the panel layer takes over). */
  pillOut: { duration: durations.instant, ease: easings.in },
} satisfies Record<string, Transition>;

/** Content layers only ever animate opacity + transform (never `filter: blur`, it costs a GPU pass per frame). */
export const layerScale = {
  /** Panel content scales up from this on enter … */
  panelEnter: 0.96,
  /** … and down to this on exit. */
  panelExit: 0.98,
} as const;

/** Tab content slide (px) when switching tabs. */
export const tabSlide = { enter: 6, exit: -4 } as const;

/** Wave 2: settings view slide (px, x axis). Opening: settings come from the right; «Назад» reverses the sign. */
export const viewSlide = { enter: 16, exit: -12 } as const;

/** Wave 2: list rows. New clip drops in from above, deleted row fades without animating height. Use with springs.list. */
export const listItem = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: durations.med, ease: easings.in } },
} as const;

/** v0.3: command bar list rows. Quick fade + subtle translate without height jumping. */
export const cmdItem = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: easings.out } },
  exit: { opacity: 0, transition: { duration: 0.06, ease: easings.in } },
} as const;

/**
 * fx: artwork flip on track change (src/design/fx/CoverFlip.tsx, spec §9b.1). One continuous move: the cover hops toward
 * the viewer and turns 360° around X; the new track shows on the back face and is on the front again at 360°.
 * The turn is a tween (180° at ≈ 45 % of the time); the hop is a keyframe track peaking at `lift.peak`.
 */
export const coverFlip = {
  duration: 0.68,
  /** Rotation curve of a fresh flip: slow take-off, so the turn happens "in the air". */
  ease: [0.5, 0, 0.3, 1],
  /** A flip retargeted mid-air (another track change) keeps moving instead of starting from rest. */
  retargetEase: easings.out,
  perspective: 720,
  lift: { y: -12, scale: 1.12, peak: 0.4 },
  /** Reduced motion and a late artwork for the same track: plain cross-fade. */
  fade: { duration: 0.14, ease: easings.out },
} as const;

/**
 * fx: ring of light over the whole island when the dock gets a new item (src/design/fx/AttachWave.tsx, spec §9b.2).
 * The ring starts at the new dock entry and grows (scale) past the farthest island corner while it fades (opacity).
 */
export const attachWave = {
  duration: 0.8,
  ease: easings.out,
  /** Ring band at full size, px; its soft edges come from the radial-gradient, not from `filter`. */
  band: 64,
  peakOpacity: 0.35,
  /** Opacity keyframe times for [0, peak, 0]: bright early, fading toward the edges. */
  opacityTimes: [0, 0.2, 1],
  startScale: 0.04,
  /** The wave waits until the island is at least this fraction of the panel width (drop → expandNow). */
  readyWidth: 0.92,
  /** The new dock icon pops in: scale keyframes; ~ the overshoot of a ζ ≈ 0.45 spring, which no preset has. */
  pop: { scale: [0.6, 1.08, 1], times: [0, 0.6, 1], duration: 0.36, ease: easings.out },
  /** Reduced motion: no wave, the new icon cross-fades in. */
  highlight: { duration: 0.15, ease: easings.out },
} as const;

/**
 * v0.4/0.5 synced lyrics (spec §6.11). Line scrolling is a CSS transition of `transform: translateY` on each line
 * (one shared offset, staggered delays), so it costs no JS per frame and retargets from the current value when the
 * next line comes early. CSS mirrors: --ig-lyrics-scroll-dur / -stagger / -level-dur / -focus-dur / -bg-dur.
 * No scale anywhere: the active line is emphasised by opacity and a static blur step on its neighbours.
 */
export const lyricsMotion = {
  /** Lines are switched this many ms BEFORE their timestamp, so the scroll lands on the beat, not after it. */
  leadMs: 150,
  scroll: { duration: 0.56, ease: easings.out },
  /** Delay per line below the active one ("liquid" follow-through), capped at `maxStaggerSteps`. */
  stagger: 0.028,
  maxStaggerSteps: 6,
  level: { duration: 0.24, ease: easings.out },
  /** Pill: the current line swaps with a short vertical slide + cross-fade. */
  pillLine: { duration: 0.22, ease: easings.out, shift: 8 },
  /** Palette cross-fade on track change and tint on/off. */
  background: { duration: 0.4, ease: easings.inOut },
  tintIn: { duration: 0.26, ease: easings.out },
  /** After the user scrolls the lyrics by hand, auto-follow resumes after this pause. */
  browseResumeMs: 3000,
  /** A pause between lines longer than this shows the "• • •" interlude line. */
  interludeMs: 6000,
} as const;

/** Scale under the pointer for controls (use with springs.press). */
export const pressScale = 0.96;

/** Damping ratio ζ of a spring preset (mass defaults to 1). ζ < 1 overshoots, ζ ≥ 1 does not. */
export function dampingRatio(spring: { stiffness: number; damping: number; mass?: number }): number {
  const mass = spring.mass ?? 1;
  return spring.damping / (2 * Math.sqrt(spring.stiffness * mass));
}

/** Peak overshoot (fraction of the distance) of an underdamped spring released from rest. 0 when ζ ≥ 1. */
export function overshoot(spring: { stiffness: number; damping: number; mass?: number }): number {
  const zeta = dampingRatio(spring);
  if (zeta >= 1) return 0;
  return Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}
