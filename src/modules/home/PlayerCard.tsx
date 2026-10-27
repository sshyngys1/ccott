import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { IconMusic, IconNext, IconPause, IconPlay, IconPrevious } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { sourceAppLabel } from "../../lib/media/progress";
import { useMedia, useMediaPosition, useMediaStore } from "../../lib/media/store";
import { formatTrackTime } from "../../lib/time/format";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function PlayerCard() {
  const media = useMedia();
  const positionMs = useMediaPosition();
  const { playPause, next, previous, seek } = useMediaStore.getState();
  // While the thumb is dragged the slider shows the dragged value instead of the live position.
  const [dragMs, setDragMs] = useState<number | null>(null);

  const has = media.hasSession;
  const playing = media.status === "playing";
  const knownDuration = has && media.durationMs > 0;
  const shown = dragMs ?? positionMs;
  const percent = knownDuration ? Math.min(100, Math.max(0, (shown / media.durationMs) * 100)) : 0;

  const commit = () => {
    if (dragMs === null) return;
    void seek(dragMs);
    setDragMs(null);
  };

  return (
    <section className="ig-glass-card hm-player" aria-label="Мини-плеер">
      <div className="hm-player-top">
        <span className="ig-art hm-art-shadow" aria-hidden="true">
          {has && media.artwork ? <img src={media.artwork} alt="" draggable={false} /> : <IconMusic size={32} />}
        </span>
        <div className="hm-meta">
          <span className="mod-caption ig-truncate hm-source" title={has ? sourceAppLabel(media.sourceApp) : undefined}>{has ? `Сейчас играет · ${sourceAppLabel(media.sourceApp) || "плеер"}` : "Плеер"}</span>
          <span className="hm-track ig-truncate" title={has ? media.title : undefined}>
            {has ? media.title || "Без названия" : "Ничего не играет"}
          </span>
          <span className="hm-artist ig-truncate">{has ? media.artist || media.album : "Запустите любой плеер"}</span>
          <div className="hm-controls">
            <motion.button
              type="button"
              className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
              {...tap}
              disabled={!has || !media.canPrevious}
              onClick={() => void previous()}
              aria-label="Предыдущий трек"
            >
              <IconPrevious size={18} />
            </motion.button>
            <motion.button
              type="button"
              className="ig-glass-control ig-glass-control--icon ig-glass-control--round ig-glass-control--lg hm-play"
              {...tap}
              disabled={!has || !media.canPlayPause}
              onClick={() => void playPause()}
              aria-label={playing ? "Пауза" : "Воспроизвести"}
            >
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </motion.button>
            <motion.button
              type="button"
              className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
              {...tap}
              disabled={!has || !media.canNext}
              onClick={() => void next()}
              aria-label="Следующий трек"
            >
              <IconNext size={18} />
            </motion.button>
          </div>
        </div>
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
          onChange={(e) => setDragMs(Number(e.target.value))}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
          style={{ "--ig-value": `${percent}%` } as CSSProperties}
          aria-label="Позиция трека"
          aria-valuetext={knownDuration ? `${formatTrackTime(shown)} из ${formatTrackTime(media.durationMs)}` : undefined}
        />
        <span className="hm-time ig-num">{knownDuration ? formatTrackTime(media.durationMs) : "–:––"}</span>
      </div>
    </section>
  );
}
