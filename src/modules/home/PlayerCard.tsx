import { t, useT } from "../../i18n";
import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { IconMusic, IconNext, IconPause, IconPlay, IconPrevious } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { sameTrack, sourceAppLabel } from "../../lib/media/progress";
import { useMedia, useMediaPosition, useMediaStore } from "../../lib/media/store";
import { formatTrackTime } from "../../lib/time/format";
import type { MediaState } from "../../shared/types";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function PlayerCard() {
  useT();
  const media = useMedia();
  const positionMs = useMediaPosition();
  const { playPause, next, previous, seek } = useMediaStore.getState();
  // While the thumb is dragged the slider shows the dragged value instead of the live position.
  const [drag, setDrag] = useState<{ media: MediaState; positionMs: number } | null>(null);
  const dragMs = drag && sameTrack(drag.media, media) ? drag.positionMs : null;

  const has = media.hasSession;
  const playing = media.status === "playing";
  const knownDuration = has && media.durationMs > 0;
  const shown = dragMs ?? positionMs;
  const percent = knownDuration ? Math.min(100, Math.max(0, (shown / media.durationMs) * 100)) : 0;

  const commit = () => {
    if (dragMs === null) return;
    void seek(dragMs);
    setDrag(null);
  };

  return (
    <section className="ig-glass-card hm-player" aria-label={t("miniPlayer")}>
      <div className="hm-player-top">
        <span className="ig-art hm-art-shadow" aria-hidden="true">
          {has && media.artwork ? <img src={media.artwork} alt="" draggable={false} /> : <IconMusic size={32} />}
        </span>
        <div className="hm-meta">
          <span
            className="mod-caption ig-truncate hm-source"
            title={has ? sourceAppLabel(media.sourceApp) : undefined}
          >
            {has ? t("nowPlaying", { p0: sourceAppLabel(media.sourceApp) || t("player") }) : t("playerAlt")}
          </span>
          <span className="hm-track ig-truncate" title={has ? media.title : undefined}>
            {has ? media.title || t("untitled") : t("nothingPlaying")}
          </span>
          <span className="hm-artist ig-truncate" title={has ? media.artist || media.album : undefined}>
            {has ? media.artist || media.album : t("openAMediaPlayer")}
          </span>
        </div>
      </div>
      <div className="hm-controls">
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
          {...tap}
          disabled={!has || !media.canPrevious}
          onClick={() => void previous()}
          aria-label={t("previousTrack")}
        >
          <IconPrevious size={18} />
        </motion.button>
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg hm-play"
          {...tap}
          disabled={!has || !media.canPlayPause}
          onClick={() => void playPause()}
          aria-label={playing ? t("pause") : t("play")}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </motion.button>
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
          {...tap}
          disabled={!has || !media.canNext}
          onClick={() => void next()}
          aria-label={t("nextTrack")}
        >
          <IconNext size={18} />
        </motion.button>
      </div>
      <div className="hm-seek">
        <span className="hm-time ig-num">{knownDuration ? formatTrackTime(shown) : "–:––"}</span>
        <input
          className="ig-glass-slider"
          type="range"
          min={0}
          max={knownDuration ? media.durationMs : 1}
          step={1}
          value={knownDuration ? Math.round(shown) : 0}
          disabled={!has || !media.canSeek || !knownDuration}
          onChange={(event) => setDrag({ media, positionMs: Number(event.target.value) })}
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
    </section>
  );
}
