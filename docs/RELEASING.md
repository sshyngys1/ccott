# Releasing CCOTT

CCOTT updates itself with [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/). Installed copies read
`latest.json` from the latest GitHub Release of this repository and install a newer version after checking its signature.

## 1. Update signing key

- The updater key pair (minisign) lives **outside the repository**, e.g. `<KEYS_DIR>/ccott-updater.key` and
  `<KEYS_DIR>/ccott-updater.key.pub`.
- Only the public key is in the repository (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`).
- Never commit, publish or log the private key. `*.key` is in `.gitignore`.
- Keep a backup of the private key: without it, installed copies can no longer be updated.

## 2. Bump the version

`package.json` is the single source of the version: `src-tauri/tauri.conf.json` points at it (`"version": "../package.json"`)
and the UI reads it from there as well. Also bump `version` in `src-tauri/Cargo.toml` to keep the crate in sync.

Run the checks:

```powershell
npm run typecheck
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
```

## 3. Build signed installers

`bundle.createUpdaterArtifacts` is enabled, so a build with the signing key produces `.sig` files next to the installers:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw "<KEYS_DIR>\ccott-updater.key").Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

Artifacts in `src-tauri/target/release/bundle/`:

- `nsis/CCOTT_X.Y.Z_x64-setup.exe` + `.sig` — the main installer, also used by the updater;
- `msi/CCOTT_X.Y.Z_x64_en-US.msi` + `.sig` and `msi/CCOTT_X.Y.Z_x64_ru-RU.msi` + `.sig` — optional MSI packages.

## 4. Generate `latest.json`

```powershell
node tools/release/make-latest-json.mjs --notes "What changed in vX.Y.Z"
```

The script reads the NSIS `.sig` and writes `src-tauri/target/release/bundle/latest.json`:

```json
{
  "version": "X.Y.Z",
  "notes": "What changed in vX.Y.Z",
  "pub_date": "2026-01-01T12:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of CCOTT_X.Y.Z_x64-setup.exe.sig>",
      "url": "https://github.com/sshyngys1/ccott/releases/download/vX.Y.Z/CCOTT_X.Y.Z_x64-setup.exe"
    }
  }
}
```

## 5. Publish the GitHub Release

1. Create a release with the tag **`vX.Y.Z`** (the `url` in `latest.json` depends on it).
2. Attach `CCOTT_X.Y.Z_x64-setup.exe`, `CCOTT_X.Y.Z_x64-setup.exe.sig`, `latest.json`, and optionally the MSI files.
3. Publish. `https://github.com/sshyngys1/ccott/releases/latest/download/latest.json` now serves the new manifest;
   installed copies find the update ~30 s after start, every 6 hours, or via «Проверить обновления» in Settings.
