import { useEffect, useMemo } from "react";
import { useT } from "../../i18n";
import { IconApp } from "../../design/icons";
import { IconShelf } from "../../modules/shelf/IconShelf";
import { retainDock, useDockStore } from "../../lib/dock/store";
import { checkDockAcceptable, useDropChoiceStore } from "./store";
import "./dropChoice.css";

export function DropChoiceView() {
  const t = useT();
  useEffect(() => retainDock(), []);
  const hoveredZone = useDropChoiceStore((s) => s.hoveredZone);
  const paths = useDropChoiceStore((s) => s.paths);
  const dockItems = useDockStore((s) => s.items);
  const dockCheck = useMemo(() => checkDockAcceptable(paths, dockItems), [paths, dockItems]);

  return (
    <div className="ig-drop-choice" role="region" aria-label={t("dropChoice.title")}>
      <header className="ig-drop-choice-head">
        <span className="ig-drop-choice-title">{t("dropChoice.title")}</span>
      </header>
      <div className="ig-drop-choice-grid">
        <div
          data-drop-zone="dock"
          data-active={hoveredZone === "dock" && dockCheck.ok}
          data-disabled={!dockCheck.ok ? "true" : undefined}
          className="ig-glass-card ig-drop-choice-zone ig-drop-choice-zone--dock"
          role="region"
          aria-label={t("dropChoice.dock")}
          aria-disabled={!dockCheck.ok}
          title={!dockCheck.ok && dockCheck.reasonKey ? t(dockCheck.reasonKey) : undefined}
        >
          <div className="ig-drop-choice-icon-wrap" aria-hidden="true">
            <IconApp size={36} />
          </div>
          <div className="ig-drop-choice-info">
            <span className="ig-drop-choice-zone-title">{t("dropChoice.dock")}</span>
            <span className="ig-drop-choice-zone-desc">
              {!dockCheck.ok && dockCheck.reasonKey
                ? t(dockCheck.reasonKey)
                : t("dropChoice.dockDesc")}
            </span>
          </div>
          {!dockCheck.ok && dockCheck.reasonKey && (
            <span className="ig-drop-choice-badge" role="status">
              {t(dockCheck.reasonKey)}
            </span>
          )}
        </div>

        <div
          data-drop-zone="shelf"
          data-active={hoveredZone === "shelf"}
          className="ig-glass-card ig-drop-choice-zone ig-drop-choice-zone--shelf"
          role="region"
          aria-label={t("dropChoice.shelf")}
        >
          <div className="ig-drop-choice-icon-wrap" aria-hidden="true">
            <IconShelf size={36} />
          </div>
          <div className="ig-drop-choice-info">
            <span className="ig-drop-choice-zone-title">{t("dropChoice.shelf")}</span>
            <span className="ig-drop-choice-zone-desc">{t("dropChoice.shelfDesc")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
