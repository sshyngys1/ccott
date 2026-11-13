import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setLanguage } from "../i18n";
import { APP_VERSION } from "../ipc";
import { WHATS_NEW_STORAGE_KEY } from "../lib/whatsNew/catalog";

Object.defineProperty(navigator, "language", { configurable: true, value: "ru-RU" });
setLanguage("auto");
beforeEach(() => {
  setLanguage("auto");
  // The current version's What's New counts as read, so the first expand opens the tabs; What's New tests clear it.
  if (typeof localStorage !== "undefined") localStorage.setItem(WHATS_NEW_STORAGE_KEY, APP_VERSION);
});

// vitest globals are off, so RTL can't auto-register its cleanup.
afterEach(() => cleanup());
