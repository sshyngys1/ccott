import { t, useT, type TranslationKey } from "../../i18n";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { IconPipette, IconQr, IconRegion, IconScanText, IconScreen, type IconProps } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { runCapture, runPickColor, useCaptureStore } from "../../lib/capture/store";
import type { CaptureAction, CaptureMode } from "../../shared/types";
import "../../lib/ui.css";
import "./home.css";
import { PlayerCard } from "./PlayerCard";
import { VolumeCard } from "./VolumeCard";
import { Dock } from "./Dock";

interface Tool {
  id: string; title: TranslationKey; available: boolean;
  Icon?: (props: IconProps) => ReactNode; mode?: CaptureMode; action?: CaptureAction;
}
const TOOLS: readonly Tool[] = [
  { id:"region", title:"region", available:true, Icon:IconRegion, mode:"region", action:"copy" },
  { id:"screen", title:"fullScreen", available:true, Icon:IconScreen, mode:"screen", action:"copy" },
  { id:"ocr", title:"textFromScreen", available:true, Icon:IconScanText, mode:"region", action:"ocr" },
  { id:"qr", title:"qrCode", available:true, Icon:IconQr, mode:"region", action:"qr" },
  { id:"color", title:"colorPicker", available:true, Icon:IconPipette },
  { id:"text", title:"plainText", available:false },
  { id:"record", title:"screenRecording", available:false },
  { id:"command", title:"command", available:false },
  { id:"more", title:"more", available:false },
];
const tap = { whileTap:{ scale:pressScale }, transition:springs.press } as const;

export function HomeTab() {
  useT();
  const busy = useCaptureStore((s) => s.busy);
  return (
    <div className="hm-home hm-home--with-tools">
      <h2 className="mod-sr-only">{t("home")}</h2>
      <div className="hm-left"><PlayerCard /><VolumeCard /></div>
      <section className="hm-tools" aria-label={t("quickTools")}>
        {TOOLS.filter((tool) => tool.available).map(({ id, title, Icon, mode, action }) => (
          <motion.button key={id} type="button" className="ig-glass-control ig-glass-control--tile" {...tap}
            title={action === "copy" ? t("capture.copyHint") : t(title)} disabled={busy}
            onClick={(event) => { if (id === "color") void runPickColor(); else if (mode && action) void runCapture(mode, action === "copy" && event.shiftKey ? "save" : action); }}>
            {Icon && <Icon />}<span>{t(title)}</span>
          </motion.button>
        ))}
      </section>
      <Dock />
    </div>
  );
}
