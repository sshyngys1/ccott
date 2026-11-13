import { t, useT, localizeMessage } from "../../i18n";
// Owner: F1. Settings window section content. Changes apply immediately via `settings_set`.
// «Фон острова» (vibrancy) is intentionally absent: native blur is unavailable (wave 1 decision).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconChevronDown, IconTrash } from "../../design/icons";
import { APP_VERSION, getAppVersion, invoke, invokeRecentMaximizedApps, listen } from "../../ipc";
import { DEFAULT_QUICK_TILES, SHELF_RETENTION_HOURS, type FeatureId, type FullscreenApp, type LanguageMode, type MonitorInfo, type OcrLanguage, type ThemeMode } from "../../shared/types";
import { getWhatsNewForVersion } from "../../lib/whatsNew/catalog";
import { useIslandStore } from "../../store";
import { announceUpdate } from "../toast";
import { Segmented, SliderRow } from "./controls";
import {
  DEFAULT_AUTO_HIDE_APPS,
  DEFAULT_SUMMON_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
  buildAutoHideAppRows,
  formatAcceleratorFromKeyEvent,
  normalizeAutoHideExe,
  toggleAutoHideApp,
  toggleFullscreenAllowlist,
} from "./hotkey";
import type { SettingsSection } from "./sections";
import { WeatherSettings } from "./WeatherSettings";
import { CurrencyPicker } from "./CurrencyPicker";
import { WhatsNewView } from "../WhatsNewView";
import { MonitorPicker } from "./MonitorPicker";
import { OcrLanguagePicker } from "./OcrLanguagePicker";
import { monitorOptions, selectedMonitor } from "./monitors";
import { patchSettings } from "./patchSettings";
import { useHotkeyStatus } from "../hotkeys";
import { AgentsSettings } from "../../modules/agents/AgentsSettings";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "auto", get label() { return t("auto"); } },
  { value: "light", get label() { return t("light"); } },
  { value: "dark", get label() { return t("dark"); } },
];

const LANGUAGE_OPTIONS: { value: LanguageMode; label: string }[] = [
  { value: "auto", get label() { return t("language.auto"); } },
  { value: "ru", get label() { return t("language.ru"); } },
  { value: "en", get label() { return t("language.en"); } },
];

function useMonitors(): MonitorInfo[] {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    let disposed = false;
    invoke("window_list_monitors").then(
      (list) => !disposed && setMonitors(list),
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, []);
  return monitors;
}

