import type { SpectrumBands } from "./visualizerStore";

/** No rAF loop: 20 ms CSS smoothing leaves at least 30 ms between paced DOM samples (20 Hz, the emitter cap). */
const FRAME_MS = 50;

export class SpectrumPainter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPaintAt = Number.NEGATIVE_INFINITY;
  private pending: SpectrumBands | null = null;

  constructor(private readonly bars: NodeListOf<HTMLElement>) {}

  update(bands: SpectrumBands): void {
    this.pending = bands;
    const wait = FRAME_MS - (performance.now() - this.lastPaintAt);
    if (wait <= 0) {
      this.flush();
    } else if (this.timer === null) {
      // One trailing delivery, always of the newest sample; never an animation loop.
      this.timer = setTimeout(() => this.flush(), wait);
    }
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    this.paint(this.pending);
    this.pending = null;
    this.lastPaintAt = performance.now();
  }

  private paint(bands: SpectrumBands): void {
    this.bars.forEach((bar, index) => {
      // 33 heights across the 14px bar (~0.35px steps), including the exact resting height.
      const scale = Math.round((0.2 + bands[index] * 0.8) * 40) / 40;
      const transform = `scaleY(${scale})`;
      if (bar.style.transform !== transform) bar.style.transform = transform;
    });
  }

  /** Safety/lifecycle resets bypass throttling and cannot leave a queued loud frame behind. */
  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.lastPaintAt = Number.NEGATIVE_INFINITY;
    this.paint([0, 0, 0, 0]);
  }
}
