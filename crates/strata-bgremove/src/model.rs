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

use std::path::PathBuf;

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
pub const AVAILABLE_MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "u2netp",
        name: "U^2-Net Light",
        description: "4.7 MB — fast preview quality, works on most images",
        size_bytes: 4_700_000,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
        checksum_sha256: Some(
            "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8".into(),
        ),
    },
    ModelInfo {
        id: "birefnet-general-lite",
        name: "BiRefNet Lite",
        description: "214 MB — high quality, handles complex edges",
        size_bytes: 214_000_000,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        checksum_sha256: None,
    },
    ModelInfo {
        id: "birefnet-general",
        name: "BiRefNet Full",
        description: "928 MB — best quality, handles hair/fur/transparency",
        size_bytes: 928_000_000,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx",
        checksum_sha256: None,
    },
];

/// Get the directory where native models are stored.
pub fn models_dir() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("strata")
        .join("models");
    base
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
        assert_eq!(lite.size_bytes, 214_000_000);

        let full = model_info("birefnet-general").expect("full model");
        assert!(full.remote_url.contains("BiRefNet-general-epoch_244"));
        assert_eq!(full.size_bytes, 928_000_000);
    }
}
