import { describe, expect, it } from "vitest";
import { ISLAND_WINDOW } from "./types";

describe("contract constants", () => {
  it("island window fits a 720px-wide panel", () => {
    expect(ISLAND_WINDOW.width).toBeGreaterThanOrEqual(720);
    expect(ISLAND_WINDOW.height).toBeGreaterThan(0);
  });
});
