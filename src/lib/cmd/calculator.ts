// Owner: F2 (Frontend-Modules). Safe math expression parser & evaluator (spec §6.10, contracts §20).
// Does NOT use eval or Function.
import { getLanguage, type Language } from "../../i18n";
import { formatCmdNumber } from "./format";

export interface MathResult {
  value: string;
  formula: string;
  numericValue: number;
}

export function formatMathNumber(num: number, lang: Language = getLanguage()): string {
  return formatCmdNumber(num, lang);
}

type TokenType =
  | "NUMBER"
  | "PLUS"
  | "MINUS"
  | "MUL"
  | "DIV"
  | "POW"
  | "LPAREN"
  | "RPAREN"
  | "PERCENT"
  | "OF";

interface Token {
  type: TokenType;
  value: number;
  raw: string;
}

export function tokenizeMath(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "+" ) {
      tokens.push({ type: "PLUS", value: 0, raw: "+" });
      i++;
      continue;
    }

    if (ch === "-" || ch === "−" || ch === "–") {
      tokens.push({ type: "MINUS", value: 0, raw: "-" });
      i++;
      continue;
    }

    if (ch === "*" || ch === "×" || ch === "•") {
      tokens.push({ type: "MUL", value: 0, raw: "×" });
      i++;
      continue;
    }

    // Treat 'x' or 'X' as multiplication only if surrounded by numbers, spaces, or parens
    if (ch === "x" || ch === "X") {
      // Check if it's multiplication
      tokens.push({ type: "MUL", value: 0, raw: "×" });
      i++;
      continue;
    }

    if (ch === "/" || ch === "÷" || ch === ":") {
      tokens.push({ type: "DIV", value: 0, raw: "÷" });
      i++;
      continue;
    }

    if (ch === "^") {
      tokens.push({ type: "POW", value: 0, raw: "^" });
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: 0, raw: "(" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: 0, raw: ")" });
      i++;
      continue;
    }

    if (ch === "%") {
      tokens.push({ type: "PERCENT", value: 0, raw: "%" });
      i++;
      continue;
    }

    // Check for "of" or "от" (case insensitive)
    const rest = input.slice(i);
    const ofMatch = /^(?:of|от)(?=[^\p{L}]|$)/iu.exec(rest);
    if (ofMatch) {
      tokens.push({ type: "OF", value: 0, raw: ofMatch[0] });
      i += ofMatch[0].length;
      continue;
    }

    // Number matching (supports both dot and comma as decimal separator)
    if (/\d/.test(ch) || ((ch === "." || ch === ",") && i + 1 < len && /\d/.test(input[i + 1]))) {
      let numStr = "";
      let hasDot = false;
      while (i < len) {
        const c = input[i];
        if (/\d/.test(c)) {
          numStr += c;
          i++;
        } else if ((c === "." || c === ",") && !hasDot && i + 1 < len && /\d/.test(input[i + 1])) {
          hasDot = true;
          numStr += ".";
          i++;
        } else {
          break;
        }
      }
      const val = Number.parseFloat(numStr);
      if (Number.isNaN(val)) return null;
      tokens.push({ type: "NUMBER", value: val, raw: numStr });
      continue;
    }

    // Unknown character -> not a math expression
    return null;
  }

  return tokens.length > 0 ? tokens : null;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  parse(): number {
    // Check for "X% of Y" pattern at top level
    if (
      this.tokens.length >= 3 &&
      this.tokens.some((t) => t.type === "OF")
    ) {
      const ofIdx = this.tokens.findIndex((t) => t.type === "OF");
      const leftTokens = this.tokens.slice(0, ofIdx);
      const rightTokens = this.tokens.slice(ofIdx + 1);

      if (leftTokens.length > 0 && rightTokens.length > 0) {
        const leftParser = new Parser(leftTokens);
        const rightParser = new Parser(rightTokens);
        const percentVal = leftParser.parse(); // e.g. "15%" evaluates to 0.15, or "15" evaluates to 15
        const baseVal = rightParser.parse();
        // If left had %, percentVal is already fraction (e.g. 0.15). If not, divide by 100.
        const hasExplicitPercent = leftTokens.some((t) => t.type === "PERCENT");
        const factor = hasExplicitPercent ? percentVal : percentVal / 100;
        return factor * baseVal;
      }
    }

    const res = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error("Unexpected token");
    }
    return res;
  }

  // expr = term ((+ | -) term)*
  private expr(): number {
    let left = this.term();

    while (this.pos < this.tokens.length) {
      const tok = this.peek();
      if (!tok || (tok.type !== "PLUS" && tok.type !== "MINUS")) {
        break;
      }
      this.next(); // consume + or -

      // Check if next term has a percentage (e.g. 2400 - 15%)
      const isPercentTerm = this.peekHasPercent();
      let right = this.term();

      if (isPercentTerm) {
        // e.g. 2400 - 15% -> 2400 - (2400 * 0.15)
        right = left * right;
      }

      if (tok.type === "PLUS") {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  // Checks if the upcoming factor is followed by a PERCENT token
  private peekHasPercent(): boolean {
    let p = this.pos;
    if (p < this.tokens.length && (this.tokens[p].type === "PLUS" || this.tokens[p].type === "MINUS")) {
      p++;
    }
    if (p < this.tokens.length && this.tokens[p].type === "NUMBER") {
      p++;
      if (p < this.tokens.length && this.tokens[p].type === "PERCENT") {
        return true;
      }
    }
    return false;
  }

  // term = factor ((* | /) factor)*
  private term(): number {
    let left = this.power();

    while (this.pos < this.tokens.length) {
      const tok = this.peek();
      if (!tok || (tok.type !== "MUL" && tok.type !== "DIV")) {
        break;
      }
      this.next(); // consume * or /
      const right = this.power();

      if (tok.type === "MUL") {
        left = left * right;
      } else {
        if (right === 0) throw new Error("Division by zero");
        left = left / right;
      }
    }

    return left;
  }

  // power = factor (^ factor)*
  private power(): number {
    const left = this.factor();

    if (this.pos < this.tokens.length && this.peek()?.type === "POW") {
      this.next(); // consume ^
      const right = this.power(); // right associative
      return Math.pow(left, right);
    }

    return left;
  }

  // factor = (+|-)? primary (%?)
  private factor(): number {
    const tok = this.peek();
    if (!tok) throw new Error("Unexpected end of input");

    let sign = 1;
    if (tok.type === "PLUS") {
      this.next();
    } else if (tok.type === "MINUS") {
      sign = -1;
      this.next();
    }

    let val = this.primary();

    // Check for trailing %
    if (this.pos < this.tokens.length && this.peek()?.type === "PERCENT") {
      this.next();
      val = val / 100;
    }

    return sign * val;
  }

  // primary = NUMBER | LPAREN expr RPAREN
  private primary(): number {
    const tok = this.peek();
    if (!tok) throw new Error("Unexpected end of input");

    if (tok.type === "NUMBER") {
      this.next();
      return tok.value;
    }

    if (tok.type === "LPAREN") {
      this.next(); // consume (
      const val = this.expr();
      const close = this.peek();
      if (!close || close.type !== "RPAREN") {
        throw new Error("Missing closing parenthesis");
      }
      this.next(); // consume )
      return val;
    }

    throw new Error(`Unexpected token ${tok.raw}`);
  }
}

/**
 * Attempts to parse and evaluate the query as a math expression.
 * Returns null if not valid math or if it's just a single number with no operators.
 */
export function evaluateMath(query: string, lang: Language = getLanguage()): MathResult | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Quick check: must contain at least one math symbol (+, -, *, /, ^, %, or "of" / "от")
  if (!(/[+\-−–*×/÷:^%]/i.test(trimmed) || /(?:of|от)(?:[^\p{L}]|$)/iu.test(trimmed))) {
    return null;
  }

  const tokens = tokenizeMath(trimmed);
  if (!tokens || tokens.length === 0) return null;

  // Reject if all tokens are just a single number
  if (tokens.length === 1 && tokens[0].type === "NUMBER") {
    return null;
  }

  try {
    const parser = new Parser(tokens);
    const result = parser.parse();

    if (!Number.isFinite(result)) return null;

    const formatted = formatMathNumber(result, lang);
    // Normalized formula for display
    let formula = trimmed
      .replace(/\*/g, " × ")
      .replace(/\//g, " ÷ ")
      .replace(/-/g, " − ")
      .replace(/\+/g, " + ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      value: formatted,
      formula,
      numericValue: result,
    };
  } catch {
    return null;
  }
}
