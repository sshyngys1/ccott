import { useSyncExternalStore } from "react";
import type { LanguageMode } from "../shared/types";
import { ru } from "./ru";
import { en } from "./en";

export type Language = "ru" | "en";
export type TranslationKey = keyof typeof ru;
export type Params = Record<string, string | number>;

export function resolveLanguage(mode: LanguageMode, systemLanguage = typeof navigator === "undefined" ? "en" : navigator.language): Language {
  return mode === "auto" ? (systemLanguage.toLowerCase().startsWith("ru") ? "ru" : "en") : mode;
}

let mode: LanguageMode = "auto";
let language = resolveLanguage(mode);
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getLanguage = (): Language => language;
export const getLocale = (): string => language === "ru" ? "ru-RU" : "en-US";

/** Called with every settings snapshot; no dependency on the shell or its store. */
export function setLanguage(next: LanguageMode): void {
  mode = next;
  const resolved = resolveLanguage(mode);
  if (typeof document !== "undefined") document.documentElement.lang = resolved;
  if (resolved === language) return;
  language = resolved;
  for (const notify of listeners) notify();
}
if (typeof window !== "undefined") window.addEventListener("languagechange", () => setLanguage(mode));
setLanguage(mode);

export function t(key: TranslationKey, params: Params = {}): string {
  const message: string = (language === "ru" ? ru : en)[key];
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

/** Subscribe components to live language changes, including components rendered on their own. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return t;
}

export function pluralCategory(count: number, locale: Language = language): Intl.LDMLPluralRule {
  return new Intl.PluralRules(locale).select(count);
}

export function plural(count: number, forms: { one: string; few?: string; many?: string; other: string }): string {
  return forms[pluralCategory(count) as keyof typeof forms] ?? forms.other;
}

export function countText(count: number, noun: "records" | "files" | "chars" | "words" | "lines"): string {
  const category = pluralCategory(count);
  const suffix = category === "one" || category === "few" || category === "many" ? category : "other";
  return t(`${noun}.${suffix}`, { count });
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const messageTemplates = [ru, en].flatMap((dictionary) => (Object.keys(ru) as TranslationKey[]).flatMap((key) => {
  const pattern: string = dictionary[key];
  const names = [...pattern.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  if (!names.length) return [];
  const expression = pattern.split(/\{\w+\}/).map(escapeRegex).join("([\\s\\S]*?)");
  return [{ key, names, expression: new RegExp(`^${expression}$`) }];
}));

/** Re-localize UI-only cached feedback. Never apply to notes, clipboard contents or other user data. */
export function localizeMessage(message: string, depth = 0): string {
  for (const dictionary of [ru, en]) for (const key of Object.keys(ru) as TranslationKey[]) {
    const pattern: string = dictionary[key];
    if (pattern === message) return t(key);
  }
  if (depth < 3) for (const { key, names, expression } of messageTemplates) {
    const match = expression.exec(message);
    if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, localizeMessage(match[i + 1], depth + 1)])));
  }
  return message;
}
