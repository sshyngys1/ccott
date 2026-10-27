// Owner: F1. The «Настройки» view inside the expanded panel (spec §6.8). Changes apply immediately via `settings_set`.
// «Фон острова» (vibrancy) is intentionally absent: native blur is unavailable (wave 1 decision).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { APP_VERSION, getAppVersion, invoke, listen } from "../../ipc";
import type { FullscreenApp, MonitorInfo, ThemeMode } from "../../shared/types";
import { useIslandStore } from "../../store";
import { announceUpdate } from "../toast";
import { Segmented, SliderRow } from "./controls";
import { DEFAULT_SUMMON_HOTKEY, formatAcceleratorFromKeyEvent, toggleFullscreenAllowlist } from "./hotkey";
import { MonitorPicker } from "./MonitorPicker";
import { monitorOptions, selectedMonitor } from "./monitors";
import { patchSettings } from "./patchSettings";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "Авто" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
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
  const settings = useIslandStore((s) => s.settings);
  const keyboardFocus = useIslandStore((s) => s.keyboardFocus);
  const availableUpdate = useIslandStore((s) => s.availableUpdate);
  const monitors = useMonitors();
  const fullscreenApps = useFullscreenApps();
  const appVersion = useAppVersion();
  const options = useMemo(() => monitorOptions(monitors), [monitors]);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [checkedUpToDate, setCheckedUpToDate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

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
      setUpdateError("Не удалось проверить обновления");
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
      setUpdateError("Не удалось установить обновление");
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

  return (
    <div className="ig-settings">
      <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-look">
        <h4 id="ig-set-look" className="ig-section-label ig-settings-label">
          Внешний вид
        </h4>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Тема</span>
          </span>
          <Segmented label="Тема" value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => void patchSettings({ theme })} />
        </div>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Монитор</span>
            <span className="ig-setting-row__desc">Где показывать остров</span>
          </span>
          <MonitorPicker value={selectedMonitor(options, settings.monitor)} options={options} onChange={(monitor) => void patchSettings({ monitor })} />
        </div>
        <div className="ig-setting-row">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">{`Версия ${appVersion}`}</span>
            {updateError ? (
              <span className="ig-setting-row__desc">{updateError}</span>
            ) : (
              checkedUpToDate && !availableUpdate && <span className="ig-setting-row__desc">Установлена последняя версия</span>
            )}
          </span>
          <button
            type="button"
            className="ig-glass-control ig-glass-control--sm"
            disabled={checking || installing}
            onClick={() => void onCheckUpdates()}
          >
            Проверить обновления
          </button>
        </div>
        {availableUpdate && (
          <div className="ig-setting-row">
            <span className="ig-setting-row__label">
              <span className="ig-setting-row__title">{`Доступна версия ${availableUpdate.version}`}</span>
              {availableUpdate.notes && <span className="ig-setting-row__desc ig-truncate">{availableUpdate.notes}</span>}
            </span>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm ig-glass-control--accent"
              disabled={installing}
              onClick={() => void onInstallUpdate()}
            >
              Установить и перезапустить
            </button>
          </div>
        )}
        <p className="ig-settings-foot">«Авто» следует теме Windows. Изменения применяются сразу.</p>
      </section>

      <section className="ig-glass-card ig-settings-card" aria-labelledby="ig-set-behaviour">
        <h4 id="ig-set-behaviour" className="ig-section-label ig-settings-label">
          Поведение
        </h4>
        <SwitchRow
          title="Запускать вместе с Windows"
          checked={settings.autostart}
          onChange={(autostart) => void patchSettings({ autostart })}
        />
        <SwitchRow
          title="Не беспокоить"
          description="Без всплывающих сообщений в пилюле"
          checked={settings.doNotDisturb}
          onChange={(doNotDisturb) => void patchSettings({ doNotDisturb })}
        />
        <div className="ig-setting-row ig-setting-row--stacked">
          <span className="ig-setting-row__label">
            <span className="ig-setting-row__title">Вызов острова</span>
            <span className="ig-setting-row__desc">
              {recording ? "Нажмите сочетание…" : settings.summonHotkey ? "Показать или свернуть остров" : "Горячая клавиша выключена"}
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
              aria-label="Вызов острова"
              placeholder="Выключено"
              value={recording ? "Нажмите сочетание…" : settings.summonHotkey}
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
              Сбросить
            </button>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm"
              onClick={() => void applySummonHotkey("")}
            >
              Выключить
            </button>
          </div>
          {hotkeyError && (
            <span className="ig-setting-row__desc ig-hotkey-error" role="alert">
              {hotkeyError}
            </span>
          )}
        </div>
        <SliderRow
          title="Задержка раскрытия"
          value={settings.hoverExpandDelayMs}
          min={0}
          max={1000}
          step={50}
          onCommit={(hoverExpandDelayMs) => void patchSettings({ hoverExpandDelayMs })}
        />
        <SliderRow
          title="Задержка сворачивания"
          value={settings.hoverCollapseDelayMs}
          min={0}
          max={2000}
          step={50}
          onCommit={(hoverCollapseDelayMs) => void patchSettings({ hoverCollapseDelayMs })}
        />
      </section>

      <section className="ig-glass-card ig-settings-card ig-settings-card--wide" aria-labelledby="ig-set-fullscreen">
        <h4 id="ig-set-fullscreen" className="ig-section-label ig-settings-label">
          Полноэкранные приложения
        </h4>
        <SwitchRow
          title="Скрывать в полноэкранных приложениях"
          checked={settings.hideInFullscreen}
          onChange={(hideInFullscreen) => void patchSettings({ hideInFullscreen })}
        />
        {fullscreenApps.length === 0 ? (
          <p className="ig-setting-row__desc ig-fullscreen-empty">Пока не было полноэкранных приложений</p>
        ) : (
          fullscreenApps.map((app) => {
            const allowed = settings.fullscreenAllowlist.some((item) => item.toLowerCase() === app.exe.toLowerCase());
            return (
              <label key={app.exe} className="ig-setting-row">
                <span className="ig-setting-row__label">
                  <span className="ig-setting-row__title ig-truncate">{app.title || app.exe}</span>
                  <span className="ig-setting-row__desc ig-truncate">
                    {app.title ? `${app.exe} · Показывать остров` : "Показывать остров"}
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
          Эксклюзивный полноэкранный режим игр не поддерживается — выберите «в окне без рамки».
        </p>
      </section>
    </div>
  );
}
