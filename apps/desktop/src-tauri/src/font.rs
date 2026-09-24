use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path};

/// A single system font face as seen by the native OS font database.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontFace {
    pub family: String,
    pub name: String,
    pub path: String,
    pub style: String,
    pub weight: f32,
    pub stretch: f32,
    /// Opaque handle used by the native loader. The path remains metadata for
    /// diagnostics, while callers use this handle for exact access.
    pub handle: Option<String>,
    /// SHA-256 of the original artifact, when the file was readable.
    pub artifact_hash: Option<String>,
    /// Collection member selected by the native font database, when known.
    pub collection_index: Option<u32>,
    /// Portable face identity derived from the original artifact.
    pub face_key: Option<String>,
}

/// Request payload for system font enumeration.
#[derive(Debug, Deserialize)]
pub struct EnumerateSystemFontsRequest {
    /// Optional family filter. When provided, only fonts whose family name
    /// contains this substring (case-insensitive) are returned.
    pub family: Option<String>,
}

/// Request payload for loading one enumerated system face.
#[derive(Debug, Deserialize)]
pub struct LoadSystemFontRequest {
    pub handle: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct NativeFontHandle {
    version: u8,
    path: String,
    family: String,
    name: String,
    artifact_hash: String,
    collection_index: Option<u32>,
}

fn name_for_face(face: &ttf_parser::Face<'_>, name_id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .filter(|record| record.name_id == name_id)
        .find_map(|record| record.to_string())
}

fn face_index_for_font(data: &[u8], family: &str, name: &str) -> Option<u32> {
    let count = ttf_parser::fonts_in_collection(data).unwrap_or(1);
    for index in 0..count {
        let Ok(face) = ttf_parser::Face::parse(data, index) else {
            continue;
        };
        let face_family = name_for_face(&face, ttf_parser::name_id::FAMILY);
        let full_name = name_for_face(&face, ttf_parser::name_id::FULL_NAME);
        let post_script = name_for_face(&face, ttf_parser::name_id::POST_SCRIPT_NAME);
        let family_matches = face_family
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case(family));
        let name_matches = [full_name.as_deref(), post_script.as_deref()]
            .into_iter()
            .flatten()
            .any(|value| value.eq_ignore_ascii_case(name));
        if family_matches && name_matches {
            return Some(index);
        }
    }
    None
}

fn artifact_hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn encode_handle(handle: &NativeFontHandle) -> Option<String> {
    serde_json::to_vec(handle)
        .ok()
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_handle(value: &str) -> Result<NativeFontHandle, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Invalid system font handle".to_string())?;
    let handle: NativeFontHandle =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid system font handle".to_string())?;
    if handle.version != 1
        || handle.path.is_empty()
        || handle.family.is_empty()
        || handle.name.is_empty()
        || !handle
            .artifact_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || handle.artifact_hash.len() != 64
    {
        return Err("Invalid system font handle".to_string());
    }
    Ok(handle)
}

/// Build a handle for one face while reusing bytes read for the containing
/// artifact. A collection can expose several faces from the same path; the
/// member index must therefore be resolved per `(family, name)`, never cached
/// once per path.
fn build_face_handle_from_data(
    path: &Path,
    family: &str,
    name: &str,
    data: &[u8],
    hash: &str,
) -> Option<(String, String, Option<u32>)> {
    let collection_index = face_index_for_font(data, family, name);
    let handle = NativeFontHandle {
        version: 1,
        path: path.to_string_lossy().into_owned(),
        family: family.to_string(),
        name: name.to_string(),
        artifact_hash: hash.to_string(),
        collection_index,
    };
    Some((encode_handle(&handle)?, hash.to_string(), collection_index))
}

/// Enumerate fonts installed on the host operating system.
#[tauri::command]
pub async fn enumerate_system_fonts(
    request: EnumerateSystemFontsRequest,
) -> Result<Vec<SystemFontFace>, String> {
    tauri::async_runtime::spawn_blocking(move || enumerate_system_fonts_sync(request))
        .await
        .map_err(|error| format!("font enumeration worker failed: {error}"))?
}

