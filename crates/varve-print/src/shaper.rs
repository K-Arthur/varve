//! Native text shaping via rustybuzz (HarfBuzz bindings for Rust).
//!
//! Provides glyph-level shaping with real glyph IDs, clusters, positioning,
//! ligature substitution, kerning, and OpenType feature control.
//!
//! The output is a vector of positioned glyphs that can be used for:
//! - Native PDF text output (searchable/selectable)
//! - Glyph-ID-accurate vector outlining
//! - Per-glyph hit testing
//!
//! Research basis: rustybuzz docs, HarfBuzz manual, OpenType spec.

use serde::{Deserialize, Serialize};

/// A single shaped glyph with positioning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapedGlyph {
    /// Glyph ID in the font (glyph index).
    pub glyph_id: u32,
    /// Advance width in font units (before scaling).
    pub x_advance: i32,
    /// Advance height in font units.
    pub y_advance: i32,
    /// X offset from glyph origin (GPOS mark/kerning).
    pub x_offset: i32,
    /// Y offset from glyph origin.
    pub y_offset: i32,
    /// UTF-16 cluster index into the input text.
    pub cluster: u32,
}

/// Result of shaping a single run of text with one font.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapedRun {
    /// Shaped glyphs in visual order.
    pub glyphs: Vec<ShapedGlyph>,
    /// Resolved text direction.
    pub direction: String,
    /// Resolved script tag (e.g. "Latn", "Arab").
    pub script: String,
    /// Language tag (e.g. "en", "ar").
    pub language: Option<String>,
    /// Whether the shaping engine detected colour glyphs.
    pub has_color_glyphs: bool,
    /// Any glyph IDs that resolved to .notdef.
    pub missing_glyph_indices: Vec<usize>,
    /// Warnings from the shaping process.
    pub warnings: Vec<String>,
}

/// Input shaping request, designed for IPC serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeRequest {
    /// Text to shape.
    pub text: String,
    /// Font binary data (TTF/OTF).
    pub font_data: Vec<u8>,
    /// Face index for TTC/OTC collections.
    #[serde(default)]
    pub face_index: u32,
    /// Font size in points.
    pub font_size: f64,
    /// ISO 639-1 language code (e.g. "en").
    pub language: Option<String>,
    /// ISO 15924 script code (e.g. "Latn"). Auto-detected if None.
    pub script: Option<String>,
    /// Text direction. Auto-detected if None.
    pub direction: Option<String>,
    /// OpenType feature tags to enable (e.g. ["liga", "kern"]).
    #[serde(default)]
    pub features: Vec<String>,
    /// OpenType feature tags to disable.
    #[serde(default)]
    pub disable_features: Vec<String>,
    /// Variable font axis settings (tag -> value).
    #[serde(default)]
    pub variation_axes: std::collections::HashMap<String, f32>,
}

