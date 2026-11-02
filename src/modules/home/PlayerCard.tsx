import { t, useT } from "../../i18n";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CoverFlip } from "../../design/fx/CoverFlip";
import { noteSkip } from "../../design/fx/flip";
import { IconNext, IconPause, IconPlay, IconPrevious } from "../../design/icons";
import { durations, easings, pressScale, springs, tabSlide } from "../../design/motion";
import { sourceAppLabel } from "../../lib/media/progress";
import { useMedia, useMediaStore } from "../../lib/media/store";
import { PlayerSeek } from "./PlayerSeek";

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function PlayerCard() {
  useT();
  const media = useMedia();
  const reduce = useReducedMotion();
  const { playPause, next, previous } = useMediaStore.getState();

  const has = media.hasSession;
  const playing = media.status === "playing";

  return (
    <motion.section
      className="ig-glass-card hm-player"
      aria-label={t("miniPlayer")}
    >
      <div className="hm-player-top">
        <CoverFlip media={media} className="ig-art hm-art-shadow" />
        <div className="hm-meta">
          <span
            className="mod-caption ig-truncate hm-source"
            title={has ? sourceAppLabel(media.sourceApp) : undefined}
          >
            {has ? t("nowPlaying", { p0: sourceAppLabel(media.sourceApp) || t("player") }) : t("playerAlt")}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${has}:${media.sourceApp}:${media.title}:${media.artist}:${media.album}`} className="hm-track-text"
              initial={{ opacity: 0, y: reduce ? 0 : tabSlide.enter }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : tabSlide.exit }}
              transition={{ duration: durations.med, ease: easings.out }}>
              <span className="hm-track ig-truncate" title={has ? media.title : undefined}>
                {has ? media.title || t("untitled") : t("nothingPlaying")}
              </span>
              <span className="hm-artist ig-truncate" title={has ? media.artist || media.album : undefined}>
                {has ? media.artist || media.album : t("openAMediaPlayer")}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="hm-controls">
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost"
          {...tap}
          disabled={!has || !media.canPrevious}
          onClick={() => {
            noteSkip(-1);
            void previous();
          }}
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
          onClick={() => {
            noteSkip(1);
            void next();
          }}
          aria-label={t("nextTrack")}
        >
          <IconNext size={18} />
        </motion.button>
      </div>
      <PlayerSeek />
    </motion.section>
  );
}
