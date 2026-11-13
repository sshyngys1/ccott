// A short soft chime generated with the Web Audio API (no audio files).
// Browsers keep an AudioContext suspended until a user gesture, so `primeAudio()` is called from the «start» click:
// the context is created and resumed there and reused when the timer finishes minutes later.

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  const w = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a user gesture (click on «старт»). Safe everywhere: silently does nothing without Web Audio. */
export function primeAudio(): void {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

/** Notes of the chime, Hz: a gentle rising major triad (E5 · G#5 · B5). */
export const CHIME_NOTES = [659.25, 830.61, 987.77] as const;
const STEP_S = 0.16;
const PEAK_GAIN = 0.12;

/** Plays the chime. Never throws. Returns whether anything was scheduled. */
export function playChime(): boolean {
  try {
    const c = getContext();
    if (!c) return false;
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime + 0.02;
    CHIME_NOTES.forEach((freq, i) => {
      const start = t0 + i * STEP_S;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Soft attack + exponential decay: no click, no harshness.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.95);
    });
    return true;
  } catch {
    return false;
  }
}

/** Tests. */
export function resetChime(): void {
  ctx = null;
}