function useFullscreenApps(): FullscreenApp[] {
  const [apps, setApps] = useState<FullscreenApp[]>([]);
  useEffect(() => {
    let disposed = false;
    invoke("window_recent_fullscreen_apps").then(
      (list) => !disposed && setApps(list),
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, []);
  return apps;
}

function useMaximizedApps(): FullscreenApp[] {
  const [apps, setApps] = useState<FullscreenApp[]>([]);
  useEffect(() => {
    let disposed = false;
    invokeRecentMaximizedApps().then(
      (list) => !disposed && setApps(list),
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, []);
  return apps;
}

function useAppVersion(): string {
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => {
    let disposed = false;
    getAppVersion().then(
      (v) => {
        if (!disposed && v) setVersion(v);
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, []);
  return version;
}

interface SwitchRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchRow({ title, description, checked, onChange }: SwitchRowProps) {
  useT();
  return (
    <label className="ig-setting-row">
      <span className="ig-setting-row__label">
        <span className="ig-setting-row__title">{title}</span>
        {description && <span className="ig-setting-row__desc">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="ig-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Section content; omitting section renders the complete control inventory. */
export function SettingsView({ section }: { section?: SettingsSection } = {}) {
  useT();
  const hotkeyStatus = useHotkeyStatus();
  const settings = useIslandStore((s) => s.settings);
  const availableUpdate = useIslandStore((s) => s.availableUpdate);
  const monitors = useMonitors();
  const fullscreenApps = useFullscreenApps();
  const maximizedApps = useMaximizedApps();
  const appVersion = useAppVersion();
  const options = monitorOptions(monitors);
  const [ocrLanguages, setOcrLanguages] = useState<OcrLanguage[]>([]);
  const [ocrLanguagesFailed, setOcrLanguagesFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    invoke("capture_ocr_languages").then(
      (languages) => {
        if (!disposed) setOcrLanguages(languages);
      },
      () => {
        if (!disposed) setOcrLanguagesFailed(true);
      },
    );
    return () => {
      disposed = true;
    };
  }, []);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [checkedUpToDate, setCheckedUpToDate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [newExe, setNewExe] = useState("");
  const [sessionExes, setSessionExes] = useState<string[]>(() => [...settings.autoHideApps]);
  const [dismissedExes, setDismissedExes] = useState<string[]>([]);

  useEffect(() => {
    setSessionExes((prev) => {
      const next = [...prev];
      let changed = false;
      for (const raw of settings.autoHideApps) {
        const exe = raw.trim().toLowerCase();
        if (exe && !next.includes(exe)) {
          next.push(exe);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [settings.autoHideApps]);

  const autoHideRows = buildAutoHideAppRows(settings.autoHideApps, maximizedApps, sessionExes, dismissedExes);

  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const hotkeyInputRef = useRef<HTMLInputElement>(null);
  const [cmdRecording, setCmdRecording] = useState(false);
  const [cmdHotkeyError, setCmdHotkeyError] = useState<string | null>(null);
  const cmdHotkeyInputRef = useRef<HTMLInputElement>(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    setShowWhatsNew(false);
    setRecording(false);
    setCmdRecording(false);
  }, [section]);
  const whatsNewPanel = useRef<HTMLDivElement>(null);
  const whatsNewButton = useRef<HTMLButtonElement>(null);
  const closeWhatsNew = () => {
    setShowWhatsNew(false);
    whatsNewButton.current?.focus();
  };
  useEffect(() => {
    if (showWhatsNew) {
      whatsNewPanel.current?.focus();
      whatsNewPanel.current?.scrollIntoView?.({ block: "start" });
    }
  }, [showWhatsNew]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen("updater://available", (info) => {
      if (!disposed) announceUpdate(info);
    }).then(
      (u) => {
        if (disposed) u();
        else unlisten = u;
      },
      () => {},
    );
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  const onCheckUpdates = async () => {
    setChecking(true);
    setUpdateError(null);
    try {
      const info = await invoke("updater_check");
      announceUpdate(info);
      setCheckedUpToDate(info === null);
    } catch {
      setUpdateError(t("couldnTCheckForUpdates"));
    } finally {
      setChecking(false);
    }
  };

  const onInstallUpdate = async () => {
    setInstalling(true);
    setUpdateError(null);
    try {
      await invoke("updater_install");
    } catch {
      setUpdateError(t("couldnTInstallTheUpdate"));
      setInstalling(false);
    }
  };

  const applySummonHotkey = async (summonHotkey: string) => {
    setRecording(false);
    setHotkeyError(null);
    const err = await patchSettings({ summonHotkey });
    if (err) setHotkeyError(err);
  };

  const onHotkeyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!recording) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setHotkeyError(null);
        setRecording(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const accel = formatAcceleratorFromKeyEvent(e);
    if (accel) {
      void applySummonHotkey(accel);
    }
  };

  const applyCommandHotkey = async (commandHotkey: string) => {
    setCmdRecording(false);
    setCmdHotkeyError(null);
    const err = await patchSettings({ commandHotkey });
    if (err) setCmdHotkeyError(err);
  };

  const onCmdHotkeyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!cmdRecording) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setCmdHotkeyError(null);
        setCmdRecording(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setCmdRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const accel = formatAcceleratorFromKeyEvent(e);
    if (accel) {
      void applyCommandHotkey(accel);
    }
  };
  const onAddAutoHideExe = async () => {
    const exe = normalizeAutoHideExe(newExe);
    if (!exe) return;
    setNewExe("");
    setDismissedExes((prev) => prev.filter((item) => item !== exe));
    setSessionExes((prev) => (prev.includes(exe) ? prev : [...prev, exe]));
    await patchSettings({ autoHideApps: toggleAutoHideApp(settings.autoHideApps, exe, true) });
  };

  const onToggleAutoHideApp = async (exe: string, enabled: boolean) => {
    const norm = exe.trim().toLowerCase();
    setDismissedExes((prev) => prev.filter((item) => item !== norm));
    setSessionExes((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    await patchSettings({ autoHideApps: toggleAutoHideApp(settings.autoHideApps, norm, enabled) });
  };

  const onRemoveAutoHideApp = async (exe: string) => {
    const norm = exe.trim().toLowerCase();
    setSessionExes((prev) => prev.filter((item) => item !== norm));
    setDismissedExes((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    if (settings.autoHideApps.some((item) => item.toLowerCase() === norm)) {
      await patchSettings({ autoHideApps: toggleAutoHideApp(settings.autoHideApps, norm, false) });
    }
  };

  const onResetAutoHideApps = async () => {
    const defaults = [...DEFAULT_AUTO_HIDE_APPS];
    setSessionExes(defaults);
    setDismissedExes([]);
    await patchSettings({ autoHideApps: defaults });
  };

  return (
    <div className="ig-settings" onKeyDown={event => {
      if (showWhatsNew && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeWhatsNew();
      }
    }}>
      {saveError && <p role="alert" className="ig-settings-error">{localizeMessage(saveError)}</p>}
      {(!section || section === "general") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-general">
        <h4 id="ig-set-general" className="ig-section-label ig-settings-label">{t("settings.section.general")}</h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("language.label")}</span>
          </span>
          <Segmented label={t("language.label")} value={settings.language} options={LANGUAGE_OPTIONS} onChange={(language) => void patchSettings({ language })} />
        </div>
        <SwitchRow
          title={t("startWithWindows")}
          checked={settings.autostart}
          onChange={(autostart) => void patchSettings({ autostart })}
        />
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("settings.updates")}</span>
            {updateError ? (
              <span className="ig-setting-row__desc">{localizeMessage(updateError)}</span>
            ) : (
              checkedUpToDate && !availableUpdate && <span className="ig-setting-row__desc">{t("youReUpToDate")}</span>
            )}
          </span>
          <div style={{ display: "flex", gap: "var(--ig-space-1-5)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              disabled={checking || installing}
              onClick={() => void onCheckUpdates()}
            >
              {t("checkForUpdates")}
            </button>
          </div>
        </div>
        {availableUpdate && (
          <div className="ig-setting-row">
            <span className="ig-setting-row__label">
              <span className="ig-setting-row__title">{t("versionIsAvailable", { p0: availableUpdate.version })}</span>
              {availableUpdate.notes && <span className="ig-setting-row__desc ig-truncate">{availableUpdate.notes}</span>}
            </span>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm ig-glass-control--accent"
              disabled={installing}
              onClick={() => void onInstallUpdate()}
            >
              {t("installAndRestart")}</button>
          </div>
        )}
      </section>}
      {(!section || section === "appearance") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-appearance">
        <h4 id="ig-set-appearance" className="ig-section-label ig-settings-label">{t("appearance")}</h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("theme")}</span>
          </span>
          <Segmented label={t("theme")} value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => void patchSettings({ theme })} />
        </div>
        <SwitchRow
          title={t("liteMode.label")}
          description={t("liteMode.hint")}
          checked={settings.liteMode}
          onChange={(liteMode) => void patchSettings({ liteMode })}
        />
        <p className="ig-settings-foot">{t("autoFollowsYourWindowsThemeChangesApplyImmediately")}</p>
      </section>}
      {(!section || section === "island") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-island">
        <h4 id="ig-set-island" className="ig-section-label ig-settings-label">{t("settings.section.island")}</h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("monitor")}</span>
            <span className="ig-setting-row__desc">{t("whereToShowTheIsland")}</span>
          </span>
          <MonitorPicker value={selectedMonitor(options, settings.monitor)} options={options} onChange={(monitor) => void patchSettings({ monitor })} />
        </div>
        <SwitchRow
          title={t("doNotDisturb")}
          description={t("hidePillNotifications")}
          checked={settings.doNotDisturb}
          onChange={(doNotDisturb) => void patchSettings({ doNotDisturb })}
        />
        <SliderRow
          title={t("expandDelay")}
          value={settings.hoverExpandDelayMs}
          min={0}
          max={1000}
          step={50}
          onCommit={(hoverExpandDelayMs) => void patchSettings({ hoverExpandDelayMs })}
        />
        <SliderRow
          title={t("collapseDelay")}
          value={settings.hoverCollapseDelayMs}
          min={0}
          max={2000}
          step={50}
          onCommit={(hoverCollapseDelayMs) => void patchSettings({ hoverCollapseDelayMs })}
        />
      </section>}
      {(!section || section === "island") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-fullscreen">
        <h4 id="ig-set-fullscreen" className="ig-section-label ig-settings-label">{t("fullscreenApps")}</h4>
        <SwitchRow
          title={t("hideInFullscreenApps")}
          checked={settings.hideInFullscreen}
          onChange={(hideInFullscreen) => void patchSettings({ hideInFullscreen })}
        />
        {fullscreenApps.length === 0 ? (
          <p className="ig-setting-row__desc ig-fullscreen-empty">{t("noFullscreenAppsYet")}</p>
        ) : (
          fullscreenApps.map((app) => {
            const allowed = settings.fullscreenAllowlist.some((item) => item.toLowerCase() === app.exe.toLowerCase());
            return (
              <label key={app.exe} className="ig-setting-row">
                <span className="ig-setting-row__label">
                  <span className="ig-setting-row__title ig-truncate">{app.title || app.exe}</span>
                  <span className="ig-setting-row__desc ig-truncate">
                    {app.title ? t("showTheIsland", { p0: app.exe }) : t("showTheIslandAlt")}
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="ig-switch"
                  checked={allowed}
                  onChange={(e) =>
                    void patchSettings({
                      fullscreenAllowlist: toggleFullscreenAllowlist(settings.fullscreenAllowlist, app.exe, e.target.checked),
                    })
                  }
                />
              </label>
            );
          })
        )}
        <p className="ig-settings-foot">
          {t("exclusiveFullscreenIsnTSupportedUseBorderlessWindowedMode")}</p>
      </section>}
      {(!section || section === "island") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-autohide">
        <h4 id="ig-set-autohide" className="ig-section-label ig-settings-label">{t("hideTheIslandOverApps")}</h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <div className="ig-hotkey-controls">
            <input
              type="text"
              className="ig-glass-input ig-autohide-input"
              aria-label={t("addAppExePlaceholder")}
              placeholder={t("addAppExePlaceholder")}
              value={newExe}
              onChange={(e) => setNewExe(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onAddAutoHideExe();
                }
              }}
            />
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void onAddAutoHideExe()}
            >
              {t("addAppExe")}
            </button>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void onResetAutoHideApps()}
            >
              {t("resetToBrowsers")}
            </button>
          </div>
        </div>
        {autoHideRows.length === 0 ? (
          <p className="ig-setting-row__desc ig-fullscreen-empty">{t("noAutoHideAppsYet")}</p>
        ) : (
          autoHideRows.map((row) => {
            const switchId = `ig-autohide-${row.exe.replace(/[^a-z0-9]/gi, "-")}`;
            return (
              <div key={row.exe} className="ig-setting-row">
                <label htmlFor={switchId} className="ig-setting-row__label">
                  <span className="ig-setting-row__title ig-truncate">{row.title}</span>
                  <span className="ig-setting-row__desc ig-truncate">
                    {row.title !== row.exe ? t("hideTheIsland", { p0: row.exe }) : t("hideTheIslandAlt")}
                  </span>
                </label>
                <div className="ig-autohide-row-actions">
                  <input
                    id={switchId}
                    type="checkbox"
                    role="switch"
                    className="ig-switch"
                    checked={row.enabled}
                    onChange={(e) => void onToggleAutoHideApp(row.exe, e.target.checked)}
                  />
                  <button
                    type="button"
                    className="ig-glass-control ig-glass-control--sm ig-glass-control--icon"
                    aria-label={t("removeAppFromList", { p0: row.exe })}
                    title={t("removeAppFromList", { p0: row.exe })}
                    onClick={() => void onRemoveAutoHideApp(row.exe)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
        <p className="ig-settings-foot">{t("hideTheIslandOverAppsHint")}</p>
      </section>}
      {(!section || section === "hotkeys") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-hotkeys">
        <h4 id="ig-set-hotkeys" className="ig-section-label ig-settings-label">{t("settings.section.hotkeys")}</h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("summonTheIsland")}</span>
            <span className="ig-setting-row__desc">
              {recording ? t("pressAShortcut") : settings.summonHotkey ? t("showOrCollapseTheIsland") : t("shortcutIsOff")}
            </span>
          </span>
          <div className="ig-hotkey-controls">
            <input
              ref={hotkeyInputRef}
              type="text"
              readOnly
              data-recording={recording}
              className="ig-glass-input ig-hotkey-input"
              aria-label={t("summonTheIsland")}
              placeholder={t("off")}
              value={recording ? t("pressAShortcut") : settings.summonHotkey}
              onClick={(e) => {
                e.currentTarget.focus();
                setHotkeyError(null);
                setRecording(true);
              }}
              onBlur={() => setRecording(false)}
              onKeyDown={onHotkeyKeyDown}
            />
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void applySummonHotkey(DEFAULT_SUMMON_HOTKEY)}
            >
              {t("reset")}</button>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void applySummonHotkey("")}
            >
              {t("turnOff")}</button>
          </div>
          {hotkeyStatus?.summon === "busy" && <span className="ig-setting-row__desc ig-hotkey-error" role="status">{t("hotkey.busyHint")}</span>}
          {hotkeyError && (
            <span className="ig-setting-row__desc ig-hotkey-error" role="alert">
              {localizeMessage(hotkeyError)}
            </span>
          )}
        </div>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("commandHotkey")}</span>
            <span className="ig-setting-row__desc">
              {cmdRecording ? t("pressAShortcut") : settings.commandHotkey ? t("commandHotkeyDesc") : t("shortcutIsOff")}
            </span>
          </span>
          <div className="ig-hotkey-controls">
            <input
              ref={cmdHotkeyInputRef}
              type="text"
              readOnly
              data-recording={cmdRecording}
              className="ig-glass-input ig-hotkey-input"
              aria-label={t("commandHotkey")}
              placeholder={t("off")}
              value={cmdRecording ? t("pressAShortcut") : settings.commandHotkey}
              onClick={(e) => {
                e.currentTarget.focus();
                setCmdHotkeyError(null);
                setCmdRecording(true);
              }}
              onBlur={() => setCmdRecording(false)}
              onKeyDown={onCmdHotkeyKeyDown}
            />
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              aria-label={`${t("reset")} — ${t("commandHotkey")}`}
              onClick={() => void applyCommandHotkey(DEFAULT_COMMAND_HOTKEY)}
            >
              {t("reset")}</button>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              aria-label={`${t("turnOff")} — ${t("commandHotkey")}`}
              onClick={() => void applyCommandHotkey("")}
            >
              {t("turnOff")}</button>
          </div>
          {hotkeyStatus?.command === "busy" && <span className="ig-setting-row__desc ig-hotkey-error" role="status">{t("hotkey.busyHint")}</span>}
          {cmdHotkeyError && (
            <span className="ig-setting-row__desc ig-hotkey-error" role="alert">
              {localizeMessage(cmdHotkeyError)}
            </span>
          )}
        </div>
      </section>}
      {(!section || section === "features") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-features">
        <h4 id="ig-set-features" className="ig-section-label ig-settings-label">{t("settings.features")}</h4>
        <p className="ig-settings-foot">{t("settings.featuresHint")}</p>
        {(["clipboard", "text", "notes", "shelf", "dock", "battery", "audioMeter", "weather", "lyrics"] as const satisfies readonly FeatureId[]).map(id => (
          <SwitchRow key={id} title={t(`settings.feature.${id}`)} checked={!settings.disabledFeatures.includes(id)}
            onChange={enabled => {
              const disabledFeatures = enabled ? settings.disabledFeatures.filter(feature => feature !== id) : [...settings.disabledFeatures, id];
              void patchSettings({ disabledFeatures }).then(setSaveError);
            }} />
        ))}
        <SwitchRow title={t("control.feature")} checked={!settings.disabledFeatures.includes("control")}
          onChange={enabled => void patchSettings({ disabledFeatures: enabled ? settings.disabledFeatures.filter(id => id !== "control") : [...settings.disabledFeatures, "control"] }).then(setSaveError)} />
        <SwitchRow title={t("downloads.monitor")} checked={settings.downloadsMonitor}
          onChange={downloadsMonitor => void patchSettings({ downloadsMonitor }).then(setSaveError)} />
        <SwitchRow title={t("agents.feature")} checked={!settings.disabledFeatures.includes("agents")}
          onChange={enabled => void patchSettings({ disabledFeatures: enabled ? settings.disabledFeatures.filter(id => id !== "agents") : [...settings.disabledFeatures, "agents"] }).then(setSaveError)} />
      </section>}
      {(!section || section === "agents") && <AgentsSettings />}
      {(!section || section === "home") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-home">
        <h4 id="ig-set-home" className="ig-section-label ig-settings-label">{t("home")}</h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("tiles.title")}</span>
            <span className="ig-setting-row__desc">{t("tiles.desc")}</span>
          </span>
          <div style={{ display: "flex", gap: "var(--ig-space-1-5)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className="ig-setting-row__desc">{t("settings.tilesHint")}</span>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void patchSettings({ quickTiles: DEFAULT_QUICK_TILES.map((tile) => ({ ...tile })) })}
            >
              {t("tiles.reset")}
            </button>
          </div>
        </div>
      </section>}
      {(!section || section === "weather") && <WeatherSettings />}
      {(!section || section === "lyrics") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-lyrics">
        <h4 id="ig-set-lyrics" className="ig-section-label ig-settings-label">{t("lyrics.settings.title")}</h4>
        <SwitchRow title={t("lyrics.settings.search")} description={t("lyrics.settings.searchHint")} checked={settings.lyrics.enabled}
          onChange={enabled => void patchSettings({ lyrics: { ...settings.lyrics, enabled } }).then(setSaveError)} />
        <SwitchRow title={t("lyrics.settings.inPill")} description={t("lyrics.settings.inPillHint")} checked={settings.lyrics.inPill}
          onChange={inPill => void patchSettings({ lyrics: { ...settings.lyrics, inPill } }).then(setSaveError)} />
        <SwitchRow title={t("lyrics.settings.announce")} description={t("lyrics.settings.announceHint")} checked={settings.lyrics.announce}
          onChange={announce => void patchSettings({ lyrics: { ...settings.lyrics, announce } }).then(setSaveError)} />
        <SliderRow title={t("lyrics.settings.offset")} value={settings.lyrics.offsetMs} min={-5000} max={5000} step={50}
          onCommit={offsetMs => void patchSettings({ lyrics: { ...settings.lyrics, offsetMs } }).then(setSaveError)} />
        <div className="ig-setting-row">
          <span className="ig-setting-row__desc">{t("lyrics.settings.offsetHint")}</span>
          <button type="button" className="ig-glass-control ig-glass-control--sm" disabled={settings.lyrics.offsetMs === 0}
            onClick={() => void patchSettings({ lyrics: { ...settings.lyrics, offsetMs: 0 } }).then(setSaveError)}>{t("lyrics.settings.offsetReset")}</button>
        </div>
      </section>}
      {(!section || section === "shelf") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-shelf">
        <h4 id="ig-set-shelf" className="ig-section-label ig-settings-label">{t("shelf.title")}</h4>
        <SwitchRow title={t("shelf.keepAfterDrag")} checked={settings.shelfKeepAfterDrag}
          onChange={(shelfKeepAfterDrag) => void patchSettings({ shelfKeepAfterDrag })} />
        <div className="ig-setting-row ig-setting-row--stacked">
          <label className="ig-setting-row__title" htmlFor="ig-shelf-retention">{t("shelf.retention")}</label>
          <span className="ig-select">
            <select id="ig-shelf-retention" value={settings.shelfRetentionHours}
              onChange={event => void patchSettings({ shelfRetentionHours: Number(event.target.value) })}>
              {SHELF_RETENTION_HOURS.map(hours => <option key={hours} value={hours}>{t(hours === 0 ? "shelf.forever" : hours === 1 ? "shelf.hour" : hours === 24 ? "shelf.day" : hours === 72 ? "shelf.threeDays" : "shelf.week")}</option>)}
            </select>
            <IconChevronDown size={14} />
          </span>
        </div>
      </section>}
      {(!section || section === "capture") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-capture">
        <h4 id="ig-set-capture" className="ig-section-label ig-settings-label">{t("settings.section.capture")}</h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <label className="ig-setting-row__title" htmlFor="ig-ocr-language">{t("ocrLanguage.label")}</label>
          <OcrLanguagePicker
            value={settings.ocrLanguage}
            languages={ocrLanguages}
            onChange={(ocrLanguage) => void patchSettings({ ocrLanguage })}
          />
          <p id="ig-ocr-hint" className="ig-setting-row__desc">{t("ocrLanguage.hint")}</p>
          {ocrLanguagesFailed && <p className="ig-setting-row__desc" role="status">{t("ocrLanguage.loadError")}</p>}
        </div>
      </section>}
      {(!section || section === "command") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-command">
        <h4 id="ig-set-command" className="ig-section-label ig-settings-label">{t("commandHotkey")}</h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <label className="ig-setting-row__title" htmlFor="ig-default-currency">{t("settings.defaultCurrency")}</label>
          <CurrencyPicker value={settings.defaultCurrency}
            onChange={defaultCurrency => void patchSettings({ defaultCurrency }).then(setSaveError)} />
        </div>
      </section>}
      {(!section || section === "about") && <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-about">
        <h4 id="ig-set-about" className="ig-section-label ig-settings-label">{t("settings.section.about")}</h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__title">{t("version", { p0: appVersion })}</span>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              disabled={!getWhatsNewForVersion(appVersion)}
              ref={whatsNewButton}
              onClick={() => showWhatsNew ? closeWhatsNew() : setShowWhatsNew(true)}
            >
              {t("whatsNew.openFromSettings")}
            </button>
        </div>
      {showWhatsNew && <div ref={whatsNewPanel} tabIndex={-1}>
        <WhatsNewView version={appVersion} onClose={closeWhatsNew} />
      </div>}
      </section>}
    </div>
  );
}