fn enumerate_system_fonts_sync(
    request: EnumerateSystemFontsRequest,
) -> Result<Vec<SystemFontFace>, String> {
    let collection = font_enumeration::Collection::new()
        .map_err(|e| format!("failed to open system font collection: {e}"))?;

    let fonts = collection.all();
    let filter = request.family.as_ref().map(|f| f.to_lowercase());

    // Deduplicate by (family, name) so the same physical file isn't returned
    // multiple times if the OS lists it under several aliases.
    let mut seen: HashMap<(String, String), bool> = HashMap::new();
    let mut result: Vec<SystemFontFace> = Vec::new();
    // Cache the immutable artifact bytes and hash once per path. Handle and
    // collection-member resolution remains per enumerated face below.
    let mut file_cache: HashMap<std::path::PathBuf, Option<(Vec<u8>, String)>> = HashMap::new();

    for font in fonts {
        if let Some(ref needle) = filter {
            if !font.family_name.to_lowercase().contains(needle) {
                continue;
            }
        }

        let key = (font.family_name.clone(), font.font_name.clone());
        if seen.insert(key, true).is_some() {
            continue;
        }

        let style = match font.style {
            font_enumeration::Style::Normal => "normal".to_string(),
            font_enumeration::Style::Italic => "italic".to_string(),
            font_enumeration::Style::Oblique(angle) => {
                if let Some(a) = angle {
                    format!("oblique {a}deg")
                } else {
                    "oblique".to_string()
                }
            }
        };

        let path = font.path.to_path_buf();
        let cached = file_cache.entry(path.clone()).or_insert_with(|| {
            std::fs::read(&path).ok().map(|data| {
                let hash = artifact_hash(&data);
                (data, hash)
            })
        });
        let details = cached.as_ref().and_then(|(data, hash)| {
            build_face_handle_from_data(&path, &font.family_name, &font.font_name, data, hash)
                .map(|(handle, _face_hash, index)| (hash.clone(), index, handle))
        });
        let (artifact_hash, collection_index, handle, face_key) = details
            .map(|(hash, index, handle)| {
                let member = index.map_or_else(|| "single".to_string(), |value| value.to_string());
                (
                    Some(hash.clone()),
                    index,
                    Some(handle),
                    Some(format!("sha256:{hash}:{member}")),
                )
            })
            .unwrap_or((None, None, None, None));

        result.push(SystemFontFace {
            family: font.family_name.clone(),
            name: font.font_name.clone(),
            path: path.to_string_lossy().to_string(),
            style,
            weight: font.weight.value(),
            stretch: font.stretch.value(),
            handle,
            artifact_hash,
            collection_index,
            face_key,
        });
    }

    // Return in a stable, predictable order.
    result.sort_by(|a, b| a.family.cmp(&b.family).then_with(|| a.name.cmp(&b.name)));
    Ok(result)
}

/// Load bytes for an enumerated face through a validated opaque handle.
///
/// The handle is checked against a fresh system-font enumeration and the file
/// hash before any bytes leave the native process. This prevents a webview
/// caller from turning the command into an arbitrary filesystem reader.
#[tauri::command]
pub async fn load_system_font(request: LoadSystemFontRequest) -> Result<Option<Vec<u8>>, String> {
    tauri::async_runtime::spawn_blocking(move || load_system_font_sync(request))
        .await
        .map_err(|error| format!("font loading worker failed: {error}"))?
}

