//! Font filesystem storage — persists downloaded font files in the
//! application data directory (APPDATA / XDG_DATA_HOME / ~/Library).
//!
//! Uses a subdirectory named `fonts/` under the platform-appropriate
//! application data directory. Each font is stored as:
//!   <appdata>/fonts/<sha256-of-family-name>/<family-normalized>.ttf
//!
//! A metadata sidecar stores family, provider, license, and attribution.
//!
//! Research basis: Tauri app-data pattern (tauri::Manager::app_data_dir),
//! font-manager filesystem layout, XDG Base Directory Specification.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use uuid::Uuid;

/// Metadata stored alongside each font.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FontStorageMeta {
    pub family: String,
    pub provider_id: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub attribution: Option<String>,
    pub version: Option<String>,
    pub stored_at: String,
    pub file_size_bytes: u64,
    pub sha256: String,
}

/// Derive a safe directory name from a family string.
fn family_dir_name(family: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(family.to_lowercase().as_bytes());
    let result = hasher.finalize();
    // First 16 hex chars of SHA-256
    let bytes = &result[..8];
    let mut s = String::with_capacity(16);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Get the app data font directory.
fn font_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = crate::filesystem::AppDirectories::resolve(app)
        .map_err(|error| error.message)?
        .fonts;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create font dir: {e}"))?;
    Ok(dir)
}

/// Get the path for a specific font's storage directory (without extension).
fn font_storage_path(app: &tauri::AppHandle, family: &str) -> Result<PathBuf, String> {
    let dir = font_dir(app)?;
    let safe = family_dir_name(family);
    Ok(dir.join(safe))
}

/// Ensure the font storage directory exists.
fn ensure_font_dir(app: &tauri::AppHandle, family: &str) -> Result<PathBuf, String> {
    let path = font_storage_path(app, family)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Cannot create font storage dir: {e}"))?;
    Ok(path)
}

fn meta_path(dir: &PathBuf) -> PathBuf {
    dir.join("meta.json")
}

fn font_file_path(dir: &PathBuf) -> PathBuf {
    // Try to find a font file in the directory
    for entry in std::fs::read_dir(dir).ok().into_iter().flatten() {
        if let Ok(entry) = entry {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                match ext.to_str().unwrap_or("") {
                    "ttf" | "otf" | "woff" | "woff2" => return path,
                    _ => continue,
                }
            }
        }
    }
    dir.join("font.ttf") // default
}

#[tauri::command]
pub fn store_font_on_filesystem(
    app: tauri::AppHandle,
    family: String,
    data: Vec<u8>,
    provider_id: Option<String>,
    license_name: Option<String>,
    license_url: Option<String>,
    attribution: Option<String>,
    version: Option<String>,
) -> Result<FontStorageMeta, String> {
    let dir = ensure_font_dir(&app, &family)?;

    // Compute SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash_result = hasher.finalize();
    let sha256: String = hash_result.iter().map(|b| format!("{:02x}", b)).collect();

    // Detect format from magic bytes
    let ext = if data.len() > 4 {
        match (&data[0], &data[1], &data[2], &data[3]) {
            (0x00, 0x01, 0x00, 0x00) => "ttf",
            (0x4f, 0x54, 0x54, 0x4f) => "otf",
            (0x77, 0x4f, 0x46, 0x46) => "woff",
            (0x77, 0x4f, 0x46, 0x32) => "woff2",
            (0x74, 0x74, 0x63, 0x66) => "ttc",
            (0x4f, 0x54, 0x43, 0x46) => "otc",
            _ => "ttf",
        }
    } else {
        "ttf"
    };

    let file_name = format!("font.{}", ext);
    let font_path = dir.join(&file_name);

    // Atomically write font data
    // Never share a fixed staging name between concurrent app instances.
    // The generated name is native path data and is not derived from the
    // user's family name.
    let tmp_path = dir.join(format!(".varve-font-{}.tmp", Uuid::new_v4()));
    let write_result = std::fs::write(&tmp_path, &data)
        .map_err(|e| format!("Cannot write font file: {e}"))
        .and_then(|()| {
            std::fs::rename(&tmp_path, &font_path)
                .map_err(|e| format!("Cannot finalize font file: {e}"))
        });
    if write_result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    write_result?;

    let file_size = data.len() as u64;

    // Write metadata
    let meta = FontStorageMeta {
        family: family.clone(),
        provider_id,
        license_name,
        license_url,
        attribution,
        version,
        stored_at: chrono::Utc::now().to_rfc3339(),
        file_size_bytes: file_size,
        sha256,
    };

    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("Cannot serialize metadata: {e}"))?;
    std::fs::write(meta_path(&dir), &meta_json)
        .map_err(|e| format!("Cannot write metadata: {e}"))?;

    Ok(meta)
}

#[tauri::command]
pub fn load_font_from_filesystem(
    app: tauri::AppHandle,
    family: String,
) -> Result<Option<(Vec<u8>, FontStorageMeta)>, String> {
    let dir = font_storage_path(&app, &family)?;
    if !dir.exists() {
        return Ok(None);
    }

    let meta: FontStorageMeta = {
        let meta_content = std::fs::read_to_string(meta_path(&dir))
            .map_err(|e| format!("Cannot read metadata: {e}"))?;
        serde_json::from_str(&meta_content)
            .map_err(|e| format!("Cannot parse metadata: {e}"))?
    };

    let font_path = font_file_path(&dir);
    if !font_path.exists() {
        return Ok(None);
    }

    let data = std::fs::read(&font_path)
        .map_err(|e| format!("Cannot read font file: {e}"))?;

    Ok(Some((data, meta)))
}

#[tauri::command]
pub fn list_filesystem_fonts(
    app: tauri::AppHandle,
) -> Result<Vec<FontStorageMeta>, String> {
    let dir = font_dir(&app)?;
    let mut results = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Cannot read font dir: {e}"))? {
        if let Ok(entry) = entry {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let meta_path_buf = path.join("meta.json");
            if !meta_path_buf.exists() {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&meta_path_buf) {
                if let Ok(meta) = serde_json::from_str::<FontStorageMeta>(&content) {
                    results.push(meta);
                }
            }
        }
    }

    results.sort_by(|a, b| a.family.cmp(&b.family));
    Ok(results)
}

#[tauri::command]
pub fn remove_font_from_filesystem(
    app: tauri::AppHandle,
    family: String,
) -> Result<bool, String> {
    let dir = font_storage_path(&app, &family)?;
    if !dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| format!("Cannot remove font directory: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn get_filesystem_font_storage_usage(
    app: tauri::AppHandle,
) -> Result<(u64, u64), String> {
    let dir = font_dir(&app)?;
    let mut total_bytes = 0u64;
    let mut font_count = 0u64;

    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Cannot read font dir: {e}"))? {
        if let Ok(entry) = entry {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Ok(mut read_dir) = std::fs::read_dir(&path) {
                while let Some(file) = read_dir.next().transpose().ok().flatten() {
                    if let Ok(meta) = file.metadata() {
                        if meta.is_file() {
                            total_bytes += meta.len();
                        }
                    }
                }
                font_count += 1;
            }
        }
    }

    Ok((font_count, total_bytes))
}
