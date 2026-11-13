// Owner: motion-fx. Ring of light over the island when a file or app is attached to the dock. Spec: docs/design-spec.md §9b.2.
//
// Lives inside the island (`overflow: hidden` clips the ring to its shape), before the content layers, so it is drawn
// over the island background and under every control. The layer exists only while it animates; a new attach replaces
// it (new key). The new dock icon gets a short pop. Only transform and opacity animate.
import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDockStore } from "../../lib/dock/store";
import { attachWave } from "../motion";
import { islandReady, waveCircle, type AttachSignal } from "./wave";
import "./attachWave.css";

/** How long the wave may wait for the island to open and the new entry to render (frames). */
const MAX_WAIT_FRAMES = 45;

type Wave = { key: number; left: number; top: number; size: number };

/** The app's island: driven by the dock store. */
export function AttachWave() {
  const added = useDockStore((s) => s.lastAdded);
  return <AttachWaveLayer added={added} />;
}

/** Any island (also the designer preview): finds the new entries by `data-dock-id`, the island as their `.ig-glass`. */
export function AttachWaveLayer({ added }: { added: AttachSignal | null }) {
  const reduce = useReducedMotion();
  const [wave, setWave] = useState<Wave | null>(null);
  // A signal from before this island mounted is history, not an attach.
  const seen = useRef(added?.seq ?? 0);

  useEffect(() => {
    if (!added || added.seq === seen.current) return;
    seen.current = added.seq;
    let frame = 0;
    let waited = 0;
    const start = () => {
      const entries = added.ids
        .map((id) => document.querySelector<HTMLElement>(`[data-dock-id="${CSS.escape(id)}"]`))
        .filter((el): el is HTMLElement => el !== null);
      const island = entries[0]?.closest<HTMLElement>(".ig-glass");
      const box = island?.getBoundingClientRect();
      if (!island || !box || !islandReady(box.width, panelWidth(island), attachWave.readyWidth)) {
        if (++waited < MAX_WAIT_FRAMES) frame = requestAnimationFrame(start);
        return;
      }
      for (const entry of entries) pop(entry, reduce ?? false);
      if (reduce) return;
      const at = entries[0].getBoundingClientRect();
      const origin = { x: at.left + at.width / 2 - box.left, y: at.top + at.height / 2 - box.top };
      setWave({ key: added.seq, ...waveCircle(box, origin, attachWave.band) });
    };
    frame = requestAnimationFrame(start);
    return () => cancelAnimationFrame(frame);
  }, [added, reduce]);

  if (!wave) return null;
  const style = { left: wave.left, top: wave.top, width: wave.size, height: wave.size, "--fx-wave-band": `${attachWave.band}px` };
  return (
    <motion.span
      key={wave.key}
      className="fx-wave"
      aria-hidden="true"
      data-testid="fx-wave"
      style={style as CSSProperties}
      initial={{ scale: attachWave.startScale, opacity: 0 }}
      animate={{ scale: 1, opacity: [0, attachWave.peakOpacity, 0] }}
      transition={{
        scale: { duration: attachWave.duration, ease: attachWave.ease },
        opacity: { duration: attachWave.duration, times: [...attachWave.opacityTimes], ease: "linear" },
      }}
      onAnimationComplete={() => setWave((w) => (w?.key === wave.key ? null : w))}
    />
  );
}

function panelWidth(island: HTMLElement): number {
  return parseFloat(getComputedStyle(island).getPropertyValue("--ig-panel-width")) || 0;
}

/** Pop the entry's button (the entry itself when it is the button); reduced motion: a 150 ms cross-fade. */
function pop(entry: HTMLElement, reduce: boolean) {
  const target = entry.matches("button") ? entry : (entry.querySelector<HTMLElement>("button") ?? entry);
  if (reduce) animate(target, { opacity: [0, 1] }, attachWave.highlight);
  else animate(target, { scale: [...attachWave.pop.scale] }, { duration: attachWave.pop.duration, times: [...attachWave.pop.times], ease: attachWave.pop.ease });
}
