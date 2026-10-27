import { motion } from "motion/react";
import type { ReactNode } from "react";
import {
  IconCleanText,
  IconCode,
  IconCommand,
  IconFolder,
  IconGlobe,
  IconMore,
  IconPipette,
  IconPlus,
  IconQr,
  IconRecord,
  IconRegion,
  IconScanText,
  IconScreen,
  IconSettings,
  IconTerminal,
  type IconProps,
} from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import "../../lib/ui.css";
import "./home.css";
import { PlayerCard } from "./PlayerCard";
import { VolumeCard } from "./VolumeCard";

type Entry = { title: string; Icon: (p: IconProps) => ReactNode };

const TOOLS: Entry[] = [
  { title: "Область", Icon: IconRegion },
  { title: "Весь экран", Icon: IconScreen },
  { title: "Текст с экрана", Icon: IconScanText },
  { title: "QR-код", Icon: IconQr },
  { title: "Пипетка", Icon: IconPipette },
  { title: "Чистый текст", Icon: IconCleanText },
  { title: "Запись экрана", Icon: IconRecord },
  { title: "Команда", Icon: IconCommand },
  { title: "Ещё", Icon: IconMore },
];

const DOCK: Entry[] = [
  { title: "Проводник", Icon: IconFolder },
  { title: "Терминал", Icon: IconTerminal },
  { title: "Редактор кода", Icon: IconCode },
  { title: "Браузер", Icon: IconGlobe },
  { title: "Параметры", Icon: IconSettings },
];

const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;
const SOON = "Скоро";

/** Feature flag: hide unimplemented capture tiles and dock in v0.1 until the screen-capture wave. */
export const SHOW_UPCOMING_TOOLS = false;

export interface HomeTabProps {
  showUpcomingTools?: boolean;
}

export function HomeTab({ showUpcomingTools = SHOW_UPCOMING_TOOLS }: HomeTabProps = {}) {
  return (
    <div className={showUpcomingTools ? "hm-home hm-home--with-tools" : "hm-home"}>
      <h2 className="mod-sr-only">Главная</h2>
      <div className="hm-left">
        <PlayerCard />
        <VolumeCard />
      </div>
      {showUpcomingTools && (
        <>
          {/* Placeholders for now: no action, a «Скоро» tooltip. */}
          <section className="hm-tools" aria-label="Быстрые инструменты">
            {TOOLS.map(({ title, Icon }) => (
              <motion.button key={title} type="button" className="ig-glass-control ig-glass-control--tile" {...tap} title={SOON} aria-disabled="true">
                <Icon />
                <span>{title}</span>
              </motion.button>
            ))}
          </section>
          <section className="ig-glass-card hm-dock" aria-label="Док">
            {DOCK.map(({ title, Icon }) => (
              <motion.button
                key={title}
                type="button"
                className="ig-glass-control ig-glass-control--icon ig-glass-control--lg hm-dock-app"
                {...tap}
                title={`${title} — ${SOON.toLowerCase()}`}
                aria-label={title}
                aria-disabled="true"
              >
                <Icon size={22} />
              </motion.button>
            ))}
            <span className="hm-dock-sep" aria-hidden="true" />
            <button type="button" className="ig-glass-control ig-glass-control--icon ig-glass-control--lg ig-glass-control--ghost hm-dock-add" aria-label="Добавить ярлык" title={SOON} aria-disabled="true">
              <IconPlus />
            </button>
            <span className="hm-dock-hint">Перетащите сюда приложение или папку</span>
          </section>
        </>
      )}
    </div>
  );
}
