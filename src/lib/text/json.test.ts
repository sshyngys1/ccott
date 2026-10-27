import { describe, expect, it } from "vitest";
import { jsonMinify, jsonPretty, lineColumn } from "./json";

const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe("jsonPretty", () => {
  it("formats nested data with 2 spaces", () => {
    const r = jsonPretty('{"a":1,"b":[1,2,{"c":null}],"d":"x"}');
    expect(r).toEqual({
      ok: true,
      value: '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "d": "x"\n}',
    });
  });
  it("empty containers stay compact", () => {
    expect(jsonPretty('{"a":{},"b":[]}')).toEqual({ ok: true, value: '{\n  "a": {},\n  "b": []\n}' });
  });
  it("scalars, unicode and escapes are kept verbatim", () => {
    expect(jsonPretty('"привет\\n\\u0041"')).toEqual({ ok: true, value: '"привет\\n\\u0041"' });
    expect(jsonPretty("  true  ")).toEqual({ ok: true, value: "true" });
  });
  it("big numbers and 1.0 are not mangled", () => {
    expect(jsonMinify('{"id": 12345678901234567890, "x": 1.0, "e": 1E+2}')).toEqual({
      ok: true,
      value: '{"id":12345678901234567890,"x":1.0,"e":1E+2}',
    });
  });
  it("duplicate keys survive", () => {
    expect(jsonMinify('{"a":1,"a":2}')).toEqual({ ok: true, value: '{"a":1,"a":2}' });
  });
});

describe("jsonMinify", () => {
  it("removes whitespace but not inside strings", () => {
    expect(jsonMinify('{\n  "a b": [ 1 , 2 ],\n  "c": " x  y "\n}')).toEqual({ ok: true, value: '{"a b":[1,2],"c":" x  y "}' });
  });
  it("round-trips with pretty", () => {
    const src = '{"k":[1,{"z":false}],"s":"é"}';
    const pretty = jsonPretty(src);
    expect(pretty.ok && jsonMinify(pretty.value)).toEqual({ ok: true, value: src });
  });
});

describe("JSON errors", () => {
  it("missing comma: line, column and expectation (spec example)", () => {
    const r = jsonPretty('{\n  "a": 1,\n  "b": 2\n  "c": 3\n}');
    expect(err(r)).toBe("Неверный JSON: строка 4, символ 3 — ожидалась «,» или «}»");
  });
  it("trailing comma in an object / array", () => {
    expect(err(jsonPretty('{"a":1,}'))).toBe("Неверный JSON: строка 1, символ 8 — ожидалось имя свойства в двойных кавычках");
    expect(err(jsonPretty("[1,2,]"))).toBe("Неверный JSON: строка 1, символ 6 — ожидалось значение, найдено «]»");
  });
  it("single quotes, unquoted keys", () => {
    expect(err(jsonPretty("{'a':1}"))).toMatch(/ожидалось имя свойства/);
    expect(err(jsonPretty("{a:1}"))).toMatch(/ожидалось имя свойства/);
    expect(err(jsonPretty("['a']"))).toMatch(/неожиданный символ «'»/);
  });
  it("missing colon", () => {
    expect(err(jsonPretty('{"a" 1}'))).toBe("Неверный JSON: строка 1, символ 6 — ожидалось «:»");
  });
  it("unexpected end", () => {
    expect(err(jsonPretty('{"a":'))).toMatch(/неожиданный конец текста/);
    expect(err(jsonPretty("[1,2"))).toMatch(/неожиданный конец текста, ожидалась «,» или «\]»/);
  });
  it("unterminated string points at its opening quote", () => {
    expect(err(jsonPretty('{"a":"abc'))).toBe("Неверный JSON: строка 1, символ 6 — строка не закрыта");
  });
  it("raw newline inside a string, bad escape, bad \\u", () => {
    expect(err(jsonPretty('"a\nb"'))).toMatch(/управляющий символ/);
    expect(err(jsonPretty('"a\\qb"'))).toMatch(/escape/);
    expect(err(jsonPretty('"\\u12"'))).toMatch(/\\u/);
  });
  it("bad numbers", () => {
    expect(err(jsonPretty("01"))).toMatch(/лишний текст/);
    expect(err(jsonPretty("-"))).toMatch(/некорректное число/);
    expect(err(jsonPretty("1."))).toMatch(/лишний текст/);
  });
  it("trailing garbage, comments, empty input", () => {
    expect(err(jsonPretty('{"a":1} x'))).toMatch(/лишний текст после JSON/);
    expect(err(jsonPretty('{"a":1 // c\n}'))).toMatch(/ожидалась «,» или «}»/);
    expect(err(jsonPretty("   "))).toBe("Неверный JSON: пустой текст");
    expect(err(jsonMinify(""))).toBe("Неверный JSON: пустой текст");
  });
  it("very deep nesting does not crash", () => {
    const r = jsonPretty("[".repeat(5000) + "]".repeat(5000));
    expect(err(r)).toMatch(/Неверный JSON/);
  });
});

describe("lineColumn", () => {
  it("counts from 1", () => {
    expect(lineColumn("abc", 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumn("ab\n", 3)).toEqual({ line: 2, column: 1 });
  });
});
