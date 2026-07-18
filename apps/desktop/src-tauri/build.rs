fn main() {
    // When the wdio feature is enabled, copy the wdio capability into the
    // capabilities/ directory so tauri-build can validate and bundle it.
    // Without this feature, the wdio.json is excluded to avoid a build failure
    // from referencing plugin permissions that don't exist.
    #[cfg(feature = "wdio")]
    {
        let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let src = manifest_dir.join("tests/wdio-capability.json");
        let dst = manifest_dir.join("capabilities/wdio.json");
        if src.exists() {
            std::fs::copy(&src, &dst).expect("Failed to copy wdio capability for test build");
        }
    }

    tauri_build::build()
}
