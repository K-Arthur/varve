fn main() {
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

    tauri_build::build()
}
