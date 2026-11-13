import { useEffect, useRef, useState } from "react";
import { GlassFilters } from "../../design/GlassFilters";
import { useT } from "../../i18n";
import { useLiteSync, useSettingsSync, useThemeSync } from "../useShellSync";
import { SettingsView } from "./SettingsView";
import { readSettingsSection, saveSettingsSection, SETTINGS_SECTIONS, SETTINGS_SECTION_KEY, type SettingsSection } from "./sections";

export function SettingsWindow() {
  const t = useT();
  const [section, setSection] = useState(readSettingsSection);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const content = useRef<HTMLElement>(null);
  const select = (next: SettingsSection) => {
    setSection(next);
    saveSettingsSection(next);
    content.current?.scrollTo?.({ top: 0 });
  };
  useSettingsSync();
  useThemeSync();
  useLiteSync();
  const title = t("settings.windowTitle");
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => {
    const syncSection = (event: StorageEvent) => {
      if (event.key !== SETTINGS_SECTION_KEY) return;
      setSection(readSettingsSection());
      content.current?.scrollTo?.({ top: 0 });
    };
    window.addEventListener("storage", syncSection);
    return () => window.removeEventListener("storage", syncSection);
  }, []);
  return (
    <div className="ig-settings-window">
      <GlassFilters />
      <header className="ig-settings-window__header"><h1>{t("settings")}</h1></header>
      <div className="ig-settings-window__layout">
        <nav className="ig-settings-window__nav ig-scroll" aria-label={t("settings.sections")}>
          {SETTINGS_SECTIONS.map(({ id, key, icon: Icon }, index) => <button key={id}
            ref={node => { buttons.current[index] = node; }} type="button"
            className="ig-settings-window__section" aria-label={t(key)} title={t(key)}
            aria-current={id === section ? "page" : undefined} aria-controls="ig-settings-content"
            tabIndex={id === section ? 0 : -1} onClick={() => select(id)}
            onKeyDown={event => {
              let next: number;
              if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % SETTINGS_SECTIONS.length;
              else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = SETTINGS_SECTIONS.length - 1;
              else if (event.key === "Enter" || event.key === " ") next = index;
              else return;
              event.preventDefault();
              select(SETTINGS_SECTIONS[next].id);
              buttons.current[next]?.focus();
            }}>
            <Icon size={20} /><span>{t(key)}</span>
          </button>)}
        </nav>
        <main ref={content} id="ig-settings-content" className="ig-settings-window__content ig-scroll"
          aria-label={t(SETTINGS_SECTIONS.find(item => item.id === section)!.key)}>
          <SettingsView section={section} />
        </main>
      </div>
    </div>
  );
}
