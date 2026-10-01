fn main() {
    if let Ok(channel) = std::env::var("VARVE_UPDATE_CHANNEL") {
        println!("cargo:rustc-env=VARVE_UPDATE_CHANNEL={channel}");
    }
    if let Ok(mode) = std::env::var("VARVE_UPDATER_MODE") {
        println!("cargo:rustc-env=VARVE_UPDATER_MODE={mode}");
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

    relax_packaged_resources_for_dev(&manifest_dir);

    // Windows: tauri-build embeds the application manifest (which activates the
    // v6 Common Controls activation context) with `rustc-link-arg-bins` — the
    // main binary only. Test binaries don't get the manifest, so at load time
    // the loader binds comctl32's v5 export set and dies with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on v6-only imports like
    // TaskDialogIndirect. Upstream workaround (tauri#13419 / tauri#13948):
    // disable the built-in manifest and embed it manually via plain
    // `rustc-link-arg`, which applies to every linkable artifact including
    // tests. See apps/desktop/src-tauri/windows-app-manifest.xml.
    #[cfg(target_os = "windows")]
    let attributes = {
        add_manifest();
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    };
    #[cfg(not(target_os = "windows"))]
    let attributes = tauri_build::Attributes::new();
    tauri_build::try_build(attributes).expect("failed to run build script");
}

/// Development builds must not require the packaged native generative helper.
///
/// `bundle.resources` lists `../../../target/release/varve-generative-helper*`,
/// which exists only after `node scripts/build-generative-helper.mjs` has run.
/// That script belongs to the packaging `beforeBuildCommand`, so the artifact is
/// absent on a fresh checkout and after any `target/` clean — while
/// `tauri-build` resolves and copies every resource glob on *every* build,
/// including `tauri dev`, a plain `cargo build`/`cargo test` in this crate, and
/// coverage runs. The missing release artifact therefore aborts development with
/// `glob pattern ... path not found or didn't match any files`.
///
/// Development never reads that copy: `resolve_generative_helper` in
/// `src/lib.rs` falls back to `target/debug/varve-generative-helper` for debug
/// builds, which a developer builds only when local generation is actually
/// wanted (`node scripts/cargo-with-generative-bindgen.mjs build -p
/// varve-generative-helper`). Packaged builds keep the helper and still fail
/// closed when the release artifact is missing.
///
/// The dev signal is the one `tauri-build` itself uses for `is_dev`: the
/// `custom-protocol` feature (enabled for `tauri build`, propagated to `tauri`)
/// is off, so the dependency metadata `DEP_TAURI_DEV` is `true`. Only resource
/// entries that reference the packaged helper are dropped, so the bundled
/// onnxruntime dylibs that native inference resolves from the resource directory
/// stay available in development. A `bundle.resources` override supplied through
/// `TAURI_CONFIG` wins, because the non-packaging cargo wrappers use it.
fn relax_packaged_resources_for_dev(manifest_dir: &std::path::Path) {
    if std::env::var("DEP_TAURI_DEV").as_deref() != Ok("true") {
        return;
    }

    let mut patch = match std::env::var("TAURI_CONFIG")
        .ok()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
        .filter(serde_json::Value::is_object)
    {
        Some(value) => value,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };
    if patch.pointer("/bundle/resources").is_some() {
        return;
    }

    let Ok(contents) = std::fs::read_to_string(manifest_dir.join("tauri.conf.json")) else {
        return;
    };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return;
    };
    let Some(resources) = config
        .pointer("/bundle/resources")
        .and_then(serde_json::Value::as_array)
    else {
        return;
    };
    let dev_resources: Vec<serde_json::Value> = resources
        .iter()
        .filter(|entry| match entry.as_str() {
            Some(pattern) => !pattern.contains("varve-generative-helper"),
            None => true,
        })
        .cloned()
        .collect();
    if dev_resources.len() == resources.len() {
        return;
    }

    let Some(patch) = patch.as_object_mut() else {
        return;
    };
    let Some(bundle) = patch
        .entry("bundle")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
        .as_object_mut()
    else {
        return;
    };
    bundle.insert(
        "resources".to_string(),
        serde_json::Value::Array(dev_resources),
    );
    let Ok(serialized) = serde_json::to_string(&patch) else {
        return;
    };
    // tauri-build merges this patch into the file configuration before it
    // resolves bundle resources, so the packaged helper glob never reaches a
    // development build.
    std::env::set_var("TAURI_CONFIG", serialized);
}

#[cfg(target_os = "windows")]
fn add_manifest() {
    static WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

    let manifest = std::env::current_dir().unwrap().join(WINDOWS_MANIFEST_FILE);

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
