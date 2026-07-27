use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single system font face as seen by the native OS font database.
#[derive(Debug, Clone, Serialize)]
pub struct SystemFontFace {
    pub family: String,
    pub name: String,
    pub path: String,
    pub style: String,
    pub weight: f32,
    pub stretch: f32,
}

/// Request payload for system font enumeration.
#[derive(Debug, Deserialize)]
pub struct EnumerateSystemFontsRequest {
    /// Optional family filter. When provided, only fonts whose family name
    /// contains this substring (case-insensitive) are returned.
    pub family: Option<String>,
}

/// Enumerate fonts installed on the host operating system.
#[tauri::command]
pub fn enumerate_system_fonts(
    request: EnumerateSystemFontsRequest,
) -> Result<Vec<SystemFontFace>, String> {
    let collection = font_enumeration::Collection::new()
        .map_err(|e| format!("failed to open system font collection: {e}"))?;

    let fonts = collection.all();
    let filter = request
        .family
        .as_ref()
        .map(|f| f.to_lowercase());

    // Deduplicate by (family, name) so the same physical file isn't returned
    // multiple times if the OS lists it under several aliases.
    let mut seen: HashMap<(String, String), bool> = HashMap::new();
    let mut result: Vec<SystemFontFace> = Vec::new();

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

        result.push(SystemFontFace {
            family: font.family_name,
            name: font.font_name,
            path: font.path.to_string_lossy().to_string(),
            style,
            weight: font.weight.value(),
            stretch: font.stretch.value(),
        });
    }

    // Return in a stable, predictable order.
    result.sort_by(|a, b| a.family.cmp(&b.family).then_with(|| a.name.cmp(&b.name)));
    Ok(result)
}
