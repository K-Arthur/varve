//! Font subsetting for PDF font embedding.
//!
//! Provides font subsetting via the `font-subset` crate, embedding permission
//! validation, character collection, and missing-font detection utilities.
//!
//! Research basis: ISO 32000-1:2008 §9.7 (font subsetting), OpenType OS/2
//! fsType field (font embedding permissions per the Microsoft spec).

use std::collections::{BTreeSet, HashSet};

use font_subset::{Font, FontReader, UsagePermissions};

/// Embedding permission for a font derived from the OS/2 fsType field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingPermission {
    /// fsType=0 — unrestricted embedding, subsetting allowed.
    Installable,
    /// fsType=2 — no embedding allowed.
    Restricted,
    /// fsType=4 — may embed for preview/print only; subsetting allowed.
    PreviewAndPrint,
    /// fsType=8 — may embed for editing; subsetting allowed.
    Editable,
    /// Flag (fsType bit 8 = 0x0100) — subsetting prohibited even when
    /// embedding is otherwise permitted.
    NoSubsetting,
}

/// Embedding restriction handling policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingRestriction {
    /// Warn when a font cannot be embedded but proceed.
    Warn,
    /// Block export when a font cannot be embedded.
    Block,
    /// Substitute missing/unavailable fonts with a default fallback.
    Substitute,
}

impl Default for EmbeddingRestriction {
    fn default() -> Self {
        Self::Warn
    }
}

/// Parse `UsagePermissions` from `font-subset` into our domain type.
fn classify_permissions(fp: &UsagePermissions) -> EmbeddingPermission {
    use font_subset::EmbeddingPermissions as FS;
    match fp.embedding {
        FS::Installable => EmbeddingPermission::Installable,
        FS::RestrictedLicense => EmbeddingPermission::Restricted,
        FS::PreviewAndPrint => EmbeddingPermission::PreviewAndPrint,
        FS::Editable => EmbeddingPermission::Editable,
    }
}

/// Validate whether the font at `font_data` may be embedded in a PDF.
///
/// Returns `Ok(perm)` when the OS/2 fsType field could be read. Callers
/// should inspect the permission and act according to their policy:
///
/// | permission      | embeddable | subsettable |
/// |-----------------|------------|-------------|
/// | Installable     | yes        | yes         |
/// | PreviewAndPrint | yes        | yes         |
/// | Editable        | yes        | yes         |
/// | Restricted      | no         | —           |
/// | NoSubsetting    | yes        | no          |
pub fn validate_embedding_permission(font_data: &[u8]) -> Result<EmbeddingPermission, String> {
    let reader = FontReader::new(font_data).map_err(|e| format!("Failed to read font: {e}"))?;
    let font: Font<'_> = reader
        .read()
        .map_err(|e| format!("Failed to parse font: {e}"))?;
    let perms = font.permissions();

    if !perms.allow_subsetting {
        return Ok(EmbeddingPermission::NoSubsetting);
    }

    Ok(classify_permissions(&perms))
}

/// Subset a font to only the glyphs used by `used_chars`.
///
/// `font_data` should be raw TTF/OTF bytes. Returns the subset font as
/// OpenType bytes. Returns an error if font parsing or subsetting fails.
pub fn subset_font(font_data: &[u8], used_chars: &[char]) -> Result<Vec<u8>, String> {
    if used_chars.is_empty() {
        return Ok(font_data.to_vec());
    }

    let reader = FontReader::new(font_data).map_err(|e| format!("Failed to read font: {e}"))?;
    let font: Font<'_> = reader
        .read()
        .map_err(|e| format!("Failed to parse font: {e}"))?;

    let chars: BTreeSet<char> = used_chars.iter().copied().collect();
    let subset = font
        .subset(&chars)
        .map_err(|e| format!("Failed to subset font: {e}"))?;

    Ok(subset.to_opentype())
}

/// Collect unique Unicode characters from `text`.
///
/// Returns a deduplicated vector of chars in their first-occurrence order.
pub fn collect_used_chars(text: &str) -> Vec<char> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for ch in text.chars() {
        if seen.insert(ch) {
            result.push(ch);
        }
    }
    result
}

/// Detect which font family names from `used_families` have no corresponding
/// data in `available_fonts`.
///
/// `available_fonts` is a slice of `(family_name, font_bytes)` pairs, matching
/// the `PdfOptions.fonts` field.
///
/// Returns the family names that are missing.
pub fn detect_missing_fonts(
    used_families: &[String],
    available_fonts: &[(String, Vec<u8>)],
) -> Vec<String> {
    let available: HashSet<&str> = available_fonts
        .iter()
        .map(|(name, _)| name.as_str())
        .collect();
    used_families
        .iter()
        .filter(|family| !available.contains(family.as_str()))
        .cloned()
        .collect()
}

