#!/usr/bin/env node
/**
 * Generates Tauri v2 static update manifest `latest.json` from the built NSIS installer and `.sig`.
 *
 * Usage:
 *   node tools/release/make-latest-json.mjs [--version 0.1.0] [--notes "..."] [--out path/to/latest.json]
 *   node tools/release/make-latest-json.mjs --base-url http://127.0.0.1:18080 --out tmp/latest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));

const productName = args["product-name"] ?? tauriConf.productName ?? "CCOTT";
// tauri.conf.json points `version` at package.json, which is the single source of the version.
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const confVersion = tauriConf.version && !tauriConf.version.endsWith(".json") ? tauriConf.version : packageVersion;
const version = (args.version ?? confVersion).replace(/^v/, "");
const notes = args.notes ?? `${productName} v${version}`;
const pubDate = args["pub-date"] ?? new Date().toISOString();
const repoUrl = (args.repo ?? "https://github.com/sshyngys1/ccott").replace(/\/+$/, "");

const nsisDir = path.resolve(
  repoRoot,
  args["nsis-dir"] ?? path.join("src-tauri", "target", "release", "bundle", "nsis"),
);

const installerName = args.installer ?? `${productName}_${version}_x64-setup.exe`;
const installerPath = path.join(nsisDir, installerName);
const sigPath = args.sig ? path.resolve(repoRoot, args.sig) : `${installerPath}.sig`;

if (!fs.existsSync(sigPath)) {
  throw new Error(`Signature file not found: ${sigPath}. Run 'npm run tauri build' with TAURI_SIGNING_PRIVATE_KEY first.`);
}

const signature = fs.readFileSync(sigPath, "utf8").trim();
if (!signature) {
  throw new Error(`Signature file is empty: ${sigPath}`);
}

const baseUrl = args["base-url"]
  ? args["base-url"].replace(/\/+$/, "")
  : `${repoUrl}/releases/download/v${version}`;

const downloadUrl = `${baseUrl}/${encodeURIComponent(installerName)}`;

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "windows-x86_64": {
      signature,
      url: downloadUrl,
    },
  },
};

const outPath = path.resolve(
  repoRoot,
  args.out ?? path.join("src-tauri", "target", "release", "bundle", "latest.json"),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Generated ${outPath} for v${version} (${downloadUrl})`);