/// Shape a run of text using rustybuzz.
/// Returns the shaped glyphs with real glyph IDs, clusters, and positioning.
pub fn shape_text(request: &ShapeRequest) -> Result<ShapedRun, String> {
    let font_data = &request.font_data;

    // Create the HarfBuzz face
    let mut hb_face = rustybuzz::Face::from_slice(font_data, request.face_index)
        .ok_or_else(|| "Failed to create HarfBuzz face".to_string())?;

    let _units_per_em = hb_face.units_per_em();

    // Resolve direction
    let direction = match request.direction.as_deref() {
        Some("rtl") => rustybuzz::Direction::RightToLeft,
        Some("ttb") => rustybuzz::Direction::TopToBottom,
        Some("btt") => rustybuzz::Direction::BottomToTop,
        _ => rustybuzz::Direction::LeftToRight,
    };

    // Resolve script
    let dflt_tag = ttf_parser::Tag::from_bytes(b"DFLT");
    let script = match request.script.as_deref() {
        Some(s) => {
            let bytes = s.as_bytes();
            if bytes.len() >= 4 {
                let tag = ttf_parser::Tag::from_bytes(&[bytes[0], bytes[1], bytes[2], bytes[3]]);
                rustybuzz::Script::from_iso15924_tag(tag)
                    .unwrap_or(rustybuzz::Script::from_iso15924_tag(dflt_tag).unwrap())
            } else {
                rustybuzz::Script::from_iso15924_tag(dflt_tag).unwrap()
            }
        }
        None => rustybuzz::Script::from_iso15924_tag(dflt_tag).unwrap(),
    };

    // Resolve language
    let language: Option<rustybuzz::Language> = match request.language.as_deref() {
        Some(l) => l.parse().ok(),
        None => None,
    };

    // Build rustybuzz buffer
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(&request.text);
    buffer.set_direction(direction);
    buffer.set_script(script);
    if let Some(lang) = language {
        buffer.set_language(lang);
    }

    // Build feature list
    let mut features: Vec<rustybuzz::Feature> = Vec::new();
    for tag in &request.features {
        if let Ok(feature) = parse_feature_tag(tag, true) {
            features.push(feature);
        }
    }
    for tag in &request.disable_features {
        if let Ok(feature) = parse_feature_tag(tag, false) {
            features.push(feature);
        }
    }

    // Apply variation axes
    // rustybuzz 0.18 uses Face::set_variations
    let coords: Vec<rustybuzz::Variation> = request
        .variation_axes
        .iter()
        .map(|(tag, val)| {
            let tag_bytes = tag.as_bytes();
            let mut t = [0u8; 4];
            for (i, &b) in tag_bytes.iter().enumerate().take(4) {
                t[i] = b;
            }
            let tag_u32 = u32::from_be_bytes(t);
            rustybuzz::Variation {
                tag: ttf_parser::Tag(tag_u32),
                value: *val,
            }
        })
        .collect();
    if !coords.is_empty() {
        hb_face.set_variations(&coords);
    }

    // Shape!
    let output = rustybuzz::shape(&hb_face, &features, buffer);

    let positions = output.glyph_positions();
    let infos = output.glyph_infos();

    let mut glyphs: Vec<ShapedGlyph> = Vec::with_capacity(infos.len());
    let mut missing_glyph_indices = Vec::new();
    let mut warnings = Vec::new();

    // Check for COLR/CPAL tables using raw OpenType table check
    let has_color_glyphs = check_color_tables(font_data, request.face_index);

    for (i, (info, pos)) in infos.iter().zip(positions.iter()).enumerate() {
        let glyph_id = info.glyph_id;

        if glyph_id == 0 {
            missing_glyph_indices.push(i);
        }

        glyphs.push(ShapedGlyph {
            glyph_id,
            x_advance: pos.x_advance,
            y_advance: pos.y_advance,
            x_offset: pos.x_offset,
            y_offset: pos.y_offset,
            cluster: info.cluster,
        });
    }

    if !missing_glyph_indices.is_empty() {
        warnings.push(format!(
            "{} glyphs mapped to .notdef (missing glyphs)",
            missing_glyph_indices.len()
        ));
    }

    Ok(ShapedRun {
        glyphs,
        direction: match direction {
            rustybuzz::Direction::LeftToRight => "ltr".into(),
            rustybuzz::Direction::RightToLeft => "rtl".into(),
            rustybuzz::Direction::TopToBottom => "ttb".into(),
            rustybuzz::Direction::BottomToTop => "btt".into(),
            rustybuzz::Direction::Invalid => "ltr".into(),
        },
        script: request.script.clone().unwrap_or_else(|| "DFLT".to_string()),
        language: request.language.clone(),
        has_color_glyphs,
        missing_glyph_indices,
        warnings,
    })
}

/// Check whether a font has COLR/CPAL colour glyph tables.
pub fn font_has_color_glyphs(font_data: &[u8], face_index: u32) -> bool {
    check_color_tables(font_data, face_index)
}

/// Raw OpenType table presence check for colour font tables.
fn check_color_tables(data: &[u8], face_index: u32) -> bool {
    // Skip past the sfVersion and table directory to find table records
    // TrueType/OpenType offset table:
    //   sfVersion (4 bytes)
    //   numTables (2 bytes)
    //   searchRange (2 bytes)
    //   entrySelector (2 bytes)
    //   rangeShift (2 bytes)
    // Then numTables × 16-byte table records:
    //   tag (4 bytes)
    //   checksum (4 bytes)
    //   offset (4 bytes)
    //   length (4 bytes)

    // Handle TTC (TrueType Collection)
    let mut offset = 0usize;
    if data.len() >= 4 {
        let tag = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
        if tag == 0x74746366 {
            // 'ttcf' - TrueType Collection
            // Skip TTC header: tag(4) + version(4) + numFonts(4) + offsetTable[numFonts*4]
            if data.len() < 16 {
                return false;
            }
            let num_fonts = u32::from_be_bytes([data[8], data[9], data[10], data[11]]) as usize;
            if data.len() < 12 + num_fonts * 4 {
                return false;
            }
            let font_offset_bytes = &data[12 + face_index as usize * 4..][..4];
            offset = u32::from_be_bytes([
                font_offset_bytes[0],
                font_offset_bytes[1],
                font_offset_bytes[2],
                font_offset_bytes[3],
            ]) as usize;
        }
    }

    if offset + 12 > data.len() {
        return false;
    }

    let num_tables = u16::from_be_bytes([data[offset + 4], data[offset + 5]]) as usize;
    let records_start = offset + 12;

    if records_start + num_tables * 16 > data.len() {
        return false;
    }

    for i in 0..num_tables {
        let rec_start = records_start + i * 16;
        if rec_start + 4 > data.len() {
            continue;
        }
        let tag = u32::from_be_bytes([
            data[rec_start],
            data[rec_start + 1],
            data[rec_start + 2],
            data[rec_start + 3],
        ]);
        if tag == 0x434f4c52 || tag == 0x4350414c {
            // 'COLR' or 'CPAL'
            return true;
        }
    }

    false
}

