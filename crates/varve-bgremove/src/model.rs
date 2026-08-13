//! AI model download, caching, and lifecycle management.
//!
//! Models are stored in the user's config directory when the `ai` feature is
//! enabled (Option B per ADR-0005 Phase E amendment):
//! - Linux: `~/.local/share/strata/models/`
//! - macOS: `~/Library/Application Support/strata/models/`
//! - Windows: `%APPDATA%/strata/models/`
//!
//! IndexedDB in the webview remains the primary download path for shipped
//! builds. Native storage is populated only via explicit export/import or
//! future native download IPC — not automatic dual-storage.

use std::{path::PathBuf, sync::{LazyLock, OnceLock}};

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
    pub size_bytes: u64,
    pub remote_url: String,
    pub checksum_sha256: Option<String>,
}

/// Available models — synced with TS `AVAILABLE_MODELS` + manifest.json.
pub static AVAILABLE_MODELS: LazyLock<Vec<ModelInfo>> = LazyLock::new(|| {
    vec![
    ModelInfo {
        id: "u2netp".to_owned(),
        name: "U^2-Net Light".to_owned(),
        description: "4.7 MB — fast preview quality, works on most images".to_owned(),
        size_bytes: 4_574_861,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx".to_owned(),
        checksum_sha256: Some(
            "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8".into(),
        ),
    },
    ModelInfo {
        id: "isnet-general-use".to_owned(),
        name: "IS-Net General Use".to_owned(),
        description: "179 MB — enhanced balanced quality for varied subjects".to_owned(),
        size_bytes: 178_648_008,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx".to_owned(),
        checksum_sha256: Some(
            "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a".into(),
        ),
    },
    ModelInfo {
        id: "birefnet-general-lite".to_owned(),
        name: "BiRefNet Lite".to_owned(),
        description: "224 MB — high quality, handles complex edges".to_owned(),
        size_bytes: 224_005_088,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx".to_owned(),
        checksum_sha256: Some(
            "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333".into(),
        ),
    },
    ModelInfo {
        id: "birefnet-general".to_owned(),
        name: "BiRefNet Full".to_owned(),
        description: "928 MB — best quality, handles hair/fur/transparency".to_owned(),
        size_bytes: 972_666_916,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx".to_owned(),
        checksum_sha256: Some(
            "58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c".into(),
        ),
    },
    ModelInfo {
        id: "scunet".to_owned(),
        name: "SCUNet Denoise".to_owned(),
        description: "77 MB — real-world blind image denoising (graph + external weights)".to_owned(),
        size_bytes: 76_936_854,
        remote_url: "https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx".to_owned(),
        checksum_sha256: Some(
            "231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c".into(),
        ),
    },
    ModelInfo {
        id: "paddleocr-det-v4".to_owned(),
        name: "PaddleOCR v4 Detection".to_owned(),
        description: "4.7 MB — text region detection (DBNet++)".to_owned(),
        size_bytes: 4_745_517,
        remote_url: "https://huggingface.co/deepghs/paddleocr/resolve/main/det/ch_PP-OCRv4_det/model.onnx".to_owned(),
        checksum_sha256: Some(
            "30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff".into(),
        ),
    },
    ModelInfo {
        id: "paddleocr-rec-v4".to_owned(),
        name: "PaddleOCR v4 Recognition".to_owned(),
        description: "10.8 MB — text recognition (CRNN), 6624 chars + CTC blank".to_owned(),
        size_bytes: 10_826_336,
        remote_url: "https://huggingface.co/deepghs/paddleocr/resolve/main/rec/ch_PP-OCRv4_rec/model.onnx".to_owned(),
        checksum_sha256: Some(
            "1c7cf60de2afd728d512f4190cf37455092b45f06175365c6fc58d8cd7e2a68b".into(),
        ),
    },
    ModelInfo {
        id: "lama-inpainting".to_owned(),
        name: "LaMa Inpainting".to_owned(),
        description: "208 MB — mask-guided inpainting for content-aware fill. Large Mask Inpainting (LaMa, Samsung AI / saic-mdal)".to_owned(),
        size_bytes: 208_000_000,
        remote_url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx".to_owned(),
        checksum_sha256: None,
    },
    ]
});

/// Get the directory where native models are stored.
pub fn models_dir() -> PathBuf {
    CONFIGURED_MODELS_DIR.get().cloned().unwrap_or_else(fallback_models_dir)
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
    model_path(model_id).exists()
}

/// Get the file path for a downloaded model.
pub fn model_path(model_id: &str) -> PathBuf {
    models_dir().join(format!("{model_id}.onnx"))
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
    let path = model_path(model_id);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {e}"))?;
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

        let balanced = model_info("isnet-general-use").expect("enhanced balanced model");
        assert_eq!(balanced.size_bytes, 178_648_008);
        assert!(balanced.remote_url.ends_with("isnet-general-use.onnx"));

        let full = model_info("birefnet-general").expect("full model");
        assert!(full.remote_url.contains("BiRefNet-general-epoch_244"));
        assert_eq!(full.size_bytes, 972_666_916);
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
        assert_eq!(model_path("isnet-general-use"), path.join("isnet-general-use.onnx"));
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
}
