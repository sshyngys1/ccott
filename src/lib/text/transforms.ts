// The transform registry used by the «Текст» tab: id → pure function (text → result).
import { base64Decode, base64Encode } from "./base64";
import { toLower, toSentenceCase, toTitleCase, toUpper } from "./caseTransform";
import { jsonMinify, jsonPretty } from "./json";
import { convertLayout } from "./layout";
import { transliterate } from "./translit";
import { collapseWhitespace, trimEdges } from "./whitespace";

export type TransformId =
  | "layout"
  | "translit"
  | "upper"
  | "lower"
  | "title"
  | "sentence"
  | "trim"
  | "collapse"
  | "jsonPretty"
  | "jsonMin"
  | "b64enc"
  | "b64dec";

export type TransformResult = { ok: true; value: string } | { ok: false; error: string };

const ok = (value: string): TransformResult => ({ ok: true, value });

export function applyTransform(id: TransformId, text: string): TransformResult {
  switch (id) {
    case "layout":
      return ok(convertLayout(text).text);
    case "translit":
      return ok(transliterate(text));
    case "upper":
      return ok(toUpper(text));
    case "lower":
      return ok(toLower(text));
    case "title":
      return ok(toTitleCase(text));
    case "sentence":
      return ok(toSentenceCase(text));
    case "trim":
      return ok(trimEdges(text));
    case "collapse":
      return ok(collapseWhitespace(text));
    case "jsonPretty":
      return jsonPretty(text);
    case "jsonMin":
      return jsonMinify(text);
    case "b64enc":
      return ok(base64Encode(text));
    case "b64dec":
      return base64Decode(text);
  }
}

/**
 * Applies a transform to the selection (`start < end`) or to the whole text, returns the new text and the range of
 * the replaced part (so the UI can re-select it).
 */
export function applyToRange(
  id: TransformId,
  text: string,
  start: number,
  end: number,
): { ok: true; text: string; selection: [number, number] | null } | { ok: false; error: string } {
  const hasSelection = start !== end && start >= 0 && end <= text.length;
  if (!hasSelection) {
    const r = applyTransform(id, text);
    return r.ok ? { ok: true, text: r.value, selection: null } : r;
  }
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const r = applyTransform(id, text.slice(from, to));
  if (!r.ok) return r;
  return { ok: true, text: text.slice(0, from) + r.value + text.slice(to), selection: [from, from + r.value.length] };
}
