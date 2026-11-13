import { describe, expect, it } from "vitest";
import type { ClipItem } from "../../shared/types";
import { appLabel, clipMeta, clipTitle, cursorAfterRemoval, cursorIndex, fileCount, groupClips, moveCursor } from "./format";

const NOW = new Date(2026, 9, 27, 15, 30).getTime();
const item = (over: Partial<ClipItem> = {}): ClipItem => ({
  id: 1,
  kind: "text",
  text: "hello",
  preview: "hello",
  sourceApp: "Telegram.exe",
  createdAt: NOW - 5 * 60_000,
  pinned: false,
  ...over,
});

describe("appLabel", () => {
  it("strips .exe and maps well-known apps", () => {
    expect(appLabel("Telegram.exe")).toBe("Telegram");
    expect(appLabel("explorer.exe")).toBe("Проводник");
    expect(appLabel("SnippingTool.exe")).toBe("Ножницы");
    expect(appLabel("WindowsTerminal.exe")).toBe("Терминал");
    expect(appLabel("someapp.exe")).toBe("someapp");
    expect(appLabel("")).toBe("");
  });
});

describe("clipTitle", () => {
  it("collapses multi-line previews", () => {
    expect(clipTitle(item({ preview: "  a\n\n  b\tc " }))).toBe("a b c");
  });
  it("images: screenshot apps vs generic", () => {
    expect(clipTitle(item({ kind: "image", sourceApp: "SnippingTool.exe" }))).toBe("Снимок экрана");
    expect(clipTitle(item({ kind: "image", sourceApp: "paint.exe" }))).toBe("Изображение");
    expect(clipTitle(item({ kind: "image", sourceApp: "" }))).toBe("Изображение");
  });
  it("empty previews get a caption", () => {
    expect(clipTitle(item({ preview: "   " }))).toBe("Пустая запись");
    expect(clipTitle(item({ kind: "files", preview: "" }))).toBe("Файлы");
  });
});

describe("clipMeta", () => {
  it("app · relative time", () => expect(clipMeta(item(), NOW)).toBe("Telegram · 5 мин назад"));
  it("no app", () => expect(clipMeta(item({ sourceApp: "" }), NOW)).toBe("5 мин назад"));
  it("files get a count with a plural form", () => {
    const f = (n: number) => item({ kind: "files", sourceApp: "explorer.exe", text: Array.from({ length: n }, (_, i) => `C:\\f${i}`).join("\n") });
    expect(clipMeta(f(1), NOW)).toBe("1 файл · Проводник · 5 мин назад");
    expect(clipMeta(f(3), NOW)).toBe("3 файла · Проводник · 5 мин назад");
    expect(clipMeta(f(5), NOW)).toBe("5 файлов · Проводник · 5 мин назад");
    expect(fileCount(f(2))).toBe(2);
  });
});

describe("groupClips / cursor", () => {
  const a = item({ id: 1, pinned: true });
  const b = item({ id: 2 });
  const c = item({ id: 3, pinned: true });
  const d = item({ id: 4 });
  const { pinned, recent, ordered } = groupClips([b, a, d, c]);

  it("pinned first, order preserved inside the groups", () => {
    expect(pinned.map((x) => x.id)).toEqual([1, 3]);
    expect(recent.map((x) => x.id)).toEqual([2, 4]);
    expect(ordered.map((x) => x.id)).toEqual([1, 3, 2, 4]);
  });
  it("cursor defaults to the first row", () => {
    expect(cursorIndex(ordered, null)).toBe(0);
    expect(cursorIndex(ordered, 999)).toBe(0);
    expect(cursorIndex(ordered, 2)).toBe(2);
    expect(cursorIndex([], 1)).toBe(-1);
  });
  it("moveCursor clamps at both ends", () => {
    expect(moveCursor(ordered, null, 1)).toBe(3);
    expect(moveCursor(ordered, 4, 1)).toBe(4);
    expect(moveCursor(ordered, 1, -1)).toBe(1);
    expect(moveCursor(ordered, 2, -1)).toBe(3);
    expect(moveCursor([], null, 1)).toBeNull();
  });
  it("cursorAfterRemoval prefers the next row, then the previous", () => {
    expect(cursorAfterRemoval(ordered, 3)).toBe(2);
    expect(cursorAfterRemoval(ordered, 4)).toBe(2);
    expect(cursorAfterRemoval([a], 1)).toBeNull();
    expect(cursorAfterRemoval(ordered, 99)).toBeNull();
  });
});
