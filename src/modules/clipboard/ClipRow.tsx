import { t, useT } from "../../i18n";
import { motion, useReducedMotion } from "motion/react";
import { useIslandStore } from "../../store";
import "../../design/fx/feedback.css";
import type { MouseEvent } from "react";
import { IconFile, IconLink, IconPin, IconText, IconTrash } from "../../design/icons";
import { listItem, springs } from "../../design/motion";
import { clipMeta, clipTitle } from "../../lib/clipboard/format";
import type { ClipItem } from "../../shared/types";

const LEAD = { text: IconText, link: IconLink, files: IconFile } as const;

export interface ClipRowProps {
  item: ClipItem;
  now: number;
  highlight?: number;
  cursor: boolean;
  onCursor: () => void;
  onActivate: (mode: "paste" | "copy") => void;
  onPin: () => void;
  onDelete: () => void;
}

export function ClipRow({ item, now, highlight, cursor, onCursor, onActivate, onPin, onDelete }: ClipRowProps) {
  useT();
  const reduce = useReducedMotion();
  const liteMode = useIslandStore(s => s.settings.liteMode);
  const media = item.kind === "image";
  const Lead = item.kind === "image" ? null : LEAD[item.kind];
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <motion.li
      layout={reduce || liteMode ? false : "position"}
      {...listItem}
      initial={reduce ? { opacity: 0 } : listItem.initial}
      transition={springs.list}
      className="cb-row"
      role="presentation"
      onMouseMove={cursor ? undefined : onCursor}
    >
      {highlight && <span key={highlight} className="cb-paste-flash" aria-hidden="true" />}
      <div
        id={`cb-row-${item.id}`}
        className={media ? "ig-list-row ig-list-row--media" : "ig-list-row"}
        role="option"
        aria-selected={cursor}
        tabIndex={cursor ? 0 : -1}
        data-island-keyboard="true"
        onFocus={onCursor}
        onClick={(e) => onActivate(e.shiftKey ? "copy" : "paste")}
        title={t("clickToPasteShiftClickToCopyOnly")}
      >
      {media ? (
        <img className="ig-thumb" src={item.preview} alt={t("imageFromClipboard")} draggable={false} />
      ) : (
        <span className="ig-list-row__lead" data-kind={item.kind} aria-hidden="true">
          {Lead && <Lead size={16} />}
        </span>
      )}
      <span className="ig-list-row__body">
        <span className="ig-list-row__title" data-kind={item.kind}>
          {clipTitle(item)}
        </span>
        <span className="ig-list-row__meta">{clipMeta(item, now)}</span>
      </span>
      <span className="cb-action-space" aria-hidden="true" />
      </div>
      <span className="ig-list-row__actions">
        <button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm"
          aria-pressed={item.pinned}
          aria-label={item.pinned ? t("unpin") : t("pin")}
          title={item.pinned ? t("unpinCtrlP") : t("pinCtrlP")}
          onClick={(e) => {
            stop(e);
            onPin();
          }}
        >
          <IconPin size={16} />
        </button>
        <button
          type="button"
          className="ig-glass-control ig-glass-control--icon ig-glass-control--ghost ig-glass-control--sm ig-glass-control--danger"
          aria-label={t("deleteAlt")}
          title={t("deleteDel")}
          onClick={(e) => {
            stop(e);
            onDelete();
          }}
        >
          <IconTrash size={16} />
        </button>
      </span>
    </motion.li>
  );
}
