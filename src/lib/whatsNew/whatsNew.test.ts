import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareSemver, parseSemver } from "./semver";
import {
  acknowledgeWhatsNew,
  getLastAcknowledgedVersion,
  getWhatsNewForVersion,
  shouldAutoShowWhatsNew,
  WHATS_NEW_STORAGE_KEY,
} from "./catalog";

describe("semver", () => {
  it.each(["1.2.3garbage", "1.2.3.4", "01.2.3", "1.2.03", "1.2.3-01", "1.2.3-", "1.2.3+", "9007199254740992.2.3", "1.2.3-a..b"])(
    "rejects malformed or unsafe semver %s", version => expect(parseSemver(version)).toBeNull(),
  );
  it("orders prerelease identifiers and ignores build metadata", () => {
    const ordered = ["1.2.3-alpha", "1.2.3-alpha.1", "1.2.3-alpha.beta", "1.2.3-beta", "1.2.3-beta.2", "1.2.3-beta.11", "1.2.3-rc.1", "1.2.3"];
    for (let i = 1; i < ordered.length; i++) expect(compareSemver(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
    expect(compareSemver("0.2.2-preview.1", "0.2.2")).toBeLessThan(0);
    expect(compareSemver("1.2.3+001", "1.2.3+build.2")).toBe(0);
  });
  it("parses valid semver strings with and without prefix", () => {
    expect(parseSemver("0.2.2")).toEqual([0, 2, 2]);
    expect(parseSemver("v0.2.2")).toEqual([0, 2, 2]);
    expect(parseSemver("1.10.4-beta")).toEqual([1, 10, 4]);
  });

  it("returns null for invalid semver strings", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("invalid")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
  });

  it("compares semver non-lexicographically", () => {
    expect(compareSemver("0.10.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareSemver("0.2.2", "0.2.1")).toBeGreaterThan(0);
    expect(compareSemver("0.2.2", "0.2.2")).toBe(0);
    expect(compareSemver("0.2.1", "0.2.2")).toBeLessThan(0);
  });
});

describe("WhatsNew catalog & auto-show logic", () => {
  it("never downgrades a valid marker through manual acknowledgment", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, "0.3.0");
    acknowledgeWhatsNew("0.2.2");
    expect(getLastAcknowledgedVersion()).toBe("0.3.0");
    acknowledgeWhatsNew("malformed");
    expect(getLastAcknowledgedVersion()).toBe("0.3.0");
  });
  it("repairs a corrupt marker and tolerates failed storage writes", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, "0.2.2-garbage!!!");
    expect(getLastAcknowledgedVersion()).toBeNull();
    acknowledgeWhatsNew("0.2.2");
    expect(getLastAcknowledgedVersion()).toBe("0.2.2");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => acknowledgeWhatsNew("0.3.0")).not.toThrow();
    expect(getLastAcknowledgedVersion()).toBe("0.2.2");
    spy.mockRestore();
  });
  it("does not borrow the stable catalog for unknown versions or previews", () => {
    expect(getWhatsNewForVersion("0.2.1")).toBeNull();
    expect(getWhatsNewForVersion("0.2.2-preview.1")).toBeNull();
    expect(getWhatsNewForVersion("toString")).toBeNull();
    expect(getWhatsNewForVersion("0.2.2+build")).toBeNull();
  });
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns catalog for 0.2.2 and null for unknown version", () => {
    expect(getWhatsNewForVersion("0.2.2")).toHaveLength(4);
    expect(getWhatsNewForVersion("v0.2.2")).toHaveLength(4);
    expect(getWhatsNewForVersion("0.1.0")).toBeNull();
  });

  it("auto-shows for fresh install on 0.2.2", () => {
    expect(shouldAutoShowWhatsNew("0.2.2", null)).toBe(true);
  });

  it("auto-shows when upgrading from 0.2.1 to 0.2.2", () => {
    expect(shouldAutoShowWhatsNew("0.2.2", "0.2.1")).toBe(true);
  });

  it("does NOT auto-show on same version after acknowledgment", () => {
    expect(shouldAutoShowWhatsNew("0.2.2", "0.2.2")).toBe(false);
  });

  it("does NOT auto-show on downgrade", () => {
    expect(shouldAutoShowWhatsNew("0.2.1", "0.2.2")).toBe(false);
  });

  it("does NOT auto-show when version has no catalog (avoids blank panel)", () => {
    expect(shouldAutoShowWhatsNew("0.2.1", null)).toBe(false);
    expect(shouldAutoShowWhatsNew("99.9.9", null)).toBe(false);
  });

  it("persists acknowledgment in localStorage", () => {
    expect(getLastAcknowledgedVersion()).toBeNull();
    acknowledgeWhatsNew("0.2.2");
    expect(getLastAcknowledgedVersion()).toBe("0.2.2");
    expect(window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe("0.2.2");

    // After acknowledgment, shouldAutoShowWhatsNew returns false
    expect(shouldAutoShowWhatsNew("0.2.2")).toBe(false);
  });

  it("handles corrupted storage marker or storage throwing errors gracefully", () => {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, "corrupt-non-semver");
    expect(shouldAutoShowWhatsNew("0.2.2", "corrupt-non-semver")).toBe(true);

    // Mock localStorage throwing
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied");
    });

    expect(getLastAcknowledgedVersion()).toBeNull();
    // Doesn't throw
    expect(shouldAutoShowWhatsNew("0.2.2")).toBe(true);

    spy.mockRestore();
  });
});
