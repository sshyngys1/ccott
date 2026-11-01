import { useState, type CSSProperties } from "react";
import { t, useT } from "../../i18n";
import { sameTrack, trackIdentity, type TrackIdentity } from "../../lib/media/progress";
import { useMediaPosition, useMediaStore } from "../../lib/media/store";
import { formatTrackTime } from "../../lib/time/format";

/** One discrete timeline update per second; no continuously animating transparent surface. */
export function PlayerSeek() {
  useT();
  const media = useMediaStore(state => state.media);
  const positionMs = useMediaPosition(1000);
  const [drag, setDrag] = useState<{ track: TrackIdentity; positionMs: number } | null>(null);
  const dragMs = drag && sameTrack(drag.track, media) ? drag.positionMs : null;
  const knownDuration = media.hasSession && media.durationMs > 0;
  const shown = dragMs ?? positionMs;
  // Subpixel changes do not need to repaint the range's gradient. Keep its actual seek value precise.
  const percent = knownDuration ? Math.round(Math.min(100, Math.max(0, (shown / media.durationMs) * 100)) * 10) / 10 : 0;

  const commit = () => {
    if (dragMs !== null) void useMediaStore.getState().seek(dragMs);
    setDrag(null);
  };

  return (
    <div className="hm-seek">
      <span className="hm-time ig-num">{knownDuration ? formatTrackTime(shown) : "–:––"}</span>
      <input
        className="ig-glass-slider"
        type="range"
        min={0}
        max={knownDuration ? media.durationMs : 1}
        step={1}
        value={knownDuration ? Math.round(shown) : 0}
        disabled={!media.hasSession || !media.canSeek || !knownDuration}
        onChange={event => setDrag({ track: trackIdentity(media), positionMs: Number(event.target.value) })}
        onPointerUp={commit}
        onPointerCancel={() => setDrag(null)}
        onKeyUp={commit}
        onBlur={commit}
        style={{ "--ig-value": `${percent}%` } as CSSProperties}
        aria-label={t("trackPosition")}
        aria-valuetext={knownDuration ? t("of", { p0: formatTrackTime(shown), p1: formatTrackTime(media.durationMs) }) : undefined}
      />
      <span className="hm-time ig-num">{knownDuration ? formatTrackTime(media.durationMs) : "–:––"}</span>
    </div>
  );
}
