import { t } from "../../i18n";
// JSON pretty / minify with precise localized error messages.
//
// A small strict RFC 8259 parser is used instead of JSON.parse + JSON.stringify for two reasons:
//  1. engine error messages differ between V8 versions and have no stable line/column;
//  2. number and string literals are kept *verbatim* (12345678901234567890 and 1.0 survive, unlike JSON.parse).

export type JsonResult = { ok: true; value: string } | { ok: false; error: string };

type Node =
  | { t: "lit"; raw: string }
  | { t: "arr"; items: Node[] }
  | { t: "obj"; entries: Array<[string, Node]> };

class JsonSyntaxError extends Error {
  constructor(
    public readonly pos: number,
    public readonly reason: string,
  ) {
    super(reason);
  }
}

const MAX_DEPTH = 400;
const WS = new Set([" ", "\t", "\n", "\r"]);

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Node {
    this.ws();
    const node = this.value(0);
    this.ws();
    if (this.i < this.s.length) throw new JsonSyntaxError(this.i, t("extraTextAfterJson"));
    return node;
  }

  private ws(): void {
    while (this.i < this.s.length && WS.has(this.s[this.i])) this.i++;
  }

  private unexpected(): JsonSyntaxError {
    if (this.i >= this.s.length) return new JsonSyntaxError(this.i, t("unexpectedEndOfText"));
    return new JsonSyntaxError(this.i, t("unexpectedCharacter", { p0: this.s[this.i] }));
  }

  private value(depth: number): Node {
    if (depth > MAX_DEPTH) throw new JsonSyntaxError(this.i, t("nestingIsTooDeep"));
    const c = this.s[this.i];
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return { t: "lit", raw: this.string() };
    if (c === "-" || (c >= "0" && c <= "9")) return { t: "lit", raw: this.number() };
    for (const word of ["true", "false", "null"]) {
      if (this.s.startsWith(word, this.i)) {
        this.i += word.length;
        return { t: "lit", raw: word };
      }
    }
    if (this.i >= this.s.length) throw new JsonSyntaxError(this.i, t("unexpectedEndOfTextExpectedAValue"));
    if (c === "}" || c === "]" || c === ",") throw new JsonSyntaxError(this.i, t("expectedAValueFound", { p0: c }));
    throw this.unexpected();
  }

  private object(depth: number): Node {
    const entries: Array<[string, Node]> = [];
    this.i++; // {
    this.ws();
    if (this.s[this.i] === "}") {
      this.i++;
      return { t: "obj", entries };
    }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') {
        if (this.i >= this.s.length) throw this.unexpected();
        throw new JsonSyntaxError(this.i, t("expectedADoubleQuotedPropertyName"));
      }
      const key = this.string();
      this.ws();
      if (this.s[this.i] !== ":") throw new JsonSyntaxError(this.i, this.i >= this.s.length ? t("unexpectedEndOfTextExpected") : t("expected"));
      this.i++;
      this.ws();
      entries.push([key, this.value(depth + 1)]);
      this.ws();
      const c = this.s[this.i];
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "}") {
        this.i++;
        return { t: "obj", entries };
      }
      throw new JsonSyntaxError(this.i, this.i >= this.s.length ? t("unexpectedEndOfTextExpectedOr") : t("expectedOr"));
    }
  }

  private array(depth: number): Node {
    const items: Node[] = [];
    this.i++; // [
    this.ws();
    if (this.s[this.i] === "]") {
      this.i++;
      return { t: "arr", items };
    }
    for (;;) {
      this.ws();
      items.push(this.value(depth + 1));
      this.ws();
      const c = this.s[this.i];
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "]") {
        this.i++;
        return { t: "arr", items };
      }
      throw new JsonSyntaxError(this.i, this.i >= this.s.length ? t("unexpectedEndOfTextExpectedOrAlt") : t("expectedOrAlt"));
    }
  }

  private string(): string {
    const start = this.i;
    this.i++; // opening quote
    for (;;) {
      if (this.i >= this.s.length) throw new JsonSyntaxError(start, t("unterminatedString"));
      const c = this.s[this.i];
      if (c === '"') {
        this.i++;
        return this.s.slice(start, this.i);
      }
      if (c < " ") throw new JsonSyntaxError(this.i, t("invalidControlCharacterInAStringUseNForALineBreak"));
      if (c === "\\") {
        const e = this.s[this.i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(this.s.slice(this.i + 2, this.i + 6))) throw new JsonSyntaxError(this.i, t("expectedFourHexadecimalDigitsAfterU"));
          this.i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          this.i += 2;
        } else {
          throw new JsonSyntaxError(this.i, t("invalidEscapeSequence"));
        }
        continue;
      }
      this.i++;
    }
  }

  private number(): string {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i, this.i + 400));
    if (!m) throw new JsonSyntaxError(this.i, t("invalidNumber"));
    this.i += m[0].length;
    return m[0];
  }
}

function serialize(node: Node, indent: string, level: number): string {
  if (node.t === "lit") return node.raw;
  const nl = indent ? "\n" + indent.repeat(level + 1) : "";
  const end = indent ? "\n" + indent.repeat(level) : "";
  const sep = indent ? ": " : ":";
  if (node.t === "arr") {
    if (node.items.length === 0) return "[]";
    return "[" + nl + node.items.map((n) => serialize(n, indent, level + 1)).join("," + nl) + end + "]";
  }
  if (node.entries.length === 0) return "{}";
  return "{" + nl + node.entries.map(([k, n]) => k + sep + serialize(n, indent, level + 1)).join("," + nl) + end + "}";
}

/** 1-based line and column (in UTF-16 units) of an offset. */
export function lineColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      last = i;
    }
  }
  return { line, column: Math.min(pos, text.length) - last };
}

function run(text: string, indent: string): JsonResult {
  if (!text.trim()) return { ok: false, get error() { return t("invalidJsonTextIsEmpty"); } };
  try {
    const node = new Parser(text).parse();
    return { ok: true, value: serialize(node, indent, 0) };
  } catch (e) {
    if (e instanceof JsonSyntaxError) {
      const { line, column } = lineColumn(text, e.pos);
      return { ok: false, error: t("invalidJsonLineColumn", { p0: line, p1: column, p2: e.reason }) };
    }
    return { ok: false, get error() { return t("invalidJsonStructureIsTooComplex"); } };
  }
}

/** Pretty-print with a 2-space indent. */
export const jsonPretty = (text: string): JsonResult => run(text, "  ");
/** Remove all insignificant whitespace. */
export const jsonMinify = (text: string): JsonResult => run(text, "");
