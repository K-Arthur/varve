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

use std::{path::PathBuf, sync::LazyLock};

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
        size_bytes: 4_700_000,
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
        size_bytes: 928_000_000,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx".to_owned(),
        checksum_sha256: None,
    },
    ]
});

/// Get the directory where native models are stored.
pub fn models_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("strata")
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
pub fn write_model(model_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    let path = model_path(model_id);
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write model: {e}"))?;
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
        assert_eq!(full.size_bytes, 928_000_000);
    }
}
