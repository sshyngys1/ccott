import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// The standalone design gallery is a Russian reference document, not part of the shipped app.
// Mock tracks, notes, clipboard content, monitor/device names represent user/OS data.
// Keyboard maps are transformation data; comments and regexes are deliberately not string literals.
const excluded = new Set(["src/lib/text/layout.ts", "src/lib/text/translit.ts"]);

function untranslated(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: string[] = [];
  function isMockData(node: ts.Node): boolean {
    if (filename !== "src/ipc/mock.ts") return false;
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isVariableDeclaration(parent) && parent.name.getText(file) === "TRACKS") return true;
      if (ts.isFunctionDeclaration(parent) && parent.name?.text === "createState") return true;
      if (ts.isPropertyAssignment(parent) && parent.name.getText(file) === "name" && ts.isStringLiteralLike(node)) return true;
    }
    return false;
  }
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && /[А-Яа-яЁё]/u.test(node.text) && !isMockData(node)) {
      problems.push(`${filename}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${node.text.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

it("rejects Cyrillic UI literals (including JSX, templates and escaped Unicode), ignoring comments", () => {
  expect(untranslated('// комментарий\nconst x = "Русский UI"; const y = `Привет ${name}`; const z = <b title="Подпись">Текст</b>;', "example.tsx")).toHaveLength(4);
  expect(untranslated('const x = "\\u041F\\u0440\\u0438\\u0432\\u0435\\u0442";', "example.ts")).toHaveLength(1);
  expect(untranslated('// только комментарий\nconst match = /[а-я]/;', "example.ts")).toEqual([]);
});

it("keeps all production UI literals in the dictionaries", () => {
  const root = resolve("src");
  const problems: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      const name = relative(resolve("."), path).replace(/\\/g, "/");
      if (name === "src/i18n" || name === "src/design/preview" || name === "src/test") continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name) && !excluded.has(name)) problems.push(...untranslated(readFileSync(path, "utf8"), name));
    }
  }
  walk(root);
  expect(problems, "Move UI text to src/i18n/ru.ts and en.ts; do not add broad exclusions").toEqual([]);
});
