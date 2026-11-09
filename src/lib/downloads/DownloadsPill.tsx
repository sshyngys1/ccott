import { getLocale, useT } from "../../i18n";
import { IconDownload } from "../../design/icons";
import { downloadsSummary, downloadsTitle } from "./format";
import { openDownload, useDownloadsStore } from "./store";
import "../ui.css";
import "./downloads.css";

export function downloadProgressShift(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const offset = -(100 - clamped) === 0 ? 0 : -(100 - clamped);
  return `translateX(${offset}%)`;
}

export function DownloadsPill() {
  const t = useT();
  const active = useDownloadsStore((s) => s.items).filter((item) => item.state === "active");
  if (!active.length) return null;
  const title = downloadsTitle(active);
  const { detail, percent } = downloadsSummary(active);
  return (
    <button type="button" className="ig-pill-row mod-pill ig-downloads-pill" title={`${title} · ${detail}`}
      aria-label={t("downloads.activity", { name: title, detail })}
      onClick={() => { void openDownload(active[0].id, "reveal"); }}>
      <span className="ig-art ig-art--pill" aria-hidden="true">
        <IconDownload />
      </span>
      <span className="ig-downloads-copy">
        <b className="ig-truncate">{title}</b>
        <span className="ig-truncate ig-num">{detail}</span>
      </span>
      {percent === null ? (
        <span className="ig-downloads-progress" aria-hidden="true">
          <span className="ig-downloads-progress-fill ig-downloads-progress-fill--unknown" />
        </span>
      ) : (
        <span className="ig-downloads-progress" aria-hidden="true">
          <span
            className="ig-downloads-progress-fill"
            style={{ transform: downloadProgressShift(percent) }}
          />
        </span>
      )}
      {percent !== null && <span className="ig-downloads-percent ig-num" role="progressbar" aria-label={t("downloads.progress")}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        {new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: 0 }).format(percent / 100)}
      </span>}
    </button>
  );
}
