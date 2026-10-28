/** Wake the actual glass surface; a separate transparent pixel may be culled by Chromium. */
export class CompositorPrewarm {
  private frame: number | null = null;
  private pending: Promise<void> | null = null;
  private resolve: (() => void) | null = null;
  private lastPulse = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(private readonly target: HTMLElement) {}

  pulse(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.disposed || performance.now() - this.lastPulse < 500) return Promise.resolve();
    this.lastPulse = performance.now();
    this.pending = new Promise((resolve) => { this.resolve = resolve; });
    // Below an 8-bit alpha step: no perceptible change, but the real surface must be composited.
    this.target.style.setProperty("--ig-prewarm-alpha", "0.99999");
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => this.finish());
    });
    return this.pending;
  }

  private finish(): void {
    this.frame = null;
    this.target.style.removeProperty("--ig-prewarm-alpha");
    this.resolve?.();
    this.resolve = null;
    this.pending = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.finish();
  }
}
