import { useT } from "../../i18n";
import type { RadioKind, RadioState } from "../../shared/types";
import { IconBluetooth, IconWifi } from "./icons";
import { useControl } from "./useControl";
import { useFeatureEnabled } from "../../lib/features";
import "./control.css";

export function ControlTab() {
  const enabled = useFeatureEnabled("control");
  if (!enabled) return null;
  return <ControlPanel />;
}

function ControlPanel() {
  const t = useT();
  const control = useControl();
  const { state, pending } = control;
  if (!control.enabled) return null;
  if (!state) return <div className="ig-control-status" role="status">{t(control.failed ? "control.loadFailed" : "control.loading")}{control.failed && <button type="button" className="ig-glass-control" onClick={control.retry}>{t("control.retry")}</button>}</div>;

  const radioTile = (kind: RadioKind, radio: RadioState) => {
    const Icon = kind === "wifi" ? IconWifi : IconBluetooth;
    const subtitle = radio.state === "on" && kind === "wifi" && state.wifiInfo.connected && state.wifiInfo.ssid
      ? state.wifiInfo.ssid : t(`control.${radio.state}`);
    return <button type="button" className="ig-control-radio" aria-label={t(`control.${kind}`)} aria-pressed={radio.state === "on"}
      data-unavailable={radio.state === "unavailable" || undefined} disabled={pending} onClick={() => void control.radio(kind, radio.state !== "on")}
      title={radio.state === "unavailable" ? t("control.radioHint") : subtitle}>
      <Icon size={20} /><span className="ig-control-radio-copy"><strong>{t(`control.${kind}`)}</strong><span title={subtitle}>{subtitle}</span></span>
      {kind === "wifi" && state.wifiInfo.connected && state.wifiInfo.signal !== null && <span className="ig-control-signal" title={t("control.signal", { percent: state.wifiInfo.signal })}>{state.wifiInfo.signal}%</span>}
    </button>;
  };

  return <div className="ig-control" aria-label={t("control.title")}>
    <div className="ig-control-columns">
      <div className="ig-control-settings">
        <div className="ig-control-radios">{radioTile("wifi", state.wifi)}{radioTile("bluetooth", state.bluetooth)}</div>
        <button type="button" className="ig-glass-control ig-control-dark" role="switch" aria-checked={state.darkMode} disabled={pending} onClick={() => void control.dark(!state.darkMode)}>
          <span>{t("control.darkMode")}</span><span>{t(state.darkMode ? "control.on" : "control.off")}</span>
        </button>
        {state.powerMode !== null && <div className="ig-control-power" role="group" aria-label={t("control.powerMode")}>
          <span className="ig-section-label">{t("control.powerMode")}</span>
          <div className="ig-control-segments">{(["efficiency", "balanced", "performance"] as const).map(mode => <button key={mode} type="button" className="ig-glass-control" aria-pressed={state.powerMode === mode} disabled={pending} onClick={() => void control.power(mode)} title={t(`control.${mode}`)}>{t(`control.${mode}`)}</button>)}</div>
        </div>}
      </div>
      <section className="ig-control-devices" aria-label={t("control.devices")}>
        <h3 className="ig-section-label">{t("control.devices")}</h3>
        <div className="ig-control-device-list" tabIndex={0} role="region" aria-label={t("control.devices")}>
          {state.btDevices.length ? <ul>{state.btDevices.map(device => <li key={device.id}>
            <IconBluetooth size={16} /><span className="ig-control-device-copy"><span title={device.name}>{device.name}</span><small>{t(device.connected ? "control.connected" : "control.disconnected")}</small></span>
            {device.battery !== null && <span className="ig-num" aria-label={t("control.battery", { percent: device.battery })}>{device.battery}%</span>}
          </li>)}</ul> : <p className="ig-control-empty">{t("control.empty")}</p>}
        </div>
      </section>
    </div>
    <nav className="ig-control-links" aria-label={t("control.windowsSettings")}>
      <span>{t("control.windowsSettings")}</span>
      {(["wifi", "bluetooth", "colors", "power"] as const).map(page => <button key={page} type="button" className="ig-glass-control ig-glass-control--sm ig-glass-control--ghost" disabled={pending} onClick={() => void control.settings(page)}>{t(`control.${page}`)}</button>)}
    </nav>
  </div>;
}
