import { describe, expect, it } from "vitest";
import { resultDelay } from "./commandMotion";

describe("command motion", () => {
  it("staggers rows by 18ms and caps the tail", () => {
    expect(resultDelay(0)).toBe(0);
    expect(resultDelay(1)).toBe(0.018);
    expect(resultDelay(-1)).toBe(0);
    expect(resultDelay(99)).toBe(resultDelay(12));
  });
});
