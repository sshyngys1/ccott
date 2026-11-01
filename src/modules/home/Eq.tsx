// Owner: F2 (Frontend-Modules). Four-bar equalizer with measured WASAPI loopback spectrum.
import { useRef } from "react";
import { useSpectrumBars } from "../../lib/audio/visualizerStore";

export function Eq({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useSpectrumBars(ref, playing);

  return (
    <span ref={ref} className="ig-eq" data-playing={playing} aria-hidden="true">
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
      <i style={{ transform: "scaleY(0.2)" }} />
    </span>
  );
}
