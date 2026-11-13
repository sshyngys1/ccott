// Whitespace cleanup. Line endings are normalised to "\n".

const normalizeEol = (text: string): string => text.replace(/\r\n?/g, "\n");

/** «Обрезать края»: trims every line and drops empty lines at the start and the end of the text. */
export function trimEdges(text: string): string {
  return normalizeEol(text)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** «Сжать пробелы»: runs of spaces/tabs/NBSP → one space, trailing spaces removed, 2+ blank lines → one; the text is trimmed. */
export function collapseWhitespace(text: string): string {
  return normalizeEol(text)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
