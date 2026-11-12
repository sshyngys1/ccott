// Daily CCOTT usage snapshot for the owner. Node >= 20, no dependencies.
// Writes into the directory given as argv[2] (the checked-out `stats` branch):
//   history.json — one entry per UTC day: download totals, per-version counts, stars;
//   traffic.json — GitHub's 14-day views/clones, merged per day so history survives past 14 days.
// Public data needs no token. Traffic needs a token with push access in TRAFFIC_TOKEN (optional).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const repo = process.env.STATS_REPO ?? "sshyngys1/ccott";
const api = "https://api.github.com";

async function gh(path, token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "ccott-stats" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${api}${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

/** Installer = what a person downloads; .sig is fetched by the updater; latest.json = update checks. */
export function classify(name) {
  if (name === "latest.json") return "checks";
  if (name.endsWith(".sig")) return "signatures";
  if (/\.(exe|msi)$/i.test(name)) return "installers";
  return "other";
}

export function summarize(releases) {
  const totals = { installers: 0, signatures: 0, checks: 0, other: 0 };
  const versions = {};
  for (const r of releases) {
    if (r.draft) continue;
    const v = { installers: 0, signatures: 0, checks: 0, other: 0 };
    for (const a of r.assets ?? []) v[classify(a.name)] += a.download_count;
    for (const k of Object.keys(totals)) totals[k] += v[k];
    versions[r.tag_name] = v;
  }
  // The updater fetches an installer together with its .sig, so installers minus signatures ≈ manual downloads.
  totals.manualEstimate = Math.max(0, totals.installers - totals.signatures);
  return { totals, versions };
}

/** Keeps one entry per date; a later run on the same day replaces the earlier one. */
export function upsertByDate(list, entry) {
  return [...list.filter((e) => e.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date));
}

/** Merges GitHub's rolling 14-day window into the stored series (newer numbers win). */
export function mergeDaily(existing, days) {
  const map = new Map(existing.map((d) => [d.date, d]));
  for (const d of days) map.set(d.date, d);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function main(outDir) {
  const date = new Date().toISOString().slice(0, 10);
  await mkdir(outDir, { recursive: true });

  // Public data works without a token; the workflow's GITHUB_TOKEN only lifts the shared-IP rate limit.
  const publicToken = process.env.GITHUB_TOKEN;
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = await gh(`/repos/${repo}/releases?per_page=100&page=${page}`, publicToken);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const meta = await gh(`/repos/${repo}`, publicToken);
  const entry = {
    date,
    ...summarize(releases),
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    watchers: meta.subscribers_count,
    openIssues: meta.open_issues_count,
  };
  const historyFile = join(outDir, "history.json");
  const history = upsertByDate(await readJson(historyFile, []), entry);
  await writeFile(historyFile, `${JSON.stringify(history, null, 1)}\n`);
  console.log(`history: ${history.length} days, installers ${entry.totals.installers}, checks ${entry.totals.checks}`);

  const token = process.env.TRAFFIC_TOKEN;
  if (!token) {
    console.log("traffic: skipped (no TRAFFIC_TOKEN)");
    return;
  }
  const [views, clones, referrers] = await Promise.all([
    gh(`/repos/${repo}/traffic/views`, token),
    gh(`/repos/${repo}/traffic/clones`, token),
    gh(`/repos/${repo}/traffic/popular/referrers`, token),
  ]);
  const day = (t) => t.timestamp.slice(0, 10);
  const trafficFile = join(outDir, "traffic.json");
  const traffic = await readJson(trafficFile, { views: [], clones: [], referrers: [] });
  traffic.views = mergeDaily(traffic.views ?? [], views.views.map((v) => ({ date: day(v), count: v.count, uniques: v.uniques })));
  traffic.clones = mergeDaily(traffic.clones ?? [], clones.clones.map((c) => ({ date: day(c), count: c.count, uniques: c.uniques })));
  traffic.referrers = upsertByDate(traffic.referrers ?? [], { date, items: referrers });
  await writeFile(trafficFile, `${JSON.stringify(traffic, null, 1)}\n`);
  console.log(`traffic: ${traffic.views.length} view days, ${traffic.clones.length} clone days`);
}

if (process.argv[1]?.endsWith("collect-stats.mjs")) {
  main(process.argv[2] ?? "stats-out").catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
