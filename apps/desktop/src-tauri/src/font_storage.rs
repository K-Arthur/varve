//! Font filesystem storage — persists downloaded font files in the
//! application data directory (APPDATA / XDG_DATA_HOME / ~/Library).
//!
//! Uses a subdirectory named `fonts/` under the platform-appropriate
//! application data directory. New files are stored under a hash of the
//! canonical `sha256:<artifact>:<member>` face key; old family-addressed files
//! remain readable during migration.
//!
//! A metadata sidecar stores family, provider, license, and attribution.
//!
//! Research basis: Tauri app-data pattern (tauri::Manager::app_data_dir),
//! font-manager filesystem layout, XDG Base Directory Specification.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Metadata stored alongside each font.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontStorageMeta {
    pub family: String,
    #[serde(alias = "provider_id")]
    pub provider_id: Option<String>,
    #[serde(alias = "license_name")]
    pub license_name: Option<String>,
    #[serde(alias = "license_url")]
    pub license_url: Option<String>,
    pub attribution: Option<String>,
    pub version: Option<String>,
    #[serde(alias = "stored_at")]
    pub stored_at: String,
    #[serde(alias = "file_size_bytes")]
    pub file_size_bytes: u64,
    pub sha256: String,
    #[serde(default)]
    #[serde(alias = "face_key")]
    pub face_key: Option<String>,
    #[serde(default)]
    #[serde(alias = "collection_index")]
    pub collection_index: Option<u32>,
    #[serde(default)]
    #[serde(alias = "post_script_name")]
    pub post_script_name: Option<String>,
    #[serde(default = "default_integrity")]
    pub integrity: String,
}

