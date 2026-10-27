import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setLanguage } from "../i18n";

Object.defineProperty(navigator, "language", { configurable: true, value: "ru-RU" });
setLanguage("auto");
beforeEach(() => setLanguage("auto"));

// vitest globals are off, so RTL can't auto-register its cleanup.
afterEach(() => cleanup());
