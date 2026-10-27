import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { countText, getLanguage, getLocale, localizeMessage, plural, pluralCategory, resolveLanguage, setLanguage, t, useT } from ".";
import { en } from "./en";
import { ru } from "./ru";
import { base64Decode } from "../lib/text/base64";
import { jsonPretty } from "../lib/text/json";
import { DEFAULT_FOLDER, folderDisplayName } from "../lib/notes/model";
import { formatClockHM, formatRelativeTime, formatShortDate } from "../lib/time/format";
import { convertLayout } from "../lib/text/layout";

afterEach(() => {
  Object.defineProperty(navigator, "language", { configurable: true, value: "ru-RU" });
  setLanguage("auto");
});

describe("language selection and translation", () => {
  it.each([
    ["auto", "ru-RU", "ru"], ["auto", "RU", "ru"], ["auto", "ru-KZ", "ru"],
    ["auto", "en-US", "en"], ["auto", "kk-KZ", "en"], ["auto", "", "en"],
    ["ru", "en-US", "ru"], ["en", "ru-RU", "en"],
  ] as const)("%s / %s resolves to %s", (mode, navigatorLanguage, expected) => {
    expect(resolveLanguage(mode, navigatorLanguage)).toBe(expected);
  });

  it("has the same dictionary keys and parameter names in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(en[key]), key).toEqual(placeholders(ru[key]));
      expect(en[key].trim(), key).not.toBe("");
    }
  });

  it("interpolates parameters literally and leaves unknown placeholders intact", () => {
    setLanguage("en");
    expect(t("clipboard.noResults", { query: "$& {query}" })).toContain("“$& {query}”");
    expect(t("version", { p0: "0.2.0" })).toBe("Version 0.2.0");
    expect(t("version")).toBe("Version {p0}");
    expect(t("hotkey.busy", { shortcut: "Ctrl+I" })).toContain("“Ctrl+I”");
  });

  it("subscribes mounted components and html.lang to explicit and system changes", () => {
    function Label() { const translate = useT(); return <span>{translate("clipboard")}</span>; }
    render(<Label />);
    expect(screen.getByText("Буфер обмена")).toBeInTheDocument();
    act(() => setLanguage("en"));
    expect(screen.getByText("Clipboard")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    Object.defineProperty(navigator, "language", { configurable: true, value: "ru-RU" });
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(getLanguage()).toBe("en"); // explicit choice wins
    act(() => setLanguage("auto"));
    expect(document.documentElement.lang).toBe("ru");
    Object.defineProperty(navigator, "language", { configurable: true, value: "de-DE" });
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByText("Clipboard")).toBeInTheDocument();
    expect(getLocale()).toBe("en-US");
  });

  it("re-localizes cached and native feedback, including nested JSON reasons", () => {
    const json = jsonPretty('{"a":}');
    expect(json.ok).toBe(false);
    const cached = json.ok ? "" : json.error;
    setLanguage("en");
    expect(localizeMessage(cached)).toMatch(/^Invalid JSON: line 1, column \d+ — expected a value, found “}”$/);
    expect(localizeMessage("Сочетание клавиш «Ctrl+I» уже занято другим приложением или системой")).toContain("already used");
    expect(base64Decode("!")).toMatchObject({ ok: false, error: expect.stringContaining("Invalid Base64") });
    expect(localizeMessage("unrecognized OS error")).toBe("unrecognized OS error");
  });

  it("keeps stored data and keyboard conversions independent of UI language", () => {
    const originalFolder = DEFAULT_FOLDER;
    setLanguage("en");
    expect(folderDisplayName(DEFAULT_FOLDER)).toBe("Note");
    expect(DEFAULT_FOLDER).toBe(originalFolder);
    expect(folderDisplayName("Мои идеи")).toBe("Мои идеи");
    expect(convertLayout("Ghbdtn").text).toBe("Привет");
  });
});

describe("locale-aware numbers and dates", () => {
  it.each([[0, "записей"], [1, "запись"], [2, "записи"], [4, "записи"], [5, "записей"], [11, "записей"], [21, "запись"], [22, "записи"], [25, "записей"], [111, "записей"], [1.5, "записи"]] as const)("Russian %s %s", (count, word) => {
    setLanguage("ru");
    expect(countText(count, "records")).toBe(`${count} ${word}`);
  });

  it("uses English one/other and Intl.PluralRules", () => {
    setLanguage("en");
    expect(countText(0, "records")).toBe("0 entries");
    expect(countText(1, "records")).toBe("1 entry");
    expect(countText(2, "records")).toBe("2 entries");
    expect(pluralCategory(22, "ru")).toBe("few");
    expect(pluralCategory(11, "ru")).toBe("many");
    expect(plural(2, { one: "one", other: "other" })).toBe("other");
  });

  it("formats the same date and relative time using the current locale", () => {
    const now = new Date(2026, 9, 27, 14, 32).getTime();
    setLanguage("en");
    expect(formatShortDate(now, now)).toBe("Oct 27");
    expect(formatClockHM(now)).toBe("14:32");
    expect(formatRelativeTime(now - 120000, now)).toBe("2 min ago");
    expect(formatRelativeTime(now - 86400000, now)).toBe("yesterday");
    setLanguage("ru");
    expect(formatShortDate(now, now)).toBe("27 окт");
    expect(formatRelativeTime(now - 120000, now)).toBe("2 мин назад");
  });
});
