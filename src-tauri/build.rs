fn main() {
    // Embed the app manifest (Common Controls v6) through the linker instead of tauri-build's resource script, so it
    // also lands in `cargo test` binaries: without it they fail to start (STATUS_ENTRYPOINT_NOT_FOUND on
    // TaskDialogIndirect). The manifest is tauri-build's default one, copied unchanged.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    // Agents helper block; independent of the application's Windows manifest setup.
    build_agent_hook();
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}

fn build_agent_hook() {
    println!("cargo:rerun-if-changed=src/agents/hook");
    println!("cargo:rerun-if-changed=../scripts/build-agent-hook.ps1");
    println!("cargo:rerun-if-env-changed=CARGO_NET_OFFLINE");
    let target = std::env::var("TARGET").expect("Rust target");
    let helper = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("binaries")
        .join(format!("ccott-hook-{target}.exe"));
    // beforeBuildCommand already builds the sidecar for Tauri's early externalBin check.
    // Skip the second PowerShell/Cargo invocation if that output covers all helper inputs.
    let current = helper
        .metadata()
        .and_then(|m| m.modified())
        .is_ok_and(|built| {
            inputs_unchanged(std::path::Path::new("src/agents/hook"), built)
                && inputs_unchanged(
                    std::path::Path::new("../scripts/build-agent-hook.ps1"),
                    built,
                )
        });
    if !current {
        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "../scripts/build-agent-hook.ps1",
                "-Target",
                &target,
            ])
            .status()
            .expect("build agent hook");
        assert!(status.success(), "Agent hook build failed");
    }
    println!("cargo:rustc-env=CCOTT_AGENT_HOOK={}", helper.display());
}

fn inputs_unchanged(path: &std::path::Path, built: std::time::SystemTime) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.modified().is_ok_and(|modified| modified <= built) {
        return false;
    }
    if metadata.is_dir() {
        let Ok(entries) = path.read_dir() else {
            return false;
        };
        return entries
            .into_iter()
            .all(|entry| entry.is_ok_and(|entry| inputs_unchanged(&entry.path(), built)));
    }
    true
}
