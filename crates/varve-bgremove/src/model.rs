//! AI model download, caching, and lifecycle management.
//!
//! Models are stored in the user's config directory when the `ai` feature is
//! enabled (Option B per ADR-0005 Phase E amendment):
//! - Linux: `~/.local/share/dev.varve.desktop/models/`
//! - macOS: `~/Library/Application Support/dev.varve.desktop/models/`
//! - Windows: `%APPDATA%/dev.varve.desktop/models/`
//!
//! IndexedDB in the webview remains the primary browser download path. Native
//! storage is populated only by explicit desktop model-download IPC; it is not
//! an automatic dual-storage mirror.

use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, OnceLock},
};

static CONFIGURED_MODELS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Inject the desktop app-data model root resolved by Tauri.  The fallback in
/// [`models_dir`] exists for standalone native tests and command-line callers;
/// the packaged desktop app always calls this during startup.
pub fn configure_models_dir(path: PathBuf) {
    let _ = CONFIGURED_MODELS_DIR.set(path);
}

/// Metadata for an available AI model.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Total bytes for the graph and every required external-data artifact.
    pub size_bytes: u64,
    /// Measured native CPU peak RSS for the model's bounded inference
    /// contract. This is separate from the file size: ONNX intermediates can
    /// be several times larger than the downloaded graph.
    pub peak_memory_bytes: Option<u64>,
    pub remote_url: String,
    pub checksum_sha256: Option<String>,
    /// Optional sibling file referenced by the ONNX graph's external-data
    /// location. Its filename is preserved because ONNX Runtime resolves the
    /// location relative to the downloaded graph directory.
    pub external_data: Option<ModelArtifactInfo>,
}

/// One downloaded file belonging to a native model installation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelArtifactInfo {
    pub filename: String,
    pub size_bytes: u64,
    pub remote_url: String,
    pub checksum_sha256: Option<String>,
}

impl ModelInfo {
    /// The primary graph's size, excluding an optional external-data file.
    pub fn primary_size_bytes(&self) -> u64 {
        self.external_data
            .as_ref()
            .and_then(|artifact| self.size_bytes.checked_sub(artifact.size_bytes))
            .unwrap_or(self.size_bytes)
    }

    /// All files required for a complete native model installation.
    pub fn artifacts(&self) -> Vec<ModelArtifactInfo> {
        let mut artifacts = vec![ModelArtifactInfo {
            filename: format!("{}.onnx", self.id),
            size_bytes: self.primary_size_bytes(),
            remote_url: self.remote_url.clone(),
            checksum_sha256: self.checksum_sha256.clone(),
        }];
        if let Some(external_data) = &self.external_data {
            artifacts.push(external_data.clone());
        }
        artifacts
    }
}