fn default_integrity() -> String {
    "unknown".to_string()
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

fn face_storage_path(app: &tauri::AppHandle, face_key: &str) -> Result<PathBuf, String> {
    let dir = font_dir(app)?;
    if !is_canonical_face_key(face_key) {
        return Err("Invalid font face identity".into());
    }
    Ok(dir.join(format!("face-{}", safe_face_key(face_key))))
}

fn is_canonical_face_key(face_key: &str) -> bool {
    let Some(rest) = face_key.strip_prefix("sha256:") else {
        return false;
    };
    let Some((digest, member)) = rest.split_once(':') else {
        return false;
    };
    digest.len() == 64
        && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        && (member == "single"
            || member == "0"
            || (member.parse::<u32>().is_ok()
                && !member.starts_with('0')
                && !member.starts_with('+')))
}

fn canonical_face_key(
    sha256: &str,
    collection_index: Option<u32>,
    supplied: Option<String>,
) -> Result<String, String> {
    let member = collection_index
        .map(|index| index.to_string())
        .unwrap_or_else(|| "single".to_string());
    let expected_digest = sha256.to_ascii_lowercase();
    let canonical = format!("sha256:{expected_digest}:{member}");
    let Some(value) = supplied else {
        return Ok(canonical);
    };
    if !is_canonical_face_key(&value) {
        return Err("Invalid font face identity".into());
    }
    let Some(rest) = value.strip_prefix("sha256:") else {
        return Err("Invalid font face identity".into());
    };
    let Some((supplied_digest, supplied_member)) = rest.split_once(':') else {
        return Err("Invalid font face identity".into());
    };
    if !supplied_digest.eq_ignore_ascii_case(&expected_digest)
        || (collection_index.is_some() && supplied_member != member)
    {
        return Err("Font face identity does not match the supplied bytes".into());
    }
    Ok(format!("sha256:{expected_digest}:{supplied_member}"))
}

fn safe_face_key(face_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(face_key.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn find_font_storage_path(app: &tauri::AppHandle, family: &str) -> Result<PathBuf, String> {
    let legacy = font_storage_path(app, family)?;
    if legacy.exists() {
        return Ok(legacy);
    }
    let root = font_dir(app)?;
    for entry in std::fs::read_dir(root).map_err(|e| format!("Cannot read font dir: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let meta_path_buf = path.join("meta.json");
        if !meta_path_buf.exists() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(meta_path_buf) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<FontStorageMeta>(&content) else {
            continue;
        };
        if meta.family.eq_ignore_ascii_case(family) {
            return Ok(path);
        }
    }
    Ok(legacy)
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
                match ext.to_str().unwrap_or("").to_ascii_lowercase().as_str() {
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
    collection_index: Option<u32>,
    post_script_name: Option<String>,
    artifact_hash: Option<String>,
    face_key: Option<String>,
) -> Result<FontStorageMeta, String> {
    // Compute SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash_result = hasher.finalize();
    let sha256: String = hash_result.iter().map(|b| format!("{:02x}", b)).collect();
    if let Some(expected) = artifact_hash {
        if expected.trim_start_matches("sha256:").to_lowercase() != sha256 {
            return Err("Font artifact hash does not match the supplied bytes".into());
        }
    }
    let resolved_face_key = canonical_face_key(&sha256, collection_index, face_key)?;
    let dir = face_storage_path(&app, &resolved_face_key)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create font storage dir: {e}"))?;

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
    let staging_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = dir.join(format!(
        ".varve-font-{}-{}.tmp",
        std::process::id(),
        staging_id
    ));
    let write_result = std::fs::write(&tmp_path, &data)
        .map_err(|e| format!("Cannot write font file: {e}"))
        .and_then(|()| {
            crate::filesystem::replace_file(&tmp_path, &font_path)
                .map_err(|error| format!("Cannot finalize font file: {}", error.message))
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
        face_key: Some(resolved_face_key),
        collection_index,
        post_script_name,
        integrity: "verified".into(),
    };

    let meta_json =
        serde_json::to_string(&meta).map_err(|e| format!("Cannot serialize metadata: {e}"))?;
    // Atomic metadata write: a crash mid-write must not leave a truncated
    // meta.json that would hide the font or break its load.
    let meta_tmp = dir.join(format!(
        ".varve-meta-{}-{}.tmp",
        std::process::id(),
        staging_id
    ));
    let meta_result = std::fs::write(&meta_tmp, &meta_json)
        .map_err(|e| format!("Cannot write metadata: {e}"))
        .and_then(|()| {
            crate::filesystem::replace_file(&meta_tmp, &meta_path(&dir))
                .map_err(|error| format!("Cannot finalize metadata: {}", error.message))
        });
    if meta_result.is_err() {
        let _ = std::fs::remove_file(&meta_tmp);
    }
    meta_result?;

    Ok(meta)
}

#[tauri::command]
pub fn load_font_from_filesystem(
    app: tauri::AppHandle,
    family: Option<String>,
    face_key: Option<String>,
) -> Result<Option<(Vec<u8>, FontStorageMeta)>, String> {
    let dir = match face_key {
        Some(key) => face_storage_path(&app, &key)?,
        None => find_font_storage_path(&app, family.as_deref().unwrap_or_default())?,
    };
    if !dir.exists() {
        return Ok(None);
    }

    let meta: FontStorageMeta = {
        let meta_content = std::fs::read_to_string(meta_path(&dir))
            .map_err(|e| format!("Cannot read metadata: {e}"))?;
        serde_json::from_str(&meta_content).map_err(|e| format!("Cannot parse metadata: {e}"))?
    };

    let font_path = font_file_path(&dir);
    if !font_path.exists() {
        return Ok(None);
    }

    let data = std::fs::read(&font_path).map_err(|e| format!("Cannot read font file: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(&data);
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if actual != meta.sha256.to_lowercase() {
        return Err("Stored font failed integrity verification".into());
    }

    Ok(Some((
        data,
        FontStorageMeta {
            integrity: "verified".into(),
            ..meta
        },
    )))
}

#[tauri::command]
pub fn list_filesystem_fonts(app: tauri::AppHandle) -> Result<Vec<FontStorageMeta>, String> {
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
                if let Ok(mut meta) = serde_json::from_str::<FontStorageMeta>(&content) {
                    let font_path = font_file_path(&path);
                    if let Ok(data) = std::fs::read(&font_path) {
                        let mut hasher = Sha256::new();
                        hasher.update(&data);
                        let actual: String = hasher
                            .finalize()
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect();
                        meta.integrity = if actual == meta.sha256.to_lowercase() {
                            "verified".into()
                        } else {
                            "corrupt".into()
                        };
                    } else {
                        meta.integrity = "corrupt".into();
                    }
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
    family: Option<String>,
    face_key: Option<String>,
) -> Result<bool, String> {
    if let Some(key) = face_key {
        let dir = face_storage_path(&app, &key)?;
        if !dir.exists() {
            return Ok(false);
        }
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Cannot remove font directory: {e}"))?;
        return Ok(true);
    }

    let family = family.as_deref().unwrap_or_default();
    let root = font_dir(&app)?;
    let mut matches = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| format!("Cannot read font dir: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let metadata_path = path.join("meta.json");
        let Ok(content) = std::fs::read_to_string(metadata_path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<FontStorageMeta>(&content) else {
            continue;
        };
        if meta.family.eq_ignore_ascii_case(family) {
            matches.push(path);
        }
    }
    // Preserve compatibility with the pre-v2 family-addressed directory.
    let legacy = font_storage_path(&app, family)?;
    if legacy.exists() && !matches.iter().any(|path| path == &legacy) {
        matches.push(legacy);
    }
    for path in &matches {
        std::fs::remove_dir_all(path).map_err(|e| format!("Cannot remove font directory: {e}"))?;
    }
    Ok(!matches.is_empty())
}

#[tauri::command]
pub fn get_filesystem_font_storage_usage(app: tauri::AppHandle) -> Result<(u64, u64), String> {
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

#[cfg(test)]
mod tests {
    use super::{canonical_face_key, is_canonical_face_key};

    const DIGEST: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_canonical_single_and_collection_keys() {
        assert!(is_canonical_face_key(&format!("sha256:{DIGEST}:single")));
        assert!(is_canonical_face_key(&format!("sha256:{DIGEST}:3")));
        assert!(!is_canonical_face_key(&format!("sha256:{DIGEST}:03")));
        assert!(!is_canonical_face_key("family:Inter"));
    }

    #[test]
    fn canonicalizes_supplied_digest_and_rejects_mismatches() {
        let upper = DIGEST.to_uppercase();
        assert_eq!(
            canonical_face_key(&upper, Some(2), Some(format!("sha256:{upper}:2"))).unwrap(),
            format!("sha256:{DIGEST}:2")
        );
        assert!(canonical_face_key(DIGEST, Some(2), Some(format!("sha256:{DIGEST}:1"))).is_err());
        assert!(canonical_face_key(DIGEST, None, Some("sha256:bad:single".into())).is_err());
    }
}