/// Generate a deterministic 6-uppercase-letter PDF subset tag prefix.
///
/// The prefix is derived from a hash of `font_name`, producing a string like
/// `"ABCDEF+"`. PDF convention (ISO 32000-1 §9.7) requires subset font names
/// to start with a 6-uppercase-letter prefix followed by `+`.
pub fn get_subset_tag(font_name: &str) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    font_name.hash(&mut hasher);
    let hash = hasher.finish();

    let mut tag = String::with_capacity(7);
    for i in 0..6 {
        let nibble = ((hash >> (i * 4)) & 0xF) as u8;
        let c = (b'A' + nibble) as char;
        tag.push(c);
    }
    tag.push('+');
    tag
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_font_data() -> Vec<u8> {
        let paths = [
            "/usr/share/fonts/TTF/OpenSans-Regular.ttf",
            "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
            "/usr/share/fonts/TTF/Vera.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/Inter-Regular.ttf",
        ];
        for p in &paths {
            if let Ok(data) = std::fs::read(p) {
                return data;
            }
        }
        panic!("no test font found — tried {paths:?}")
    }

    #[test]
    fn test_subset_ascii() {
        let font_data = test_font_data();
        let full_len = font_data.len();

        let ascii_chars: Vec<char> =
            " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-():;\"'"
                .chars()
                .collect();
        let subset = subset_font(&font_data, &ascii_chars).expect("subset ASCII");

        assert!(
            subset.len() < full_len,
            "subset ({}) should be smaller than original ({})",
            subset.len(),
            full_len
        );
        assert!(!subset.is_empty(), "subset should not be empty");
        assert!(
            subset.starts_with(&[0x00, 0x01, 0x00, 0x00])
                || subset.starts_with(b"OTTO")
                || subset.starts_with(b"true"),
            "subset should be valid font data, starts with: {:02x} {:02x} {:02x} {:02x}",
            subset[0],
            subset[1],
            subset[2],
            subset[3]
        );
    }

    #[test]
    fn test_subset_multilingual() {
        let font_data = test_font_data();
        let chars: Vec<char> = "Hello 你好 こんにちは".chars().collect();
        let subset = subset_font(&font_data, &chars).expect("subset multilingual");
        assert!(!subset.is_empty(), "subset should not be empty");
    }

    #[test]
    fn test_subset_empty_chars() {
        let font_data = test_font_data();
        let subset = subset_font(&font_data, &[]).expect("subset empty");
        assert_eq!(
            subset.len(),
            font_data.len(),
            "empty chars subset should return original font data unchanged"
        );
    }

    #[test]
    fn test_embedding_installable() {
        let font_data = test_font_data();
        let perm = validate_embedding_permission(&font_data).expect("validate permissions");
        assert_eq!(
            perm,
            EmbeddingPermission::Installable,
            "expected Installable embedding, got {perm:?}"
        );
    }

    #[test]
    fn test_embedding_invalid_data() {
        let result = validate_embedding_permission(b"not a font");
        assert!(result.is_err(), "invalid font data should fail");
    }

    #[test]
    fn test_collect_chars() {
        let chars = collect_used_chars("hello world hello");
        assert_eq!(chars.len(), 8);
        assert_eq!(chars, vec!['h', 'e', 'l', 'o', ' ', 'w', 'r', 'd']);
    }

    #[test]
    fn test_collect_chars_empty() {
        let chars = collect_used_chars("");
        assert!(chars.is_empty());
    }

    #[test]
    fn test_collect_chars_unicode() {
        let chars = collect_used_chars("héllo wörld");
        assert!(chars.contains(&'é'));
        assert!(chars.contains(&'ö'));
    }

    #[test]
    fn test_detect_missing() {
        let used = vec!["Arial".into(), "DejaVu Sans".into(), "Helvetica".into()];
        let available = vec![("DejaVu Sans".into(), vec![1, 2, 3])];
        let missing = detect_missing_fonts(&used, &available);
        assert_eq!(missing.len(), 2);
        assert!(missing.contains(&"Arial".to_string()));
        assert!(missing.contains(&"Helvetica".to_string()));
        assert!(!missing.contains(&"DejaVu Sans".to_string()));
    }

    #[test]
    fn test_detect_missing_all_present() {
        let used = vec!["FontA".into(), "FontB".into()];
        let available = vec![("FontA".into(), vec![1]), ("FontB".into(), vec![2])];
        let missing = detect_missing_fonts(&used, &available);
        assert!(missing.is_empty());
    }

    #[test]
    fn test_get_subset_tag() {
        let tag = get_subset_tag("DejaVuSans");
        assert_eq!(tag.len(), 7);
        assert!(tag.ends_with('+'));
        for c in tag.chars().take(6) {
            assert!(c.is_ascii_uppercase(), "tag char {c:?} should be uppercase");
        }
    }

    #[test]
    fn test_get_subset_tag_deterministic() {
        let tag1 = get_subset_tag("Inter-Regular");
        let tag2 = get_subset_tag("Inter-Regular");
        assert_eq!(tag1, tag2, "same name should produce same tag");
    }

    #[test]
    fn test_get_subset_tag_different_fonts() {
        let tag_a = get_subset_tag("FontA");
        let tag_b = get_subset_tag("FontB");
        assert_ne!(
            tag_a, tag_b,
            "different font names should produce different tags"
        );
    }
}