/// Available models — synced with TS `AVAILABLE_MODELS` + manifest.json.
pub static AVAILABLE_MODELS: LazyLock<Vec<ModelInfo>> = LazyLock::new(|| {
    vec![
    ModelInfo {
        id: "u2netp".to_owned(),
        name: "U^2-Net Light".to_owned(),
        description: "4.7 MB — fast preview quality, works on most images".to_owned(),
        size_bytes: 4_574_861,
        peak_memory_bytes: Some(330_000_000),
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx".to_owned(),
        checksum_sha256: Some(
            "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "isnet-general-use".to_owned(),
        name: "IS-Net General Use".to_owned(),
        description: "179 MB — enhanced balanced quality for varied subjects".to_owned(),
        size_bytes: 178_648_008,
        peak_memory_bytes: Some(1_300_000_000),
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx".to_owned(),
        checksum_sha256: Some(
            "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "birefnet-general-lite".to_owned(),
        name: "BiRefNet Lite".to_owned(),
        description: "224 MB — high quality, handles complex edges".to_owned(),
        size_bytes: 224_005_088,
        peak_memory_bytes: Some(7_000_000_000),
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx".to_owned(),
        checksum_sha256: Some(
            "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "birefnet-general".to_owned(),
        name: "BiRefNet Full".to_owned(),
        description: "928 MB — best quality, handles hair/fur/transparency".to_owned(),
        size_bytes: 972_666_916,
        peak_memory_bytes: Some(8_500_000_000),
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx".to_owned(),
        checksum_sha256: Some(
            "58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "scunet".to_owned(),
        name: "SCUNet Denoise".to_owned(),
        description: "77 MB — real-world blind image denoising (graph + external weights)".to_owned(),
        size_bytes: 76_936_854,
        peak_memory_bytes: Some(280_000_000),
        remote_url: "https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx".to_owned(),
        checksum_sha256: Some(
            "231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c".into(),
        ),
        external_data: Some(ModelArtifactInfo {
            filename: "scunet_color_real_psnr.onnx.data".to_owned(),
            size_bytes: 73_138_176,
            remote_url: "https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx.data".to_owned(),
            checksum_sha256: Some(
                "98825ea1210b641c71e5f052f582c70c49fd44b35387ebe2c034268c17df3feb".into(),
            ),
        }),
    },
    ModelInfo {
        id: "nafnet-deblur-gopro".to_owned(),
        name: "NAFNet Deblur".to_owned(),
        description: "138 MB — task-specific deblurring (NAFNet-GoPro-width64, fp16). Parity-verified against the trusted reference.".to_owned(),
        size_bytes: 138_050_767,
        peak_memory_bytes: Some(420_000_000),
        remote_url: "https://github.com/K-Arthur/varve/releases/download/varve-models-v1/nafnet-gopro-width64-fp16b-embed.onnx".to_owned(),
        checksum_sha256: Some(
            "e9b82a578b6ddf47a3f22118da65d13a4459b53e6c0e5fcf41f5615eadf92f5e".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "paddleocr-det-v4".to_owned(),
        name: "PaddleOCR v4 Detection".to_owned(),
        description: "4.7 MB — text region detection (DBNet++)".to_owned(),
        size_bytes: 4_745_517,
        peak_memory_bytes: Some(40_000_000),
        remote_url: "https://huggingface.co/deepghs/paddleocr/resolve/main/det/ch_PP-OCRv4_det/model.onnx".to_owned(),
        checksum_sha256: Some(
            "30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "paddleocr-rec-v4".to_owned(),
        name: "PaddleOCR v4 Recognition".to_owned(),
        description: "10.8 MB — text recognition (CRNN), 6624 chars + CTC blank".to_owned(),
        size_bytes: 10_826_336,
        peak_memory_bytes: None,
        remote_url: "https://huggingface.co/deepghs/paddleocr/resolve/main/rec/ch_PP-OCRv4_rec/model.onnx".to_owned(),
        checksum_sha256: Some(
            "1c7cf60de2afd728d512f4190cf37455092b45f06175365c6fc58d8cd7e2a68b".into(),
        ),
        external_data: None,
    },
    ModelInfo {
        id: "lama-inpainting".to_owned(),
        name: "LaMa Inpainting".to_owned(),
        description: "208 MB — mask-guided inpainting for content-aware fill. Large Mask Inpainting (LaMa, Samsung AI / saic-mdal)".to_owned(),
        size_bytes: 208_044_816,
        peak_memory_bytes: Some(850_000_000),
        remote_url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx".to_owned(),
        checksum_sha256: Some(
            "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d".into(),
        ),
        external_data: None,
    },
    ]
});

/// Get the directory where native models are stored.
pub fn models_dir() -> PathBuf {
    CONFIGURED_MODELS_DIR
        .get()
        .cloned()
        .unwrap_or_else(fallback_models_dir)
}

/// Non-Tauri fallback used by standalone tests and CLI callers. It never
/// falls back to the process working directory: the OS temp root is
/// resolvable everywhere Varve runs and is deliberately process-independent.
fn fallback_models_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("dev.varve.desktop")
        .join("models")
}

/// Check if a model is already downloaded to native storage.
pub fn is_model_downloaded(model_id: &str) -> bool {
    let Some(model) = model_info(model_id) else {
        return false;
    };
    valid_model_install_at(model, &models_dir())
}

/// Get the file path for a downloaded model.
pub fn model_path(model_id: &str) -> PathBuf {
    models_dir().join(format!("{model_id}.onnx"))
}

/// Sum the bytes currently present for all artifacts of a model. This is a
/// progress/status value, not an installation-validity check.
pub fn downloaded_model_size(model_id: &str) -> u64 {
    let Some(model) = model_info(model_id) else {
        return 0;
    };
    model
        .artifacts()
        .iter()
        .map(|artifact| models_dir().join(&artifact.filename))
        .filter_map(|path| path.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

/// Copy valid models from pre-Varve application directories without deleting
/// or replacing anything. This is intentionally per-file: a user may have a
/// valid model in `strata/models` while the new directory already contains a
/// different model. The old file remains available to older Varve builds.
pub fn migrate_legacy_models() -> Result<usize, String> {
    let destination = models_dir();
    let mut candidates = Vec::new();
    if let Some(app_data_dir) = destination.parent().and_then(Path::parent) {
        candidates.push(app_data_dir.join("strata/models"));
        candidates.push(app_data_dir.join("dev.strata.desktop/models"));
    }
    if let Some(data_dir) = dirs_next::data_dir() {
        candidates.push(data_dir.join("strata/models"));
        candidates.push(data_dir.join("dev.strata.desktop/models"));
    }
    candidates.sort();
    candidates.dedup();

    let mut migrated = 0;
    for source in candidates {
        migrated += migrate_legacy_models_from(&source, &destination)?;
    }
    Ok(migrated)
}

/// Testable migration primitive. It validates the source before copying and
/// promotes through a sibling temporary file so an interrupted copy cannot
/// become the apparent installed model.
pub fn migrate_legacy_models_from(source: &Path, destination: &Path) -> Result<usize, String> {
    if !source.is_dir() || source == destination {
        return Ok(0);
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create model directory: {error}"))?;

    let mut migrated = 0;
    for model in AVAILABLE_MODELS.iter() {
        let artifacts = model.artifacts();
        let needs_migration = artifacts.iter().any(|artifact| {
            !valid_artifact(
                &destination.join(&artifact.filename),
                artifact.size_bytes,
                artifact.checksum_sha256.as_deref(),
            )
        });
        if !needs_migration {
            continue;
        }

        let mut staged = Vec::new();
        let mut source_complete = true;
        for (index, artifact) in artifacts.iter().enumerate() {
            let destination_path = destination.join(&artifact.filename);
            if valid_artifact(
                &destination_path,
                artifact.size_bytes,
                artifact.checksum_sha256.as_deref(),
            ) {
                continue;
            }
            let source_path = source.join(&artifact.filename);
            if !valid_artifact(
                &source_path,
                artifact.size_bytes,
                artifact.checksum_sha256.as_deref(),
            ) {
                source_complete = false;
                break;
            }
            let staging = destination.join(format!(".legacy-{}-{index}.tmp", model.id));
            fs::copy(&source_path, &staging)
                .map_err(|error| format!("Failed to migrate {}: {error}", model.id))?;
            staged.push((staging, destination_path));
        }
        if !source_complete {
            for (staging, _) in &staged {
                let _ = fs::remove_file(staging);
            }
            continue;
        }
        for (staging, destination_path) in staged {
            if let Err(error) = fs::rename(&staging, &destination_path) {
                let _ = fs::remove_file(&staging);
                return Err(format!("Failed to finalize migrated {}: {error}", model.id));
            }
        }
        migrated += 1;
    }
    Ok(migrated)
}

fn valid_artifact(path: &Path, expected_size: u64, expected_checksum: Option<&str>) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        return false;
    }
    let Some(expected) = expected_checksum else {
        return true;
    };
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    // Iterate output bytes rather than `{:x}` formatting: the digest output
    // array type differs between sha2 0.10 (generic-array) and 0.11
    // (hybrid-array), and LowerHex is not implemented by both.
    let actual = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    actual == expected
}

fn valid_model_install_at(model: &ModelInfo, directory: &Path) -> bool {
    model.artifacts().iter().all(|artifact| {
        valid_artifact(
            &directory.join(&artifact.filename),
            artifact.size_bytes,
            artifact.checksum_sha256.as_deref(),
        )
    })
}

/// Get metadata for a model id.
pub fn model_info(model_id: &str) -> Option<&'static ModelInfo> {
    AVAILABLE_MODELS.iter().find(|m| m.id == model_id)
}

/// Get the total size of all downloaded native models.
pub fn total_downloaded_size() -> u64 {
    let dir = models_dir();
    if !dir.exists() {
        return 0;
    }
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Write model bytes to native storage (explicit user action only).
///
/// The write is staged through a unique sibling temporary file and promoted
/// with a rename so a crash mid-write can never leave a truncated file under
/// the final model name. Windows `rename` refuses to replace an existing
/// file, so a replace-retry is used there; the file is never deleted before
/// the replacement is fully written.
pub fn write_model(model_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    let path = model_path(model_id);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("model");
    let staging = dir.join(format!(
        ".varve-model-{file_name}-{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&staging, bytes)
        .map_err(|e| format!("Failed to write model staging file: {e}"))?;
    let promoted = std::fs::rename(&staging, &path);
    let promoted = match promoted {
        Ok(()) => Ok(()),
        // Windows: destination exists. Replace only now that the new bytes
        // are fully on disk; never delete the old file first.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to replace existing model: {e}"))?;
            std::fs::rename(&staging, &path)
                .map_err(|e| format!("Failed to finalize model replacement: {e}"))
        }
        Err(error) => Err(format!("Failed to finalize model file: {error}")),
    };
    if promoted.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    promoted?;
    Ok(path)
}

/// Delete a model from native storage.
pub fn delete_model(model_id: &str) -> Result<(), String> {
    let model = model_info(model_id).ok_or_else(|| format!("Unknown model: {model_id}"))?;
    for artifact in model.artifacts() {
        let path = models_dir().join(&artifact.filename);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| {
                format!("Failed to delete model artifact {}: {e}", artifact.filename)
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn available_models_match_ts_manifest_urls() {
        let lite = model_info("birefnet-general-lite").expect("lite model");
        assert!(lite.remote_url.contains("rembg"));
        assert!(lite.remote_url.contains("BiRefNet-general-bb_swin"));
        assert_eq!(lite.size_bytes, 224_005_088);
        assert_eq!(lite.peak_memory_bytes, Some(7_000_000_000));

        let balanced = model_info("isnet-general-use").expect("enhanced balanced model");
        assert_eq!(balanced.size_bytes, 178_648_008);
        assert_eq!(balanced.peak_memory_bytes, Some(1_300_000_000));
        assert!(balanced.remote_url.ends_with("isnet-general-use.onnx"));

        let full = model_info("birefnet-general").expect("full model");
        assert!(full.remote_url.contains("BiRefNet-general-epoch_244"));
        assert_eq!(full.size_bytes, 972_666_916);
        assert_eq!(full.peak_memory_bytes, Some(8_500_000_000));
    }

    #[test]
    fn u2netp_size_matches_the_actual_remote_and_bundled_file() {
        // Regression: the size was rounded to 4_700_000 while the real file
        // (rembg release asset, identical to the bundled public/models copy)
        // is 4_574_861 bytes. The native download gate and the status API both
        // compare exact byte sizes, so the rounded value made every u2netp
        // download fail with "Model size mismatch" and reported the bundled
        // model as not installed.
        let u2netp = model_info("u2netp").expect("u2netp model");
        assert_eq!(u2netp.size_bytes, 4_574_861);
        assert_eq!(u2netp.peak_memory_bytes, Some(330_000_000));
    }

    #[test]
    fn scunet_declares_and_validates_its_external_weights_artifact() {
        let scunet = model_info("scunet").expect("scunet model");
        let artifacts = scunet.artifacts();
        assert_eq!(scunet.primary_size_bytes(), 3_798_678);
        assert_eq!(artifacts.len(), 2);
        assert_eq!(artifacts[0].filename, "scunet.onnx");
        assert_eq!(artifacts[0].size_bytes, 3_798_678);
        assert_eq!(artifacts[1].filename, "scunet_color_real_psnr.onnx.data");
        assert_eq!(artifacts[1].size_bytes, 73_138_176);
        assert_eq!(
            artifacts
                .iter()
                .map(|artifact| artifact.size_bytes)
                .sum::<u64>(),
            scunet.size_bytes
        );
        assert_eq!(
            artifacts[1].checksum_sha256.as_deref(),
            Some("98825ea1210b641c71e5f052f582c70c49fd44b35387ebe2c034268c17df3feb")
        );
    }

    #[test]
    fn lama_metadata_matches_the_verified_manifest_contract() {
        let lama = model_info("lama-inpainting").expect("LaMa model");
        assert_eq!(lama.size_bytes, 208_044_816);
        assert_eq!(
            lama.checksum_sha256.as_deref(),
            Some("1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d")
        );
        assert_eq!(lama.peak_memory_bytes, Some(850_000_000));
    }

    #[test]
    fn models_dir_resolves_inside_the_user_data_directory_not_the_app_dir() {
        // Packaged media (AppImage, .deb, .rpm) are read-only; a model must
        // never be written relative to the executable, the resource dir, or
        // the working directory. dirs_next::data_dir() is the OS user-data
        // location ($XDG_DATA_HOME / ~/.local/share on Linux, %APPDATA% on
        // Windows, ~/Library/Application Support on macOS) — the writable
        // per-user location that survives AppImage extraction.
        let path = models_dir();
        assert!(path.is_absolute(), "models dir must be absolute: {path:?}");
        assert!(path.ends_with(std::path::Path::new("dev.varve.desktop").join("models")));
        let data_dir = dirs_next::data_dir().expect("user data dir");
        assert!(
            path.starts_with(&data_dir),
            "models dir must live under the user data dir: {path:?}"
        );
        assert!(
            !std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
                .map(|parent| path.starts_with(&parent))
                .unwrap_or(false),
            "models dir must never resolve under the executable directory"
        );
        assert_eq!(
            model_path("isnet-general-use"),
            path.join("isnet-general-use.onnx")
        );
    }

    #[test]
    fn every_downloadable_model_uses_https() {
        for model in AVAILABLE_MODELS.iter() {
            assert!(
                model.remote_url.starts_with("https://"),
                "insecure model URL for {}: {}",
                model.id,
                model.remote_url
            );
        }
    }

    #[test]
    fn legacy_migration_copies_only_valid_missing_models() {
        let root =
            std::env::temp_dir().join(format!("varve-model-migration-test-{}", std::process::id()));
        let source = root.join("strata/models");
        let destination = root.join("dev.varve.desktop/models");
        std::fs::create_dir_all(&source).expect("create source");
        std::fs::create_dir_all(&destination).expect("create destination");

        // A malformed legacy file is ignored, never copied just because its
        // filename looks familiar.
        std::fs::write(source.join("u2netp.onnx"), b"not-a-model").expect("write invalid");
        assert_eq!(
            migrate_legacy_models_from(&source, &destination).expect("migrate"),
            0
        );
        assert!(!destination.join("u2netp.onnx").exists());

        let _ = std::fs::remove_dir_all(root);
    }
}
