fn main() {
    if let Ok(channel) = std::env::var("VARVE_UPDATE_CHANNEL") {
        println!("cargo:rustc-env=VARVE_UPDATE_CHANNEL={channel}");
    }
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dst = manifest_dir.join("capabilities/wdio.json");

    // When the wdio feature is enabled, copy the wdio capability into the
    // capabilities/ directory so tauri-build can validate and bundle it.
    // Without this feature, remove any stale copy left by a previous
    // --features wdio build, so tauri-build doesn't fail on permissions
    // from optional plugins that aren't enabled.
    #[cfg(feature = "wdio")]
    {
        let src = manifest_dir.join("tests/wdio-capability.json");
        if src.exists() {
            std::fs::copy(&src, &dst).expect("Failed to copy wdio capability for test build");
        }
    }

    #[cfg(not(feature = "wdio"))]
    {
        let _ = std::fs::remove_file(&dst);
    }

    // Windows: tauri-build embeds the application manifest (which activates the
    // v6 Common Controls activation context) with `rustc-link-arg-bins` — the
    // main binary only. Test binaries don't get the manifest, so at load time
    // the loader binds comctl32's v5 export set and dies with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on v6-only imports like
    // TaskDialogIndirect. Upstream workaround (tauri#13419 / tauri#13948):
    // disable the built-in manifest and embed it manually via plain
    // `rustc-link-arg`, which applies to every linkable artifact including
    // tests. See apps/desktop/src-tauri/windows-app-manifest.xml.
    let mut attributes = tauri_build::Attributes::new();
    #[cfg(target_os = "windows")]
    {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new_without_app_manifest(),
        );
        add_manifest();
    }
    #[cfg(not(target_os = "windows"))]
    let attributes = attributes;
    tauri_build::try_build(attributes).expect("failed to run build script");
}

#[cfg(target_os = "windows")]
fn add_manifest() {
    static WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

    let manifest = std::env::current_dir()
        .unwrap()
        .join(WINDOWS_MANIFEST_FILE);

    println!("cargo:rerun-if-changed={}", manifest.display());
    // Embed the Windows application manifest file.
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest.to_str().unwrap()
    );
    // Turn linker warnings into errors.
    println!("cargo:rustc-link-arg=/WX");
}
