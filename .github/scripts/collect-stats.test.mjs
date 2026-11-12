// node --test .github/scripts/collect-stats.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { classify, summarize, upsertByDate, mergeDaily } from "./collect-stats.mjs";

test("classify separates installers, signatures and update checks", () => {
  assert.equal(classify("CCOTT_0.4.0_x64-setup.exe"), "installers");
  assert.equal(classify("CCOTT_0.4.0_x64_ru-RU.msi"), "installers");
  assert.equal(classify("CCOTT_0.4.0_x64-setup.exe.sig"), "signatures");
  assert.equal(classify("latest.json"), "checks");
  assert.equal(classify("notes.txt"), "other");
});

test("summarize totals every published release and skips drafts", () => {
  const asset = (name, n) => ({ name, download_count: n });
  const { totals, versions } = summarize([
    { tag_name: "v0.2.0", assets: [asset("a-setup.exe", 5), asset("a-setup.exe.sig", 2), asset("latest.json", 10)] },
    { tag_name: "v0.1.0", assets: [asset("b.msi", 3), asset("latest.json", 4)] },
    { tag_name: "v0.3.0", draft: true, assets: [asset("c-setup.exe", 99)] },
  ]);
  assert.deepEqual(totals, { installers: 8, signatures: 2, checks: 14, other: 0, manualEstimate: 6 });
  assert.deepEqual(Object.keys(versions), ["v0.2.0", "v0.1.0"]);
});

test("upsertByDate keeps one entry per day, sorted", () => {
  const list = upsertByDate([{ date: "2026-11-02", n: 1 }, { date: "2026-11-01", n: 0 }], { date: "2026-11-02", n: 2 });
  assert.deepEqual(list, [{ date: "2026-11-01", n: 0 }, { date: "2026-11-02", n: 2 }]);
});

test("mergeDaily extends history beyond GitHub's 14-day window", () => {
  const merged = mergeDaily([{ date: "2026-10-01", count: 3 }, { date: "2026-11-01", count: 1 }], [{ date: "2026-11-01", count: 4 }, { date: "2026-11-02", count: 2 }]);
  assert.deepEqual(merged.map((d) => [d.date, d.count]), [["2026-10-01", 3], ["2026-11-01", 4], ["2026-11-02", 2]]);
});
