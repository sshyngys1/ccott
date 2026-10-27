// Compact live activity of «Главная»: the playing track in the collapsed pill (spec §6.7).
import { IconMusic } from "../../design/icons";
import { useMediaStore } from "../../lib/media/store";
import { requestShell } from "../../shared/shellBus";
import { Eq } from "./Eq";
import "../../lib/ui.css";

export function MediaPill() {
  const media = useMediaStore((s) => s.media);
  const playing = media.status === "playing";
  return (
    <button
      type="button"
      className="ig-pill-row mod-pill"
      data-state={playing ? "playing" : "paused"}
      onClick={() => requestShell({ type: "openTab", tab: "home" })}
      aria-label={`${playing ? "Играет" : "На паузе"}: ${media.title}${media.artist ? ` — ${media.artist}` : ""}. Открыть плеер`}
    >
      <span className="ig-art ig-art--pill" aria-hidden="true">
        {media.artwork ? <img src={media.artwork} alt="" draggable={false} /> : <IconMusic size={14} />}
      </span>
      <span className="ig-pill-title">
        <b>{media.title || "Без названия"}</b>
        {media.artist ? ` · ${media.artist}` : ""}
      </span>
      <Eq playing={playing} />
    </button>
  );
}
