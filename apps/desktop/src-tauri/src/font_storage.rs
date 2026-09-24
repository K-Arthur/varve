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
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

const TOMBSTONES_FILE: &str = ".tombstones.json";
const PROJECT_REFS_FILE: &str = ".project-refs.json";

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
    #[serde(default, alias = "document_id")]
    pub document_id: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default = "default_integrity")]
    pub integrity: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontStorageTombstones {
    #[serde(default)]
    face_keys: BTreeSet<String>,
    #[serde(default)]
    family_keys: BTreeSet<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontProjectReferences {
    #[serde(default)]
    face_documents: BTreeMap<String, BTreeSet<String>>,
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

fn tombstones_path(root: &Path) -> PathBuf {
    root.join(TOMBSTONES_FILE)
}

fn project_refs_path(root: &Path) -> PathBuf {
    root.join(PROJECT_REFS_FILE)
}

fn family_tombstone_key(family: &str) -> String {
    format!("family:{}", family.trim().to_lowercase())
}

fn read_tombstones(root: &Path) -> Result<FontStorageTombstones, String> {
    let path = tombstones_path(root);
    if !path.exists() {
        return Ok(FontStorageTombstones::default());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Cannot read font removal journal: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse font removal journal: {error}"))
}

fn write_tombstones(root: &Path, tombstones: &FontStorageTombstones) -> Result<(), String> {
    let content = serde_json::to_string(tombstones)
        .map_err(|error| format!("Cannot serialize font removal journal: {error}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(
        ".varve-tombstones-{}-{stamp}.tmp",
        std::process::id()
    ));
    let result = std::fs::write(&temporary, content)
        .map_err(|error| format!("Cannot write font removal journal: {error}"))
        .and_then(|()| {
            crate::filesystem::replace_file(&temporary, &tombstones_path(root))
                .map_err(|error| format!("Cannot finalize font removal journal: {}", error.message))
        });
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn read_project_refs(root: &Path) -> Result<FontProjectReferences, String> {
    let path = project_refs_path(root);
    if !path.exists() {
        return Ok(FontProjectReferences::default());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Cannot read project font references: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse project font references: {error}"))
}

fn write_project_refs(root: &Path, refs: &FontProjectReferences) -> Result<(), String> {
    let content = serde_json::to_string(refs)
        .map_err(|error| format!("Cannot serialize project font references: {error}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(
        ".varve-project-refs-{}-{stamp}.tmp",
        std::process::id()
    ));
    let result = std::fs::write(&temporary, content)
        .map_err(|error| format!("Cannot write project font references: {error}"))
        .and_then(|()| {
            crate::filesystem::replace_file(&temporary, &project_refs_path(root)).map_err(|error| {
                format!("Cannot finalize project font references: {}", error.message)
            })
        });
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn is_project_scoped(meta: &FontStorageMeta) -> bool {
    meta.scope.as_deref() == Some("project") || meta.document_id.is_some()
}

fn face_key_from_meta(meta: &FontStorageMeta) -> Option<String> {
    canonical_face_key(&meta.sha256, meta.collection_index, meta.face_key.clone()).ok()
}

fn path_is_tombstoned(path: &Path, family: &str, tombstones: &FontStorageTombstones) -> bool {
    if tombstones
        .family_keys
        .contains(&family_tombstone_key(family))
    {
        return true;
    }
    let Ok(content) = std::fs::read_to_string(meta_path(path)) else {
        return false;
    };
    let Ok(meta) = serde_json::from_str::<FontStorageMeta>(&content) else {
        return false;
    };
    face_key_from_meta(&meta)
        .map(|key| tombstones.face_keys.contains(&key))
        .unwrap_or(false)
}

/// Get the path for a specific font's storage directory (without extension).
fn font_storage_path(app: &tauri::AppHandle, family: &str) -> Result<PathBuf, String> {
    let dir = font_dir(app)?;
    let safe = family_dir_name(family);
    Ok(dir.join(safe))
}

fn face_storage_path(app: &tauri::AppHandle, face_key: &str) -> Result<PathBuf, String> {
    let dir = font_dir(app)?;
    face_storage_path_at(&dir, face_key)
}

fn face_storage_path_at(root: &Path, face_key: &str) -> Result<PathBuf, String> {
    if !is_canonical_face_key(face_key) {
        return Err("Invalid font face identity".into());
    }
    Ok(root.join(format!("face-{}", safe_face_key(face_key))))
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

fn select_family_storage_path(
    legacy: PathBuf,
    legacy_exists: bool,
    matches: &[PathBuf],
    family: &str,
) -> Result<PathBuf, String> {
    // A pre-v2 family directory is an explicit compatibility record and can
    // still be read without inventing an exact identity. New hash/member
    // directories are safe to use only when the family maps to one face.
    if legacy_exists {
        return Ok(legacy);
    }
    match matches {
        [] => Ok(legacy),
        [path] => Ok(path.clone()),
        _ => Err(format!(
            "Multiple stored font faces match family \"{family}\"; select an exact face identity"
        )),
    }
}

fn find_font_storage_path(app: &tauri::AppHandle, family: &str) -> Result<PathBuf, String> {
    let legacy = font_storage_path(app, family)?;
    let root = font_dir(app)?;
    let tombstones = read_tombstones(&root)?;
    let legacy_exists = legacy.exists() && !path_is_tombstoned(&legacy, family, &tombstones);
    let mut matches = Vec::new();
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
        if meta.family.eq_ignore_ascii_case(family)
            && !path_is_tombstoned(&path, &meta.family, &tombstones)
        {
            matches.push(path);
        }
    }
    select_family_storage_path(legacy, legacy_exists, &matches, family)
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}

fn font_file_path(dir: &Path) -> PathBuf {
    // Try to find a font file in the directory
    for entry in std::fs::read_dir(dir).ok().into_iter().flatten().flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            match ext.to_str().unwrap_or("").to_ascii_lowercase().as_str() {
                "ttf" | "otf" | "ttc" | "otc" | "woff" | "woff2" => return path,
                _ => continue,
            }
        }
    }
    dir.join("font.ttf") // default
}

/// Request arguments for storing a downloaded font face.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreFontRequest {
    pub family: String,
    pub data: Vec<u8>,
    pub provider_id: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub attribution: Option<String>,
    pub version: Option<String>,
    pub collection_index: Option<u32>,
    pub post_script_name: Option<String>,
    pub artifact_hash: Option<String>,
    pub face_key: Option<String>,
    pub document_id: Option<String>,
    pub scope: Option<String>,
}

#[tauri::command]
pub fn store_font_on_filesystem(
    app: tauri::AppHandle,
    request: StoreFontRequest,
) -> Result<FontStorageMeta, String> {
    let StoreFontRequest {
        family,
        data,
        provider_id,
        license_name,
        license_url,
        attribution,
        version,
        collection_index,
        post_script_name,
        artifact_hash,
        face_key,
        document_id,
        scope,
    } = request;
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
    let root = font_dir(&app)?;
    let mut tombstones = read_tombstones(&root)?;
    let face_removed = tombstones.face_keys.remove(&resolved_face_key);
    let family_removed = tombstones
        .family_keys
        .remove(&family_tombstone_key(&family));
    if face_removed || family_removed {
        write_tombstones(&root, &tombstones)?;
    }
    let dir = face_storage_path(&app, &resolved_face_key)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create font storage dir: {e}"))?;

    let existing_meta = std::fs::read_to_string(meta_path(&dir))
        .ok()
        .and_then(|content| serde_json::from_str::<FontStorageMeta>(&content).ok());
    let incoming_persistent = scope.as_deref() == Some("persistent") || document_id.is_none();
    let persistent = incoming_persistent
        || existing_meta
            .as_ref()
            .map(|meta| !is_project_scoped(meta))
            .unwrap_or(false);
    let resolved_scope = if persistent { "persistent" } else { "project" };
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
        face_key: Some(resolved_face_key.clone()),
        collection_index,
        post_script_name,
        document_id: if persistent {
            None
        } else {
            document_id.clone()
        },
        scope: Some(resolved_scope.to_string()),
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

    // Commit the lifetime reference only after both the font bytes and its
    // metadata are durable.
    let mut project_refs = read_project_refs(&root)?;
    if persistent {
        project_refs.face_documents.remove(&resolved_face_key);
    } else if let Some(document_id) = document_id.as_ref() {
        project_refs
            .face_documents
            .entry(resolved_face_key.clone())
            .or_default()
            .insert(document_id.clone());
    }
    write_project_refs(&root, &project_refs)?;

    Ok(meta)
}

#[tauri::command]
pub fn load_font_from_filesystem(
    app: tauri::AppHandle,
    family: Option<String>,
    face_key: Option<String>,
) -> Result<Option<(Vec<u8>, FontStorageMeta)>, String> {
    let root = font_dir(&app)?;
    let dir = match face_key {
        Some(key) => {
            let tombstones = read_tombstones(&root)?;
            if tombstones.face_keys.contains(&key) {
                return Ok(None);
            }
            face_storage_path(&app, &key)?
        }
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
    let tombstones = read_tombstones(&dir)?;
    let mut results = Vec::new();

    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read font dir: {e}"))?
        .flatten()
    {
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
                if path_is_tombstoned(&path, &meta.family, &tombstones) {
                    continue;
                }
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
        let key = key.to_ascii_lowercase();
        let root = font_dir(&app)?;
        let mut tombstones = read_tombstones(&root)?;
        let mut project_refs = read_project_refs(&root)?;
        let dir = face_storage_path(&app, &key)?;
        let mut removed = false;
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Cannot remove font directory: {e}"))?;
            removed = true;
        }

        // A pre-v2 family directory may contain the same artifact. Remove it
        // when its metadata proves the exact face identity, so a family-only
        // compatibility lookup cannot resurrect an explicitly removed face.
        for entry in std::fs::read_dir(&root).map_err(|e| format!("Cannot read font dir: {e}"))? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if !path.is_dir() || path == dir {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(meta_path(&path)) else {
                continue;
            };
            let Ok(meta) = serde_json::from_str::<FontStorageMeta>(&content) else {
                continue;
            };
            if face_key_from_meta(&meta).as_deref() == Some(key.as_str()) {
                std::fs::remove_dir_all(&path)
                    .map_err(|e| format!("Cannot remove font directory: {e}"))?;
                removed = true;
            }
        }
        project_refs.face_documents.remove(&key);
        tombstones.face_keys.insert(key);
        write_tombstones(&root, &tombstones)?;
        write_project_refs(&root, &project_refs)?;
        return Ok(removed);
    }

    let family = family.as_deref().unwrap_or_default();
    let root = font_dir(&app)?;
    let mut tombstones = read_tombstones(&root)?;
    let mut project_refs = read_project_refs(&root)?;
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
            if let Some(key) = face_key_from_meta(&meta) {
                project_refs.face_documents.remove(&key);
                tombstones.face_keys.insert(key);
            }
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
    if !matches.is_empty() {
        tombstones.family_keys.insert(family_tombstone_key(family));
        write_tombstones(&root, &tombstones)?;
        write_project_refs(&root, &project_refs)?;
    }
    Ok(!matches.is_empty())
}

/// Release project-scoped faces retained by a document that has been closed.
/// Shared faces remain until their final document reference disappears.
#[tauri::command]
pub fn release_document_fonts(app: tauri::AppHandle, document_id: String) -> Result<u32, String> {
    if document_id.trim().is_empty() {
        return Ok(0);
    }
    let root = font_dir(&app)?;
    release_document_fonts_at(&root, &document_id)
}

fn release_document_fonts_at(root: &Path, document_id: &str) -> Result<u32, String> {
    if document_id.trim().is_empty() {
        return Ok(0);
    }
    let root = root.to_path_buf();
    let mut refs = read_project_refs(&root)?;
    let candidate_faces: Vec<String> = refs
        .face_documents
        .iter_mut()
        .filter_map(|(face_key, documents)| {
            documents.remove(document_id);
            if documents.is_empty() {
                Some(face_key.clone())
            } else {
                None
            }
        })
        .collect();
    let mut tombstones = read_tombstones(&root)?;
    let mut removed = 0u32;
    for face_key in candidate_faces {
        let dir = face_storage_path_at(&root, &face_key)?;
        let Some(meta) = std::fs::read_to_string(meta_path(&dir))
            .ok()
            .and_then(|content| serde_json::from_str::<FontStorageMeta>(&content).ok())
        else {
            refs.face_documents.remove(&face_key);
            continue;
        };
        if !is_project_scoped(&meta) {
            refs.face_documents.remove(&face_key);
            continue;
        }
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|error| format!("Cannot remove project font directory: {error}"))?;
            removed += 1;
        }
        refs.face_documents.remove(&face_key);
        tombstones.face_keys.insert(face_key);
    }
    write_project_refs(&root, &refs)?;
    write_tombstones(&root, &tombstones)?;
    Ok(removed)
}

#[tauri::command]
pub fn get_filesystem_font_storage_usage(app: tauri::AppHandle) -> Result<(u64, u64), String> {
    let dir = font_dir(&app)?;
    let tombstones = read_tombstones(&dir)?;
    let mut total_bytes = 0u64;
    let mut font_count = 0u64;

    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read font dir: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let family = std::fs::read_to_string(meta_path(&path))
            .ok()
            .and_then(|content| serde_json::from_str::<FontStorageMeta>(&content).ok())
            .map(|meta| meta.family);
        if family
            .as_deref()
            .map(|name| path_is_tombstoned(&path, name, &tombstones))
            .unwrap_or(false)
        {
            continue;
        }
        if let Ok(read_dir) = std::fs::read_dir(&path) {
            for file in read_dir.flatten() {
                if let Ok(meta) = file.metadata() {
                    if meta.is_file() {
                        total_bytes += meta.len();
                    }
                }
            }
            font_count += 1;
        }
    }

    Ok((font_count, total_bytes))
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_face_key, face_key_from_meta, face_storage_path_at, family_tombstone_key,
        font_file_path, is_canonical_face_key, meta_path, path_is_tombstoned, read_project_refs,
        read_tombstones, release_document_fonts_at, select_family_storage_path, write_project_refs,
        FontProjectReferences, FontStorageMeta, FontStorageTombstones, StoreFontRequest,
    };
    use std::{collections::BTreeSet, path::PathBuf};

    const DIGEST: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn store_request_deserializes_camel_case_payload_and_optional_metadata() {
        let request: StoreFontRequest =
            serde_json::from_str(r#"{"family":"Inter","data":[0,1,255],"providerId":"catalog"}"#)
                .expect("deserialize command request");

        assert_eq!(request.family, "Inter");
        assert_eq!(request.data, [0, 1, 255]);
        assert_eq!(request.provider_id.as_deref(), Some("catalog"));
        assert_eq!(request.license_name, None);
        assert_eq!(request.document_id, None);
    }

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

    #[test]
    fn family_lookup_rejects_ambiguous_hash_directories() {
        let legacy = PathBuf::from("legacy-family");
        let matches = [PathBuf::from("face-a"), PathBuf::from("face-b")];
        let error = select_family_storage_path(legacy, false, &matches, "Inter").unwrap_err();
        assert!(error.contains("exact face identity"));
    }

    #[test]
    fn family_lookup_keeps_legacy_and_unique_compatibility_paths() {
        let legacy = PathBuf::from("legacy-family");
        let hash_path = PathBuf::from("face-a");
        assert_eq!(
            select_family_storage_path(
                legacy.clone(),
                true,
                std::slice::from_ref(&hash_path),
                "Inter"
            )
            .unwrap(),
            legacy
        );
        assert_eq!(
            select_family_storage_path(legacy, false, std::slice::from_ref(&hash_path), "Inter",)
                .unwrap(),
            hash_path
        );
    }

    #[test]
    fn family_tombstone_keys_are_case_insensitive() {
        assert_eq!(family_tombstone_key("  Inter  "), "family:inter");
    }

    #[test]
    fn metadata_face_identity_is_canonical_and_tombstone_filter_is_exact() {
        let digest = DIGEST.to_uppercase();
        let meta = FontStorageMeta {
            family: "Inter".into(),
            provider_id: None,
            license_name: None,
            license_url: None,
            attribution: None,
            version: None,
            stored_at: "now".into(),
            file_size_bytes: 1,
            sha256: digest,
            face_key: Some(format!("sha256:{DIGEST}:single")),
            collection_index: None,
            post_script_name: None,
            document_id: None,
            scope: Some("persistent".into()),
            integrity: "verified".into(),
        };
        let key = face_key_from_meta(&meta).expect("metadata should contain a valid face key");
        assert_eq!(key, format!("sha256:{DIGEST}:single").to_lowercase());

        let root = std::env::temp_dir().join(format!(
            "varve-font-storage-tombstone-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test directory");
        std::fs::write(
            root.join("meta.json"),
            serde_json::to_string(&meta).expect("serialize metadata"),
        )
        .expect("write metadata");
        let mut tombstones = FontStorageTombstones::default();
        assert!(!path_is_tombstoned(&root, "Inter", &tombstones));
        tombstones.face_keys.insert(key);
        assert!(path_is_tombstoned(&root, "Other", &tombstones));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finds_true_type_and_open_type_collection_files_after_restart() {
        let root = std::env::temp_dir().join(format!(
            "varve-font-storage-collection-file-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create test directory");

        for extension in ["ttc", "otc"] {
            let path = root.join(format!("font.{extension}"));
            std::fs::write(&path, b"collection").expect("write collection fixture");
            assert_eq!(font_file_path(&root), path);
            std::fs::remove_file(path).expect("remove collection fixture");
        }

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn releases_project_faces_only_after_the_last_document_closes() {
        let root = std::env::temp_dir().join(format!(
            "varve-font-project-release-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create font storage directory");
        let face_key = format!("sha256:{DIGEST}:single");
        let face_dir = face_storage_path_at(&root, &face_key).expect("canonical face path");
        std::fs::create_dir_all(&face_dir).expect("create project face directory");
        let meta = FontStorageMeta {
            family: "Project Face".into(),
            provider_id: None,
            license_name: None,
            license_url: None,
            attribution: None,
            version: None,
            stored_at: "now".into(),
            file_size_bytes: 4,
            sha256: DIGEST.into(),
            face_key: Some(face_key.clone()),
            collection_index: None,
            post_script_name: None,
            document_id: Some("doc-a".into()),
            scope: Some("project".into()),
            integrity: "verified".into(),
        };
        std::fs::write(meta_path(&face_dir), serde_json::to_vec(&meta).unwrap())
            .expect("write font metadata");
        std::fs::write(face_dir.join("font.ttf"), b"font").expect("write font bytes");
        let mut refs = FontProjectReferences::default();
        refs.face_documents.insert(
            face_key.clone(),
            BTreeSet::from(["doc-a".into(), "doc-b".into()]),
        );
        write_project_refs(&root, &refs).expect("write shared project references");

        assert_eq!(release_document_fonts_at(&root, "doc-a").unwrap(), 0);
        assert!(
            face_dir.exists(),
            "the second document still retains the face"
        );
        assert_eq!(
            read_project_refs(&root).unwrap().face_documents[&face_key],
            BTreeSet::from(["doc-b".into()])
        );

        assert_eq!(release_document_fonts_at(&root, "doc-b").unwrap(), 1);
        assert!(
            !face_dir.exists(),
            "the final project reference removes the face"
        );
        assert!(
            read_tombstones(&root)
                .unwrap()
                .face_keys
                .contains(&face_key),
            "removed face identity remains tombstoned"
        );
        assert_eq!(release_document_fonts_at(&root, "doc-b").unwrap(), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn closing_a_document_never_removes_a_persistent_font() {
        let root = std::env::temp_dir().join(format!(
            "varve-font-persistent-release-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create font storage directory");
        let face_key = format!("sha256:{DIGEST}:single");
        let face_dir = face_storage_path_at(&root, &face_key).expect("canonical face path");
        std::fs::create_dir_all(&face_dir).expect("create persistent face directory");
        let meta = FontStorageMeta {
            family: "Persistent Face".into(),
            provider_id: None,
            license_name: None,
            license_url: None,
            attribution: None,
            version: None,
            stored_at: "now".into(),
            file_size_bytes: 4,
            sha256: DIGEST.into(),
            face_key: Some(face_key.clone()),
            collection_index: None,
            post_script_name: None,
            document_id: None,
            scope: Some("persistent".into()),
            integrity: "verified".into(),
        };
        std::fs::write(meta_path(&face_dir), serde_json::to_vec(&meta).unwrap())
            .expect("write font metadata");
        let mut refs = FontProjectReferences::default();
        refs.face_documents
            .insert(face_key.clone(), BTreeSet::from(["doc-a".into()]));
        write_project_refs(&root, &refs).expect("write project reference");

        assert_eq!(release_document_fonts_at(&root, "doc-a").unwrap(), 0);
        assert!(
            face_dir.exists(),
            "persistent font bytes survive document close"
        );
        assert!(!read_tombstones(&root)
            .unwrap()
            .face_keys
            .contains(&face_key));
        let _ = std::fs::remove_dir_all(root);
    }
}
