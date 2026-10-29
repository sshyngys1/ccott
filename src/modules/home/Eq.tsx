// Owner: F2 (Frontend-Modules). Four-bar equalizer with measured WASAPI loopback spectrum.
import { useSpectrumBands } from "../../lib/audio/visualizerStore";

export function Eq({ playing }: { playing: boolean }) {
  const [b0, b1, b2, b3] = useSpectrumBands(playing);

  // Map 0..1 amplitude to scale factor: resting at 0.2, dynamic up to 1.0.
  const scale = (val: number) => {
    if (!playing) return 0.2;
    const clamped = Math.max(0, Math.min(1.0, val));
    return Math.round((0.2 + clamped * 0.8) * 100) / 100;
  };

  return (
    <span className="ig-eq" data-playing={playing} aria-hidden="true">
      <i style={{ transform: `scaleY(${scale(b0)})` }} />
      <i style={{ transform: `scaleY(${scale(b1)})` }} />
      <i style={{ transform: `scaleY(${scale(b2)})` }} />
      <i style={{ transform: `scaleY(${scale(b3)})` }} />
    </span>
  );
}
