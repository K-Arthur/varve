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
    /// Structured feature values and source ranges. The string lists above
    /// remain wire-compatible for older callers; this field carries indexed
    /// values and UTF-16 range overrides without flattening them to booleans.
    #[serde(default)]
    pub feature_settings: Vec<FeatureSetting>,
    /// Variable font axis settings (tag -> value).
    #[serde(default)]
    pub variation_axes: std::collections::HashMap<String, f32>,
}

/// A source-local OpenType feature request. `end` is exclusive and all
/// offsets are UTF-16 units, matching DOM selections and the shared scene
/// contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureSetting {
    pub tag: String,
    pub value: u32,
    #[serde(default)]
    pub start: Option<u32>,
    #[serde(default)]
    pub end: Option<u32>,
}

/// Shape a run of text using rustybuzz.
/// Returns the shaped glyphs with real glyph IDs, clusters, and positioning.
pub fn shape_text(request: &ShapeRequest) -> Result<ShapedRun, String> {
    let font_data = &request.font_data;

    const MAX_FONT_BYTES: usize = 128 * 1024 * 1024;
    const MAX_TEXT_UTF16: usize = 1_000_000;
    if font_data.len() > MAX_FONT_BYTES {
        return Err(format!(
            "Font data exceeds the {} MiB shaping limit",
            MAX_FONT_BYTES / (1024 * 1024)
        ));
    }
    if request.text.encode_utf16().count() > MAX_TEXT_UTF16 {
        return Err("Text exceeds the shaping work limit".to_string());
    }

    // Create the HarfBuzz face
    let mut hb_face = rustybuzz::Face::from_slice(font_data, request.face_index)
        .ok_or_else(|| "Failed to create HarfBuzz face".to_string())?;

    let _units_per_em = hb_face.units_per_em();

    // Resolve an explicit script, leaving it unset when the caller asks the
    // shaper to infer it. A DFLT script is not equivalent to “unknown”: it
    // skips Arabic/Indic shaping lookups in fonts that provide them.
    let explicit_script = request.script.as_deref().and_then(|s| {
        let bytes = s.as_bytes();
        if bytes.len() != 4 {
            return None;
        }
        let tag = ttf_parser::Tag::from_bytes(&[bytes[0], bytes[1], bytes[2], bytes[3]]);
        rustybuzz::Script::from_iso15924_tag(tag)
    });

    // Resolve language
    let language: Option<rustybuzz::Language> = request
        .language
        .as_deref()
        .and_then(|value| value.parse().ok());

    // Build rustybuzz buffer
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    // rustybuzz's convenience `push_str` uses UTF-8 byte offsets. Varve's
    // source contract is UTF-16, so add code points ourselves and advance by
    // each scalar's UTF-16 width (important for emoji and astral scripts).
    let mut cluster_utf16 = 0u32;
    for character in request.text.chars() {
        buffer.add(character, cluster_utf16);
        cluster_utf16 += character.len_utf16() as u32;
    }
    buffer.guess_segment_properties();
    if let Some(direction) = request.direction.as_deref().and_then(parse_direction) {
        buffer.set_direction(direction);
    }
    if let Some(script) = explicit_script {
        buffer.set_script(script);
    }
    if let Some(lang) = language {
        buffer.set_language(lang);
    }

    let resolved_direction = buffer.direction();
    let resolved_script = buffer.script();
    let resolved_language = buffer.language();

    // Build feature list
    let mut features: Vec<rustybuzz::Feature> = Vec::new();
    let mut warnings = Vec::new();
    for tag in &request.features {
        match parse_feature_tag(tag, true) {
            Ok(feature) => features.push(feature),
            Err(warning) => warnings.push(warning),
        }
    }
    for tag in &request.disable_features {
        if is_required_feature_tag(tag) {
            warnings.push(format!(
                "Ignored disabling required shaping feature \"{}\"",
                feature_tag_name(tag)
            ));
            continue;
        }
        match parse_feature_tag(tag, false) {
            Ok(feature) => features.push(feature),
            Err(warning) => warnings.push(warning),
        }
    }
    for setting in &request.feature_settings {
        match parse_structured_feature(setting, cluster_utf16 as usize) {
            Ok(feature) => features.push(feature),
            Err(warning) => warnings.push(warning),
        }
    }

    // Apply variation axes
    // rustybuzz 0.18 uses Face::set_variations
    let coords: Vec<rustybuzz::Variation> = request
        .variation_axes
        .iter()
        .filter_map(|(tag, val)| {
            let tag_bytes = tag.as_bytes();
            if tag_bytes.len() != 4 || !tag_bytes.iter().all(|byte| byte.is_ascii_graphic()) {
                return None;
            }
            let mut t = [0u8; 4];
            for (i, &b) in tag_bytes.iter().enumerate().take(4) {
                t[i] = b;
            }
            let tag_u32 = u32::from_be_bytes(t);
            Some(rustybuzz::Variation {
                tag: ttf_parser::Tag(tag_u32),
                value: *val,
            })
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
        direction: match resolved_direction {
            rustybuzz::Direction::LeftToRight => "ltr".into(),
            rustybuzz::Direction::RightToLeft => "rtl".into(),
            rustybuzz::Direction::TopToBottom => "ttb".into(),
            rustybuzz::Direction::BottomToTop => "btt".into(),
            rustybuzz::Direction::Invalid => "ltr".into(),
        },
        script: String::from_utf8_lossy(&resolved_script.tag().to_bytes()).into_owned(),
        language: resolved_language.map(|lang| lang.as_str().to_string()),
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
            let offsets_end = match 12usize.checked_add(num_fonts.saturating_mul(4)) {
                Some(end) => end,
                None => return false,
            };
            if data.len() < offsets_end || face_index as usize >= num_fonts {
                return false;
            }
            let offset_start = 12 + face_index as usize * 4;
            let font_offset_bytes = &data[offset_start..offset_start + 4];
            offset = u32::from_be_bytes([
                font_offset_bytes[0],
                font_offset_bytes[1],
                font_offset_bytes[2],
                font_offset_bytes[3],
            ]) as usize;
        }
    }

    let header_end = match offset.checked_add(12) {
        Some(end) => end,
        None => return false,
    };
    if header_end > data.len() {
        return false;
    }

    let num_tables = u16::from_be_bytes([data[offset + 4], data[offset + 5]]) as usize;
    let records_start = header_end;

    let records_end = match records_start.checked_add(num_tables.saturating_mul(16)) {
        Some(end) => end,
        None => return false,
    };
    if records_end > data.len() {
        return false;
    }

    for i in 0..num_tables {
        let Some(rec_start) = records_start.checked_add(i.saturating_mul(16)) else {
            return false;
        };
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
    let (tag_str, value_str) = match tag.split_once('=') {
        Some((tag_str, value)) => (tag_str, Some(value)),
        None => (tag, None),
    };
    if !valid_tag(tag_str) {
        return Err(format!("Invalid feature tag: {tag}"));
    }
    let tag_bytes = tag_str.as_bytes();
    let tag_u32 = u32::from_be_bytes([tag_bytes[0], tag_bytes[1], tag_bytes[2], tag_bytes[3]]);
    let value = if let Some(value) = value_str {
        value
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

fn parse_structured_feature(
    setting: &FeatureSetting,
    text_length: usize,
) -> Result<rustybuzz::Feature, String> {
    if !valid_tag(&setting.tag) {
        return Err(format!("Invalid feature tag: {}", setting.tag));
    }
    let tag_bytes = setting.tag.as_bytes();
    let tag =
        ttf_parser::Tag::from_bytes(&[tag_bytes[0], tag_bytes[1], tag_bytes[2], tag_bytes[3]]);
    let start = setting.start.map(|value| value as usize).unwrap_or(0);
    let end = setting
        .end
        .map(|value| value as usize)
        .unwrap_or(text_length);
    if end <= start {
        return Err(format!(
            "Invalid range for feature {}: {}..{}",
            setting.tag, start, end
        ));
    }
    Ok(rustybuzz::Feature::new(tag, setting.value, start..end))
}

fn valid_tag(tag: &str) -> bool {
    tag.len() == 4
        && tag
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii() && !byte.is_ascii_control())
}

fn parse_direction(direction: &str) -> Option<rustybuzz::Direction> {
    match direction {
        "ltr" => Some(rustybuzz::Direction::LeftToRight),
        "rtl" => Some(rustybuzz::Direction::RightToLeft),
        "ttb" => Some(rustybuzz::Direction::TopToBottom),
        "btt" => Some(rustybuzz::Direction::BottomToTop),
        _ => None,
    }
}

fn feature_tag_name(tag: &str) -> &str {
    tag.split_once('=').map_or(tag, |(name, _)| name)
}

fn is_required_feature_tag(tag: &str) -> bool {
    matches!(
        feature_tag_name(tag),
        "rlig"
            | "ccmp"
            | "locl"
            | "mark"
            | "mkmk"
            | "curs"
            | "init"
            | "medi"
            | "fina"
            | "isol"
            | "abvm"
            | "blwm"
            | "rvrn"
    )
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
            feature_settings: vec![],
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
    fn absent_script_and_direction_are_inferred_from_unicode() {
        let mut request = latin_request("مرحبا");
        request.language = None;
        request.script = None;
        request.direction = None;

        let result = shape_text(&request).expect("Arabic should shape with inferred properties");

        assert_eq!(result.direction, "rtl");
        assert_eq!(result.script, "Arab");
    }

    #[test]
    fn clusters_use_utf16_offsets_for_astral_code_points() {
        let request = latin_request("A😀B");
        let result = shape_text(&request).expect("astral input should shape");

        let clusters: Vec<u32> = result.glyphs.iter().map(|glyph| glyph.cluster).collect();
        assert_eq!(clusters, vec![0, 1, 3]);
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
    fn disabling_required_shaping_features_is_ignored_with_a_warning() {
        let mut request = latin_request("fi");
        request.disable_features = vec!["rlig".into()];

        let result = shape_text(&request).expect("required feature request should shape");

        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("required shaping feature")));
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
    fn color_glyph_detection_rejects_an_out_of_range_collection_face() {
        let mut ttc = vec![0u8; 16];
        ttc[0..4].copy_from_slice(b"ttcf");
        ttc[8..12].copy_from_slice(&1u32.to_be_bytes());
        assert!(!font_has_color_glyphs(&ttc, 1));
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
            feature_settings: vec![],
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

        let indexed = parse_structured_feature(
            &FeatureSetting {
                tag: "ss01".into(),
                value: 2,
                start: Some(1),
                end: Some(3),
            },
            8,
        )
        .expect("indexed range should parse");
        assert_eq!(indexed.value, 2);
        assert_eq!(indexed.start, 1);
        assert_eq!(indexed.end, 2);
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
            feature_settings: vec![],
            variation_axes: std::collections::HashMap::new(),
        };

        let result = shape_text(&request);
        assert!(result.is_err(), "Invalid font data should error");
    }
}
