import { motion } from "motion/react";
import type { MouseEvent } from "react";
import { IconFile, IconLink, IconPin, IconText, IconTrash } from "../../design/icons";
import { listItem, springs } from "../../design/motion";
import { clipMeta, clipTitle } from "../../lib/clipboard/format";
import type { ClipItem } from "../../shared/types";

const LEAD = { text: IconText, link: IconLink, files: IconFile } as const;

export interface ClipRowProps {
  item: ClipItem;
  now: number;
  cursor: boolean;
  onCursor: () => void;
  onActivate: (mode: "paste" | "copy") => void;
  onPin: () => void;
  onDelete: () => void;
}

export function ClipRow({ item, now, cursor, onCursor, onActivate, onPin, onDelete }: ClipRowProps) {
  const media = item.kind === "image";
  const Lead = item.kind === "image" ? null : LEAD[item.kind];
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <motion.li
      layout="position"
      {...listItem}
      transition={springs.list}
      className="cb-row"
      role="presentation"
      onMouseMove={cursor ? undefined : onCursor}
    >
      <div
        id={`cb-row-${item.id}`}
        className={media ? "ig-list-row ig-list-row--media" : "ig-list-row"}
        role="option"
        aria-selected={cursor}
        tabIndex={cursor ? 0 : -1}
        data-island-keyboard="true"
        onFocus={onCursor}
        onClick={(e) => onActivate(e.shiftKey ? "copy" : "paste")}
        title="Клик — вставить · Shift+клик — только скопировать"
      >
      {media ? (
        <img className="ig-thumb" src={item.preview} alt="Изображение из буфера" draggable={false} />
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
          aria-label={item.pinned ? "Открепить" : "Закрепить"}
          title={item.pinned ? "Открепить (Ctrl+P)" : "Закрепить (Ctrl+P)"}
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
          aria-label="Удалить"
          title="Удалить (Del)"
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
