import { beforeEach, describe, expect, it } from "vitest";
import { HISTORY_LIMIT, resetTextStore, useTextStore } from "./store";

const S = () => useTextStore.getState();

beforeEach(resetTextStore);

describe("text store", () => {
  it("applies a transform to the whole text and remembers the previous text", () => {
    S().edit("привет мир");
    S().apply("upper", 0, 0);
    expect(S()).toMatchObject({ text: "ПРИВЕТ МИР", last: "upper", error: null, history: ["привет мир"], selection: null });
  });

  it("applies to the selection and reports the range to re-select", () => {
    S().edit("abc def ghi");
    S().apply("upper", 4, 7);
    expect(S().text).toBe("abc DEF ghi");
    expect(S().selection).toEqual([4, 7]);
  });

  it("an error leaves the text untouched and does not touch the history", () => {
    S().edit("{oops");
    S().apply("jsonPretty", 0, 0);
    expect(S().text).toBe("{oops");
    expect(S().error).toMatch(/^Неверный JSON/);
    expect(S().last).toBe("jsonPretty");
    expect(S().history).toEqual([]);
  });

  it("any manual edit clears the error and the «last» highlight", () => {
    S().edit("{oops");
    S().apply("jsonPretty", 0, 0);
    S().edit("{oops}");
    expect(S()).toMatchObject({ error: null, last: null });
  });

  it("undo restores the previous text, step by step", () => {
    S().edit("Ab");
    S().apply("upper", 0, 0);
    S().apply("lower", 0, 0);
    expect(S().text).toBe("ab");
    S().undo();
    expect(S().text).toBe("AB");
    S().undo();
    expect(S().text).toBe("Ab");
    S().undo();
    expect(S().text).toBe("Ab");
  });

  it("history is limited to 20 steps", () => {
    S().edit("a");
    for (let i = 0; i < 30; i++) S().apply("b64enc", 0, 0);
    expect(S().history).toHaveLength(HISTORY_LIMIT);
  });

  it("a no-op transform does not add history", () => {
    S().edit("ABC");
    S().apply("upper", 0, 0);
    expect(S().history).toEqual([]);
  });

  it("empty text: nothing happens", () => {
    S().apply("upper", 0, 0);
    expect(S()).toMatchObject({ text: "", error: null, last: null });
  });

  it("prefill does not create history", () => {
    S().prefill("из буфера");
    expect(S()).toMatchObject({ text: "из буфера", history: [] });
  });
});
