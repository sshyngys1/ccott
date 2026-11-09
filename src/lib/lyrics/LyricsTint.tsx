// Owner: F1. The cover-coloured layer of the island (design-spec §6.11.6): two stacked layers, a new palette is written
// to the hidden one and the two cross-fade by `data-on` (opacity only — never an interpolated gradient or filter).
import { useEffect, useState, type CSSProperties } from "react";
import { lyricsPaletteStyle, type LyricsPalette } from "../../design/lyrics";

interface Slots {
  palettes: [LyricsPalette, LyricsPalette];
  active: 0 | 1;
}

export function LyricsTint({ palette, on }: { palette: LyricsPalette; on: boolean }) {
  const [slots, setSlots] = useState<Slots>({ palettes: [palette, palette], active: 0 });
  useEffect(() => {
    setSlots((s) => {
      if (s.palettes[s.active] === palette) return s;
      const next = (1 - s.active) as 0 | 1;
      const palettes: [LyricsPalette, LyricsPalette] = [...s.palettes];
      palettes[next] = palette;
      return { palettes, active: next };
    });
  }, [palette]);
  return (
    <>
      {([0, 1] as const).map((i) => (
        <div key={i} className="ig-lyrics-tint" data-on={on && slots.active === i} style={lyricsPaletteStyle(slots.palettes[i]) as CSSProperties} aria-hidden="true" />
      ))}
    </>
  );
}