/// Parse an OpenType feature tag string (e.g. "liga", "kern=0") into a
/// rustybuzz Feature with the given enable/disable value.
fn parse_feature_tag(tag: &str, enable: bool) -> Result<rustybuzz::Feature, String> {
    let parts: Vec<&str> = tag.split('=').collect();
    let tag_str = parts[0];
    if tag_str.len() != 4 {
        return Err(format!("Invalid feature tag: {tag}"));
    }
    let tag_bytes = tag_str.as_bytes();
    let tag_u32 = u32::from_be_bytes([tag_bytes[0], tag_bytes[1], tag_bytes[2], tag_bytes[3]]);
    let value = if parts.len() > 1 {
        parts[1]
            .parse::<u32>()
            .map_err(|_| format!("Invalid feature value: {tag}"))?
    } else if enable {
        1
    } else {
        0
    };
    Ok(rustybuzz::Feature::new(
        ttf_parser::Tag(tag_u32),
        value,
        0..usize::MAX,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every font-dependent test shapes with the committed OpenSans fixture.
    ///
    /// These tests used to look for `varve-print/tests/fonts/Geist-Variable.ttf`,
    /// a path that does not exist in the repository, and fall back to a
    /// `create_minimal_font()` helper that returned `Vec::new()`. Every caller
    /// then hit an `if font_data.is_empty() { return; }` guard, so all six
    /// shaping tests passed without shaping anything — which is why 65% of this
    /// module was never executed. The rest of the crate already resolves fonts
    /// through `test_fonts`, so use it here too.
    fn fixture_font() -> Vec<u8> {
        crate::test_fonts::test_font_bytes().to_vec()
    }

    fn latin_request(text: &str) -> ShapeRequest {
        ShapeRequest {
            text: text.into(),
            font_data: fixture_font(),
            face_index: 0,
            font_size: 16.0,
            language: Some("en".into()),
            script: Some("Latn".into()),
            direction: Some("ltr".into()),
            features: vec![],
            disable_features: vec![],
            variation_axes: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn test_basic_latin_shaping() {
        let mut request = latin_request("Hello");
        request.features = vec!["liga".into(), "kern".into()];

        let result = shape_text(&request).expect("Shaping should succeed");

        assert_eq!(result.direction, "ltr");
        assert_eq!(
            result.glyphs.len(),
            5,
            "one glyph per Latin character with no ligature substitution"
        );
        assert!(
            result.glyphs.iter().all(|g| g.glyph_id != 0),
            "no character should fall back to .notdef in a font that covers Latin"
        );
        assert!(
            result.glyphs.iter().any(|g| g.x_advance > 0),
            "shaped glyphs must carry real advances"
        );
    }

    #[test]
    fn shaping_reports_clusters_that_map_back_to_the_source_text() {
        // Clusters are how a caller maps a glyph back to the character the user
        // typed — caret placement and selection depend on it.
        let result = shape_text(&latin_request("abc")).expect("Shaping should succeed");

        let clusters: Vec<u32> = result.glyphs.iter().map(|g| g.cluster).collect();
        assert_eq!(clusters, vec![0, 1, 2], "one cluster per byte for ASCII");
    }

    #[test]
    fn right_to_left_direction_is_honoured() {
        let mut request = latin_request("abc");
        request.direction = Some("rtl".into());

        let result = shape_text(&request).expect("Shaping should succeed");

        assert_eq!(result.direction, "rtl");
        assert!(
            !result.glyphs.is_empty(),
            "RTL shaping should produce glyphs"
        );
    }

    #[test]
    fn vertical_directions_are_accepted() {
        for dir in ["ttb", "btt"] {
            let mut request = latin_request("ab");
            request.direction = Some(dir.into());

            let result =
                shape_text(&request).unwrap_or_else(|e| panic!("shaping {dir} failed: {e}"));
            assert!(
                !result.glyphs.is_empty(),
                "{dir} shaping should produce glyphs"
            );
        }
    }

    #[test]
    fn unknown_and_malformed_script_tags_fall_back_instead_of_failing() {
        // A script tag shorter than four bytes cannot form an OpenType tag, and
        // an unrecognised one has no ISO 15924 mapping. Both must degrade to
        // DFLT rather than error — script codes arrive from document data.
        for script in ["Ln", "", "Zzzz"] {
            let mut request = latin_request("hi");
            request.script = Some(script.into());

            let result = shape_text(&request)
                .unwrap_or_else(|e| panic!("script {script:?} should not fail: {e}"));
            assert!(
                !result.glyphs.is_empty(),
                "script {script:?} produced nothing"
            );
        }
    }

    #[test]
    fn absent_optional_fields_shape_with_defaults() {
        let mut request = latin_request("hi");
        request.language = None;
        request.script = None;
        request.direction = None;

        let result = shape_text(&request).expect("defaults should shape");

        assert_eq!(
            result.direction, "ltr",
            "default direction is left-to-right"
        );
        assert!(!result.glyphs.is_empty());
    }

    #[test]
    fn disabling_a_feature_is_accepted_and_shapes() {
        let mut request = latin_request("fi");
        request.disable_features = vec!["liga".into(), "kern".into()];

        let result = shape_text(&request).expect("Shaping should succeed");

        assert_eq!(
            result.glyphs.len(),
            2,
            "with liga disabled, 'fi' must stay two glyphs"
        );
    }

    #[test]
    fn unparseable_feature_tags_are_skipped_rather_than_fatal() {
        let mut request = latin_request("hi");
        request.features = vec!["".into(), "toolong".into(), "liga".into()];

        let result = shape_text(&request).expect("bad feature tags must not fail shaping");
        assert!(!result.glyphs.is_empty());
    }

    #[test]
    fn variation_axes_are_applied_without_error() {
        // OpenSans-Regular is not variable, so the axis is ignored — the point
        // is that the variation path runs and does not reject the request.
        let mut request = latin_request("hi");
        request.variation_axes.insert("wght".into(), 700.0);
        request.variation_axes.insert("toolongaxis".into(), 1.0);

        let result = shape_text(&request).expect("variation settings should not fail shaping");
        assert!(!result.glyphs.is_empty());
    }

    #[test]
    fn out_of_range_face_index_is_an_error_not_a_panic() {
        let mut request = latin_request("hi");
        request.face_index = 99;

        assert!(
            shape_text(&request).is_err(),
            "a face index past the end of the file must return Err"
        );
    }

    #[test]
    fn test_ligature_shaping() {
        let mut request = latin_request("fi");
        request.features = vec!["liga".into()];

        let result = shape_text(&request).expect("Shaping should succeed");

        assert!(!result.glyphs.is_empty(), "Should produce glyphs");
        assert!(
            result.glyphs.len() <= 2,
            "'fi' is at most two glyphs, fewer if the font ligates"
        );
    }

    #[test]
    fn test_color_font_detection() {
        assert!(
            !font_has_color_glyphs(&fixture_font(), 0),
            "OpenSans is monochrome and must not report colour glyphs"
        );
    }

    #[test]
    fn color_glyph_detection_rejects_unparseable_data() {
        assert!(
            !font_has_color_glyphs(b"not a font at all", 0),
            "garbage input must report no colour glyphs rather than panic"
        );
    }

    #[test]
    fn test_empty_text() {
        let request = ShapeRequest {
            text: String::new(),
            font_data: fixture_font(),
            face_index: 0,
            font_size: 16.0,
            language: None,
            script: None,
            direction: None,
            features: vec![],
            disable_features: vec![],
            variation_axes: std::collections::HashMap::new(),
        };

        let result = shape_text(&request).expect("Empty text should not error");
        assert!(
            result.glyphs.is_empty(),
            "Empty text should produce no glyphs"
        );
    }

    #[test]
    fn test_feature_tag_parsing() {
        let feature = parse_feature_tag("liga", true).expect("liga should parse");
        assert_eq!(feature.value, 1, "Enabled feature should have value 1");

        let disabled = parse_feature_tag("kern=0", true).expect("kern=0 should parse");
        assert_eq!(disabled.value, 0, "Disabled feature should have value 0");
    }

    #[test]
    fn test_invalid_font_data() {
        let request = ShapeRequest {
            text: "Hello".into(),
            font_data: vec![0, 1, 2, 3], // Invalid font data
            face_index: 0,
            font_size: 16.0,
            language: None,
            script: None,
            direction: None,
            features: vec![],
            disable_features: vec![],
            variation_axes: std::collections::HashMap::new(),
        };

        let result = shape_text(&request);
        assert!(result.is_err(), "Invalid font data should error");
    }
}
