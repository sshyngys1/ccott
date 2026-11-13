param(
    [string]$Target = $env:TAURI_ENV_TARGET_TRIPLE,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $taskRoot 'src-tauri'
if (-not $Target) {
    $rustVersion = & rustc -vV
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine Rust target' }
    $Target = ($rustVersion | Select-String '^host: (.+)$').Matches.Groups[1].Value
}
if ($Target -notmatch '^[a-z0-9_]+-pc-windows-msvc$') { throw "Unsupported hook target: $Target" }
$cargoCommand = if ($env:CARGO) { $env:CARGO } else { 'cargo' }
$hookManifest = Join-Path $tauriRoot 'src/agents/hook/Cargo.toml'
$hookTargetDir = Join-Path $tauriRoot 'target/agent-hook-build'
$cargoArguments = @('build', '--release', '--locked', '--manifest-path', $hookManifest, '--target', $Target, '--target-dir', $hookTargetDir)
if ($Offline -or $env:CARGO_NET_OFFLINE -eq 'true') { $cargoArguments += '--offline' }
& $cargoCommand @cargoArguments
if ($LASTEXITCODE -ne 0) { throw 'Agent hook build failed' }
$binaries = Join-Path $tauriRoot 'binaries'
New-Item -ItemType Directory -Force -Path $binaries | Out-Null
$helperDestination = Join-Path $binaries "ccott-hook-$Target.exe"
Copy-Item -LiteralPath (Join-Path $hookTargetDir "$Target/release/ccott-hook.exe") -Destination $helperDestination -Force
# Copy-Item preserves the cached executable's timestamp; record validation of all current inputs.
(Get-Item -LiteralPath $helperDestination).LastWriteTimeUtc = [DateTime]::UtcNow
