import { describe, expect, it } from "vitest";
import type { ClipItem } from "../../shared/types";
import { PREFILL_MAX_AGE_MS, isSecretText, pickPrefill } from "./prefill";

const NOW = 10_000_000;
const clip = (over: Partial<ClipItem>): ClipItem => ({
  id: 1,
  kind: "text",
  text: "x",
  preview: "x",
  sourceApp: "",
  createdAt: NOW - 1000,
  pinned: false,
  ...over,
});

describe("pickPrefill", () => {
  it("takes the newest fresh text clip, ignoring pin order", () => {
    const items = [clip({ id: 1, text: "old pinned", pinned: true, createdAt: NOW - 2000 }), clip({ id: 2, text: "newest", createdAt: NOW - 500 })];
    expect(pickPrefill(items, NOW)).toBe("newest");
  });
  it("skips links, images, files, blanks and stale clips", () => {
    expect(pickPrefill([clip({ kind: "link", text: "https://x" })], NOW)).toBeNull();
    expect(pickPrefill([clip({ kind: "image", text: "" })], NOW)).toBeNull();
    expect(pickPrefill([clip({ kind: "files", text: "C:\\a" })], NOW)).toBeNull();
    expect(pickPrefill([clip({ text: "   " })], NOW)).toBeNull();
    expect(pickPrefill([clip({ createdAt: NOW - PREFILL_MAX_AGE_MS - 1 })], NOW)).toBeNull();
  });
  it("skips huge texts", () => {
    expect(pickPrefill([clip({ text: "a".repeat(20_001) })], NOW)).toBeNull();
  });
  it("empty list", () => expect(pickPrefill([], NOW)).toBeNull());
  it("limits freshness to exactly two minutes and rejects future timestamps", () => {
    expect(PREFILL_MAX_AGE_MS).toBe(120_000);
    expect(pickPrefill([clip({ createdAt: NOW - 120_000 })], NOW)).toBe("x");
    expect(pickPrefill([clip({ createdAt: NOW - 120_001 })], NOW)).toBeNull();
    expect(pickPrefill([clip({ createdAt: NOW + 1 })], NOW)).toBeNull();
  });
  it("never prefills a token, even when it is newer than safe text", () => {
    expect(pickPrefill([clip({ text: "MyPassword123!" })], NOW)).toBeNull();
    expect(pickPrefill([clip({ text: "обычный текст", createdAt: NOW - 2000 }), clip({ text: "MyPassword123!" })], NOW)).toBe("обычный текст");
  });
});

describe("isSecretText", () => {
  it.each(["Password123", "pass123!", "PASSWORD1!", "Aa!aaaaa", "Пароль123!", "Aa1" + "🏝".repeat(125)])("recognizes three character classes: %s", (text) => {
    expect(isSecretText(text)).toBe(true);
  });
  it.each(["Aa1!aaa", "a".repeat(129) + "A1!", "обычный текст", "lower1234", "LettersOnly", "Aa1!\nBBBB", "Aa1! aaa"])("keeps non-secret or out-of-range text: %s", (text) => {
    expect(isSecretText(text)).toBe(false);
  });
});
