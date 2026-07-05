//! AI model download, caching, and lifecycle management.
//!
//! Models are stored in the user's config directory:
//! - Linux: `~/.local/share/strata/models/`
//! - macOS: `~/Library/Application Support/strata/models/`
//! - Windows: `%APPDATA%/strata/models/`

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

/// Available models that can be downloaded.
pub const AVAILABLE_MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "u2netp",
        name: "U^2-Net Light",
        description: "4.7 MB — fast preview quality, works on most images",
        size_bytes: 4_700_000,
        remote_url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
        checksum_sha256: None,
    },
    ModelInfo {
        id: "birefnet-general-lite",
        name: "BiRefNet Lite",
        description: "120 MB — high quality, handles complex edges",
        size_bytes: 120_000_000,
        remote_url: "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1.0/birefnet-general-lite.onnx",
        checksum_sha256: None,
    },
    ModelInfo {
        id: "birefnet-general",
        name: "BiRefNet Full",
        description: "380 MB — best quality, handles hair/fur/transparency",
        size_bytes: 380_000_000,
        remote_url: "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1.0/birefnet-general.onnx",
        checksum_sha256: None,
    },
];

/// Get the directory where models are stored.
pub fn models_dir() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("strata")
        .join("models");
    base
}

/// Check if a model is already downloaded.
pub fn is_model_downloaded(model_id: &str) -> bool {
    let path = models_dir().join(format!("{model_id}.onnx"));
    path.exists()
}

/// Get the file path for a downloaded model.
pub fn model_path(model_id: &str) -> PathBuf {
    models_dir().join(format!("{model_id}.onnx"))
}

/// Get the total size of all downloaded models.
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
