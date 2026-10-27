import { useState } from "react";
import { t, useT } from "../../i18n";
import { copyQrImage, type GeneratedQr } from "../../lib/qr/generate";
import { requestShell } from "../../shared/shellBus";

export function QrPanel({qr, onClose}: {qr:GeneratedQr;onClose:()=>void}) {
  useT();
  const [copying,setCopying] = useState(false);
  return <section className="tx-qr" aria-label={t("qrCode")}>
    <img className="tx-qr-image" src={qr.dataUrl} alt={t("qrCode")} />
    <div className="tx-qr-actions">
      <button type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--accent" disabled={copying} onClick={() => {
        setCopying(true);
        void copyQrImage(qr).then((ok) => requestShell({type:"toast",text:t(ok ? "copied" : "couldnTCopy")})).finally(() => setCopying(false));
      }}>{t("qr.copyImage")}</button>
      <button type="button" className="ig-glass-control ig-glass-control--sm" onClick={onClose}>{t("qr.close")}</button>
    </div>
  </section>;
}
