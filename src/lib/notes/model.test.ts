import { describe, expect, it } from "vitest";
import type { Note } from "../../shared/types";
import { DEFAULT_FOLDER, deriveTitle, filterNotes, findFolder, folderList, htmlToText, isEmptyBody, normalizeFolderName, noteListTitle, sortNotes } from "./model";

const note = (id: number, folder: string, updatedAt: number): Note => ({ id, folder, title: `n${id}`, body: "", updatedAt });

describe("htmlToText / deriveTitle", () => {
  it("first non-empty block is the title", () => {
    expect(deriveTitle("<h3>Релиз 0.2</h3><p>тело</p>")).toBe("Релиз 0.2");
    expect(deriveTitle("<p></p><p>  вторая  </p>")).toBe("вторая");
  });
  it("line breaks and list items split lines", () => {
    expect(deriveTitle("Привет<br>мир")).toBe("Привет");
    expect(deriveTitle("<ul><li>пункт 1</li><li>пункт 2</li></ul>")).toBe("пункт 1");
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\nb\n");
  });
  it("entities are decoded, tags ignored", () => {
    expect(deriveTitle("<p>1 &lt; 2 &amp; <b>3</b></p>")).toBe("1 < 2 & 3");
  });
  it("long titles are cut with an ellipsis", () => {
    const t = deriveTitle(`<p>${"я".repeat(200)}</p>`);
    expect(t.length).toBe(80);
    expect(t.endsWith("…")).toBe(true);
  });
  it("empty body → empty title", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("<p><br></p>")).toBe("");
  });
  it("does not execute anything while parsing", () => {
    (globalThis as { __pwned?: boolean }).__pwned = false;
    deriveTitle('<img src=x onerror="globalThis.__pwned=true"><p>t</p>');
    expect((globalThis as { __pwned?: boolean }).__pwned).toBe(false);
  });
});

describe("isEmptyBody", () => {
  it("detects visually empty editors", () => {
    expect(isEmptyBody("")).toBe(true);
    expect(isEmptyBody("<p><br></p>")).toBe(true);
    expect(isEmptyBody("<p>&nbsp;</p>")).toBe(true);
    expect(isEmptyBody("<p>x</p>")).toBe(false);
  });
});

describe("folders", () => {
  const notes = [note(1, "Работа", 3), note(2, "Заметка", 2), note(3, "Работа", 1), note(4, "Идеи", 0)];
  it("default folder is always there, counts and ru-alphabetical order", () => {
    expect(folderList(notes)).toEqual([
      { name: "Заметка", count: 1 },
      { name: "Идеи", count: 1 },
      { name: "Работа", count: 2 },
    ]);
    expect(folderList([])).toEqual([{ name: DEFAULT_FOLDER, count: 0 }]);
  });
  it("locally added empty folders appear with 0", () => {
    expect(folderList([], ["Дом"]).map((f) => f.name)).toEqual(["Дом", "Заметка"]);
    expect(folderList(notes, ["Работа"]).find((f) => f.name === "Работа")?.count).toBe(2);
  });
  it("filterNotes: null = all", () => {
    expect(filterNotes(notes, null)).toHaveLength(4);
    expect(filterNotes(notes, "Работа").map((n) => n.id)).toEqual([1, 3]);
    expect(filterNotes(notes, "Нет")).toEqual([]);
  });
  it("sortNotes: newest first, stable by id", () => {
    expect(sortNotes(notes).map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(sortNotes([note(1, "a", 5), note(2, "a", 5)]).map((n) => n.id)).toEqual([2, 1]);
  });
  it("normalizeFolderName", () => {
    expect(normalizeFolderName("  Моя   папка ")).toBe("Моя папка");
    expect(normalizeFolderName("   ")).toBeNull();
    expect(normalizeFolderName("я".repeat(40))).toBe("я".repeat(24));
  });
  it("findFolder is case-insensitive", () => {
    expect(findFolder(["Работа", "Идеи"], "работа")).toBe("Работа");
    expect(findFolder(["Работа"], "Дом")).toBeUndefined();
  });
  it("noteListTitle", () => {
    expect(noteListTitle({ title: "  " })).toBe("Без названия");
    expect(noteListTitle({ title: "X" })).toBe("X");
  });
});
