// Owner: F2 (Frontend-Modules). Four-bar equalizer with measured WASAPI loopback spectrum.
import { useRef } from "react";
import { useSpectrumBars } from "../../lib/audio/visualizerStore";
import { useFeatureEnabled } from "../../lib/features";

export function Eq({ playing }: { playing: boolean }) {
  const enabled = useFeatureEnabled("audioMeter");
  const ref = useRef<HTMLSpanElement>(null);
  useSpectrumBars(ref, playing);

  if (!enabled) return null;

  return (
    <span ref={ref} className="ig-eq" data-playing={playing} aria-hidden="true">
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
    </span>
  );
}