fn load_system_font_sync(request: LoadSystemFontRequest) -> Result<Option<Vec<u8>>, String> {
    let handle = decode_handle(&request.handle)?;
    let collection = font_enumeration::Collection::new()
        .map_err(|e| format!("failed to open system font collection: {e}"))?;
    let listed = collection.all().any(|font| {
        font.family_name.eq_ignore_ascii_case(&handle.family)
            && font.font_name.eq_ignore_ascii_case(&handle.name)
            && font.path.to_string_lossy() == handle.path
    });
    if !listed {
        return Ok(None);
    }
    let data = std::fs::read(&handle.path)
        .map_err(|error| format!("Could not read enumerated system font: {error}"))?;
    if artifact_hash(&data) != handle.artifact_hash.to_ascii_lowercase() {
        return Err("System font changed since enumeration; refresh local fonts".into());
    }
    if let Some(index) = handle.collection_index {
        let Some(found) = face_index_for_font(&data, &handle.family, &handle.name) else {
            return Err("The enumerated collection member is no longer available".into());
        };
        if found != index {
            return Err("The enumerated collection member changed; refresh local fonts".into());
        }
    }
    Ok(Some(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The font list drives a user-facing picker, so the three properties that
    /// matter are: no duplicates, stable ordering, and an honest filter. All
    /// three are asserted against whatever fonts the host actually has, so the
    /// test stays meaningful on a developer machine and a bare CI runner alike.
    ///
    /// A host with no font collection at all is tolerated — that is an
    /// environment fact, not a defect in this code — but the invariants are
    /// still checked whenever fonts are present.
    fn enumerate(family: Option<&str>) -> Option<Vec<SystemFontFace>> {
        enumerate_system_fonts_sync(EnumerateSystemFontsRequest {
            family: family.map(str::to_string),
        })
        .ok()
    }

    #[test]
    fn enumeration_is_deduplicated_and_sorted() {
        let Some(fonts) = enumerate(None) else {
            eprintln!("no system font collection on this host; skipping invariant checks");
            return;
        };

        let mut keys: Vec<(&str, &str)> = fonts
            .iter()
            .map(|f| (f.family.as_str(), f.name.as_str()))
            .collect();
        let before = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(
            keys.len(),
            before,
            "the same (family, name) pair was returned more than once"
        );

        let sorted = fonts.is_sorted_by(|a, b| (&a.family, &a.name) <= (&b.family, &b.name));
        assert!(
            sorted,
            "results must come back in stable (family, name) order"
        );
    }

    #[test]
    fn family_filter_is_a_case_insensitive_substring_match() {
        let Some(all) = enumerate(None) else {
            eprintln!("no system font collection on this host; skipping filter check");
            return;
        };
        let Some(first) = all.first() else {
            eprintln!("host reports zero fonts; skipping filter check");
            return;
        };

        // Upper-cased so a match proves the comparison is case-insensitive
        // rather than accidentally exact.
        let needle = first.family.to_uppercase();
        let filtered = enumerate(Some(&needle)).expect("filtered enumeration should succeed");

        assert!(
            !filtered.is_empty(),
            "filtering by an existing family returned nothing"
        );
        assert!(
            filtered
                .iter()
                .all(|f| f.family.to_lowercase().contains(&needle.to_lowercase())),
            "filter let through a family that does not contain the needle"
        );
        assert!(
            filtered.len() <= all.len(),
            "a filter must never widen the result set"
        );
    }

    #[test]
    fn an_unmatched_filter_returns_an_empty_list_rather_than_everything() {
        let Some(fonts) = enumerate(Some("zzz-no-such-font-family-zzz")) else {
            eprintln!("no system font collection on this host; skipping empty-filter check");
            return;
        };
        assert!(
            fonts.is_empty(),
            "a filter matching nothing must return nothing, not the unfiltered list"
        );
    }

    #[test]
    fn opaque_handle_round_trips_without_exposing_a_path_contract() {
        let handle = NativeFontHandle {
            version: 1,
            path: "/fonts/Example.ttf".into(),
            family: "Example".into(),
            name: "Example Regular".into(),
            artifact_hash: "a".repeat(64),
            collection_index: Some(0),
        };
        let encoded = encode_handle(&handle).expect("handle encoding");
        let decoded = decode_handle(&encoded).expect("handle decoding");
        assert_eq!(decoded.path, handle.path);
        assert_eq!(decoded.collection_index, Some(0));
        assert!(decode_handle("not-a-font-handle").is_err());
    }
}
