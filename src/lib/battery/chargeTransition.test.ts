import { describe, expect, it } from "vitest";
import { chargeTransition } from "./chargeTransition";

describe("chargeTransition", () => {
  it("only responds to known charging edges", () => {
    expect(chargeTransition(false, true)).toBe("plug");
    expect(chargeTransition(true, false)).toBe("unplug");
    for (const previous of [undefined, null, true]) expect(chargeTransition(previous, true)).toBeNull();
    expect(chargeTransition(false, false)).toBeNull();
    expect(chargeTransition(true, null)).toBeNull();
  });
});
