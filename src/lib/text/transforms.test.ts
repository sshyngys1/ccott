import { describe, expect, it } from "vitest";
import { applyToRange, applyTransform, type TransformId } from "./transforms";

describe("applyTransform", () => {
  it.each<[TransformId, string, string]>([
    ["layout", "Ghbdtn", "Привет"],
    ["translit", "Привет", "Privet"],
    ["upper", "abc я", "ABC Я"],
    ["lower", "ABC Я", "abc я"],
    ["title", "hello world", "Hello World"],
    ["sentence", "HELLO. WORLD", "Hello. World"],
    ["trim", "  a  ", "a"],
    ["collapse", "a    b", "a b"],
    ["jsonPretty", '{"a":1}', '{\n  "a": 1\n}'],
    ["jsonMin", '{ "a" : 1 }', '{"a":1}'],
    ["b64enc", "Привет", "0J/RgNC40LLQtdGC"],
    ["b64dec", "0J/RgNC40LLQtdGC", "Привет"],
  ])("%s", (id, input, expected) => {
    expect(applyTransform(id, input)).toEqual({ ok: true, value: expected });
  });

  it("errors are returned, not thrown", () => {
    expect(applyTransform("jsonPretty", "{")).toMatchObject({ ok: false });
    expect(applyTransform("b64dec", "***")).toMatchObject({ ok: false });
  });
  it("every transform tolerates an empty string", () => {
    for (const id of ["layout", "translit", "upper", "lower", "title", "sentence", "trim", "collapse", "b64enc"] as TransformId[]) {
      expect(applyTransform(id, "")).toEqual({ ok: true, value: "" });
    }
  });
});

describe("applyToRange", () => {
  it("whole text without a selection", () => {
    expect(applyToRange("upper", "abc def", 3, 3)).toEqual({ ok: true, text: "ABC DEF", selection: null });
  });
  it("only the selected part, keeping the rest and reporting the new range", () => {
    expect(applyToRange("upper", "abc def ghi", 4, 7)).toEqual({ ok: true, text: "abc DEF ghi", selection: [4, 7] });
  });
  it("selection length may change", () => {
    expect(applyToRange("b64enc", "a Привет b", 2, 8)).toEqual({ ok: true, text: "a 0J/RgNC40LLQtdGC b", selection: [2, 18] });
  });
  it("reversed selection bounds are handled", () => {
    expect(applyToRange("upper", "abc def", 7, 4)).toEqual({ ok: true, text: "abc DEF", selection: [4, 7] });
  });
  it("errors keep the text untouched", () => {
    expect(applyToRange("jsonPretty", "x {", 2, 3)).toMatchObject({ ok: false });
  });
});
