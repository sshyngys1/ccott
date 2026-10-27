import { describe, expect, it } from "vitest";
import { collapseWhitespace, trimEdges } from "./whitespace";

describe("trimEdges", () => {
  it("trims every line and the text edges", () => {
    expect(trimEdges("  a  \n\t b \n")).toBe("a\nb");
  });
  it("drops leading and trailing blank lines but keeps inner ones", () => {
    expect(trimEdges("\n\n a \n\n b \n\n")).toBe("a\n\nb");
  });
  it("normalises CRLF", () => {
    expect(trimEdges(" a \r\n b ")).toBe("a\nb");
  });
  it("whitespace only / empty", () => {
    expect(trimEdges(" \n \t ")).toBe("");
    expect(trimEdges("")).toBe("");
  });
});

describe("collapseWhitespace", () => {
  it("collapses runs of spaces, tabs and NBSP", () => {
    expect(collapseWhitespace("a   b\t\tc  d")).toBe("a b c d");
  });
  it("removes spaces around line breaks and collapses blank lines", () => {
    expect(collapseWhitespace("a  \n   b\n\n\n\n c")).toBe("a\nb\n\nc");
  });
  it("trims the result", () => {
    expect(collapseWhitespace("   x   ")).toBe("x");
  });
  it("empty", () => expect(collapseWhitespace("")).toBe(""));
});
