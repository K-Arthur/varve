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
    let filter = request.family.as_ref().map(|f| f.to_lowercase());

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
            family: font.family_name.clone(),
            name: font.font_name.clone(),
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
        enumerate_system_fonts(EnumerateSystemFontsRequest {
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
}
