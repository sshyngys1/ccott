// Owner: F1 (Frontend-Shell). What's New screen (spec §17).
import { useT } from "../i18n";
import { IconBatteryCharging, IconCheck, IconCleanText, IconCommand, IconDownload, IconFile, IconFolder, IconHome, IconMusic, IconNote } from "../design/icons";
import { acknowledgeWhatsNew, getWhatsNewForVersion, type WhatsNewItem } from "../lib/whatsNew/catalog";
import { useIslandStore } from "../store";
import { APP_VERSION } from "../ipc";
import { normalizeSemver } from "../lib/whatsNew/semver";

interface WhatsNewViewProps {
  version?: string;
  onClose?: () => void;
  showTitle?: boolean;
}

/** Only the keyboard marker is interpreted; all other text remains escaped by React. */
function renderStep(text: string) {
  return text.split(/(\{kbd:[^{}]+\})/g).map((part, index) =>
    index % 2 === 1
      ? <kbd key={index} className="ig-kbd">{part.slice(5, -1)}</kbd>
      : part,
  );
}

export function WhatsNewView({ version = APP_VERSION, onClose, showTitle = true }: WhatsNewViewProps) {
  const t = useT();
  const setView = useIslandStore((s) => s.setView);

  const targetVersion = normalizeSemver(version);
  const items = targetVersion ? getWhatsNewForVersion(targetVersion) : null;
  if (!items || !targetVersion) return null;

  const handleGotIt = () => {
    acknowledgeWhatsNew(targetVersion);
    if (onClose) {
      onClose();
    } else {
      setView("tabs");
    }
  };

  const renderIcon = (type: WhatsNewItem["icon"]) => {
    switch (type) {
      case "player":
        return <IconMusic size={18} />;
      case "spectrum":
        return (
          <span className="ig-eq-static" aria-hidden="true">
            <span style={{ height: "40%" }} />
            <span style={{ height: "85%" }} />
            <span style={{ height: "60%" }} />
            <span style={{ height: "95%" }} />
          </span>
        );
      case "battery":
        return <IconBatteryCharging size={18} />;
      case "changelog":
        return <IconNote size={18} />;
      case "command":
        return <IconCommand />;
      case "shelf":
        return <IconFolder />;
      case "downloads":
        return <IconDownload />;
      case "tiles":
        return <IconHome />;
      case "lite":
        return <IconFile />;
      case "motion":
        return <IconCleanText />;
      default:
        return <IconCheck size={18} />;
    }
  };

  return (
    <div className="ig-whats-new-container" role="region" aria-label={t("whatsNew.title")}>
      <div className="ig-whats-new-header">
        {showTitle && <h3 className="ig-whats-new-title">{t("whatsNew.title")}</h3>}
        <span className="ig-chip ig-chip--accent ig-num">
          {t("whatsNew.version", { version: targetVersion })}
        </span>
      </div>

      <div className="ig-whats-new-list ig-scroll">
        {items.map((item) => (
          <div key={item.id} className="ig-glass-card ig-whats-new-card">
            <div className="ig-whats-new-icon" aria-hidden="true">
              {renderIcon(item.icon)}
            </div>
            <div className="ig-whats-new-content">
              <h4 className="ig-whats-new-item-title">{t(item.titleKey)}</h4>
              <p className="ig-whats-new-item-desc">{t(item.descKey)}</p>
              {item.stepKeys && item.stepKeys.length > 0 && (
                <ul className="ig-whats-new-steps">
                  {item.stepKeys.map((key) => <li key={key}>{renderStep(t(key))}</li>)}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ig-whats-new-footer">
        <button
          type="button"
          className="ig-glass-control ig-glass-control--accent ig-whats-new-btn"
          onClick={handleGotIt}
        >
          {t("whatsNew.gotIt")}
        </button>
      </div>
    </div>
  );
}
