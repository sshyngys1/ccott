import { describe, expect, it } from "vitest";
import { BASE64_ERROR, BASE64_NOT_UTF8, base64Decode, base64Encode } from "./base64";

describe("base64Encode", () => {
  it("ASCII", () => expect(base64Encode("Hello")).toBe("SGVsbG8="));
  it("Cyrillic is UTF-8 safe", () => expect(base64Encode("Привет")).toBe("0J/RgNC40LLQtdGC"));
  it("emoji and ZWJ sequences", () => {
    expect(base64Encode("😀")).toBe("8J+YgA==");
    const family = "👨‍👩‍👧";
    const enc = base64Encode(family);
    expect(base64Decode(enc)).toEqual({ ok: true, value: family });
  });
  it("empty", () => expect(base64Encode("")).toBe(""));
  it("large input does not overflow the call stack", () => {
    const big = "я".repeat(200_000);
    expect(base64Decode(base64Encode(big))).toEqual({ ok: true, value: big });
  });
});

describe("base64Decode", () => {
  it("decodes UTF-8", () => {
    expect(base64Decode("0J/RgNC40LLQtdGC")).toEqual({ ok: true, value: "Привет" });
    expect(base64Decode("8J+YgA==")).toEqual({ ok: true, value: "😀" });
  });
  it("ignores whitespace and line breaks", () => {
    expect(base64Decode(" SGVs\nbG8= \n")).toEqual({ ok: true, value: "Hello" });
  });
  it("accepts missing padding and the URL-safe alphabet", () => {
    expect(base64Decode("SGVsbG8")).toEqual({ ok: true, value: "Hello" });
    expect(base64Decode("Pz8_Pz8-")).toEqual({ ok: true, value: "?????>" });
  });
  it("rejects invalid characters, bad length and inner padding", () => {
    for (const bad of ["Hello!", "SGVsbG8=x", "A", "SGV=sbG8", "привет", "===="]) {
      expect(base64Decode(bad)).toEqual({ ok: false, error: BASE64_ERROR });
    }
  });
  it("rejects empty input", () => {
    expect(base64Decode("")).toEqual({ ok: false, error: BASE64_ERROR });
    expect(base64Decode("  \n")).toEqual({ ok: false, error: BASE64_ERROR });
  });
  it("valid Base64 of non-UTF-8 bytes → distinct error", () => {
    expect(base64Decode("/w==")).toEqual({ ok: false, error: BASE64_NOT_UTF8 });
  });
});
