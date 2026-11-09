import { IconApp, IconCommand, IconFolder, IconHome, IconLyrics, IconScanText, IconScreen, IconSettings, IconSun, IconTerminal } from "../../design/icons";
import { WeatherIcon } from "../../modules/weather/icons";
import { IconInfo } from "./icons";

export const SETTINGS_SECTIONS = [
  { id: "general", key: "settings.section.general", icon: IconSettings },
  { id: "appearance", key: "appearance", icon: IconSun },
  { id: "island", key: "settings.section.island", icon: IconScreen },
  { id: "hotkeys", key: "settings.section.hotkeys", icon: IconCommand },
  { id: "features", key: "settings.features", icon: IconApp },
  { id: "agents", key: "agents.title", icon: IconTerminal },
  { id: "home", key: "home", icon: IconHome },
  { id: "weather", key: "weather.title", icon: WeatherIcon },
  { id: "lyrics", key: "lyrics.settings.title", icon: IconLyrics },
  { id: "shelf", key: "shelf.title", icon: IconFolder },
  { id: "capture", key: "settings.section.capture", icon: IconScanText },
  { id: "command", key: "commandHotkey", icon: IconTerminal },
  { id: "about", key: "settings.section.about", icon: IconInfo },
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number]["id"];
export const SETTINGS_SECTION_KEY = "ig-settings-section";

export function readSettingsSection(): SettingsSection {
  try {
    const saved = localStorage.getItem(SETTINGS_SECTION_KEY);
    return SETTINGS_SECTIONS.find(section => section.id === saved)?.id ?? "general";
  } catch { return "general"; }
}

export function saveSettingsSection(section: SettingsSection): void {
  try { localStorage.setItem(SETTINGS_SECTION_KEY, section); } catch { /* Storage may be disabled. */ }
}
