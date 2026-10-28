import { t, useT, localizeMessage } from "../../i18n";
// Owner: F1. The «Настройки» view inside the expanded panel (spec §6.8). Changes apply immediately via `settings_set`.
// «Фон острова» (vibrancy) is intentionally absent: native blur is unavailable (wave 1 decision).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconTrash } from "../../design/icons";
import { APP_VERSION, getAppVersion, invoke, invokeRecentMaximizedApps, listen } from "../../ipc";
import type { FullscreenApp, LanguageMode, MonitorInfo, OcrLanguage, ThemeMode } from "../../shared/types";
import { useIslandStore } from "../../store";
import { announceUpdate } from "../toast";
import { Segmented, SliderRow } from "./controls";
import {
  DEFAULT_AUTO_HIDE_APPS,
  DEFAULT_SUMMON_HOTKEY,
  buildAutoHideAppRows,
  formatAcceleratorFromKeyEvent,
  normalizeAutoHideExe,
  toggleAutoHideApp,
  toggleFullscreenAllowlist,
} from "./hotkey";
import { MonitorPicker } from "./MonitorPicker";
import { OcrLanguagePicker } from "./OcrLanguagePicker";
import { monitorOptions, selectedMonitor } from "./monitors";
import { patchSettings } from "./patchSettings";

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

export function SettingsView() {
  useT();
  const settings = useIslandStore((s) => s.settings);
  const keyboardFocus = useIslandStore((s) => s.keyboardFocus);
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
  const hadKeyboardFocusRef = useRef(false);

  // If the island loses native keyboard focus while recording, exit recording mode.
  useEffect(() => {
    if (keyboardFocus) {
      hadKeyboardFocusRef.current = true;
    } else if (hadKeyboardFocusRef.current) {
      hadKeyboardFocusRef.current = false;
      setRecording(false);
    }
  }, [keyboardFocus]);

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
    <div className="ig-settings">
      <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-look">
        <h4 id="ig-set-look" className="ig-section-label ig-settings-label">
          {t("appearance")}</h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("theme")}</span>
          </span>
          <Segmented label={t("theme")} value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => void patchSettings({ theme })} />
        </div>
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("language.label")}</span>
          </span>
          <Segmented label={t("language.label")} value={settings.language} options={LANGUAGE_OPTIONS} onChange={(language) => void patchSettings({ language })} />
        </div>
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
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("monitor")}</span>
            <span className="ig-setting-row__desc">{t("whereToShowTheIsland")}</span>
          </span>
          <MonitorPicker value={selectedMonitor(options, settings.monitor)} options={options} onChange={(monitor) => void patchSettings({ monitor })} />
        </div>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{t("version", { p0: appVersion })}</span>
            {updateError ? (
              <span className="ig-setting-row__desc">{localizeMessage(updateError)}</span>
            ) : (
              checkedUpToDate && !availableUpdate && <span className="ig-setting-row__desc">{t("youReUpToDate")}</span>
            )}
          </span>
          <button
            type="button"
            className="ig-glass-control ig-glass-control--sm"
            disabled={checking || installing}
            onClick={() => void onCheckUpdates()}
          >
            {t("checkForUpdates")}</button>
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
        <p className="ig-settings-foot">{t("autoFollowsYourWindowsThemeChangesApplyImmediately")}</p>
      </section>

      <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-behaviour">
        <h4 id="ig-set-behaviour" className="ig-section-label ig-settings-label">
          {t("behavior")}</h4>
        <SwitchRow
          title={t("startWithWindows")}
          checked={settings.autostart}
          onChange={(autostart) => void patchSettings({ autostart })}
        />
        <SwitchRow
          title={t("doNotDisturb")}
          description={t("hidePillNotifications")}
          checked={settings.doNotDisturb}
          onChange={(doNotDisturb) => void patchSettings({ doNotDisturb })}
        />
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
              data-island-keyboard="true"
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
              onBlur={(e) => {
                if (e.relatedTarget instanceof Node) {
                  setRecording(false);
                }
              }}
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
          {hotkeyError && (
            <span className="ig-setting-row__desc ig-hotkey-error" role="alert">
              {localizeMessage(hotkeyError)}
            </span>
          )}
        </div>
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
      </section>

      <section className="ig-glass-card ig-settings-card ig-settings-card--wide" aria-labelledby="ig-set-fullscreen">
        <h4 id="ig-set-fullscreen" className="ig-section-label ig-settings-label">
          {t("fullscreenApps")}</h4>
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
      </section>

      <section className="ig-glass-card ig-settings-card ig-settings-card--wide" aria-labelledby="ig-set-autohide">
        <h4 id="ig-set-autohide" className="ig-section-label ig-settings-label">
          {t("hideTheIslandOverApps")}
        </h4>
        <div className="ig-setting-row ig-setting-row--stacked">
          <div className="ig-hotkey-controls">
            <input
              type="text"
              data-island-keyboard="true"
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
      </section>
    </div>
  );
}
