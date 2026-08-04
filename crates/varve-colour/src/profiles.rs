//! Print profile types, ICC header validation, and bundled profile data.
//!
//! Provides `PrintProfile` and `RenderingIntent` enums (ISO 12647 printing
//! conditions), tetrahedral interpolation for 3D CLUT tables, ICC header
//! validation, and bundled sRGB/CMYK profile data embedded via `include_bytes!`.
//!
//! Research basis: ICC.1:2010 (Profile Version 4.3), ISO 12647, tetrahedral
//! interpolation from Adobe DNG SDK. Cross-target: the same profile bytes are
//! bundled in native (tintbox) and WASM (`varve-colour`) builds.

/// Supported ICC print profiles (ISO 12647 printing conditions).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PrintProfile {
    /// Fogra39 (ISO Coated v2, 300% TAC, Fogra39L)
    Fogra39,
    /// GRACoL2006 (US Web Coated SWOP v2)
    Gracol2006,
    /// SWOP Coated (US Web Coated SWOP v3)
    SwopCoated,
}

impl PrintProfile {
    /// Return the standard name for this profile.
    pub fn name(&self) -> &'static str {
        match self {
            PrintProfile::Fogra39 => "Fogra39",
            PrintProfile::Gracol2006 => "GRACoL2006",
            PrintProfile::SwopCoated => "SWOP Coated",
        }
    }

    /// Parse a profile name (case-insensitive, tolerant of common spellings).
    /// Unknown names return `None` so callers can warn rather than guess.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "fogra39" | "fogra" | "iso_coated_v2" | "iso coated v2" | "fogra39l" => {
                Some(Self::Fogra39)
            }
            "gracol2006" | "gracol" | "gracol_2006" => Some(Self::Gracol2006),
            "swop" | "swopcoated" | "swop_coated" | "swop v3" => Some(Self::SwopCoated),
            _ => None,
        }
    }

    /// PDF/X OutputConditionIdentifier for this profile.
    pub fn output_condition_identifier(&self) -> &'static str {
        match self {
            PrintProfile::Fogra39 => "Fogra39",
            PrintProfile::Gracol2006 => "GRACoL2006",
            PrintProfile::SwopCoated => "SWOP Coated",
        }
    }

    /// Bundled ICC profile bytes for this printing condition.
    pub fn icc_bytes(&self) -> &'static [u8] {
        bundled_cmyk()
    }
}

/// Rendering intent for colour conversion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RenderingIntent {
    /// Perceptual: preserve overall colour relationship (photos).
    Perceptual,
    /// Relative Colorimetric: map white point, clip out-of-gamut.
    Relative,
    /// Absolute Colorimetric: exact colour match.
    Absolute,
    /// Saturation: preserve saturation (charts, business graphics).
    Saturation,
}

impl RenderingIntent {
    pub fn parse_intent(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "perceptual" => Some(Self::Perceptual),
            "relative" | "relative_colorimetric" | "relativecolorimetric" => Some(Self::Relative),
            "absolute" | "absolute_colorimetric" | "absolutecolorimetric" => Some(Self::Absolute),
            "saturation" => Some(Self::Saturation),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Perceptual => "perceptual",
            Self::Relative => "relative",
            Self::Absolute => "absolute",
            Self::Saturation => "saturation",
        }
    }
}

/// ICC profile class (device type).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProfileClass {
    Input,
    Display,
    Output,
    ColorSpace,
    Abstract,
    Link,
    NamedColor,
    Other([u8; 4]),
}

impl ProfileClass {
    fn from_bytes(sig: &[u8]) -> Self {
        if sig == b"scnr" {
            Self::Input
        } else if sig == b"mntr" {
            Self::Display
        } else if sig == b"prtr" {
            Self::Output
        } else if sig == b"spac" {
            Self::ColorSpace
        } else if sig == b"abst" {
            Self::Abstract
        } else if sig == b"link" {
            Self::Link
        } else if sig == b"nmcl" {
            Self::NamedColor
        } else {
            let mut arr = [0u8; 4];
            arr.copy_from_slice(&sig[..4.min(sig.len())]);
            Self::Other(arr)
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Input => "scnr",
            Self::Display => "mntr",
            Self::Output => "prtr",
            Self::ColorSpace => "spac",
            Self::Abstract => "abst",
            Self::Link => "link",
            Self::NamedColor => "nmcl",
            Self::Other(_) => "other",
        }
    }
}

/// Parsed ICC profile header metadata (128-byte header).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProfileInfo {
    pub size: u32,
    pub version: String,
    pub device_class: String,
    pub color_space: String,
    pub pcs: String,
    pub rendering_intent: String,
    pub manufacturer: String,
    pub model: u32,
    pub flags: u32,
    pub creator: String,
}

/// Tetrahedral interpolation for 3D lookup tables.
///
/// `input` is RGB (0.0–1.0), `grid_size` is the number of divisions per axis,
/// and `table` contains `grid_size³ × 4` float values (CMYK).
pub fn tetrahedral_interpolate(input: [f32; 3], grid_size: usize, table: &[f32]) -> [f32; 4] {
    let expected_len = grid_size * grid_size * grid_size * 4;
    if table.len() < expected_len || grid_size < 2 {
        return [0.0; 4];
    }

    let r = input[0].clamp(0.0, 1.0);
    let g = input[1].clamp(0.0, 1.0);
    let b = input[2].clamp(0.0, 1.0);

    let grid_f = (grid_size - 1) as f32;
    let ri = r * grid_f;
    let gi = g * grid_f;
    let bi = b * grid_f;

    let r0 = (ri as usize).min(grid_size - 2);
    let g0 = (gi as usize).min(grid_size - 2);
    let b0 = (bi as usize).min(grid_size - 2);

    let rf = ri - r0 as f32;
    let gf = gi - g0 as f32;
    let bf = bi - b0 as f32;

    let idx = |ri: usize, gi: usize, bi: usize| -> usize {
        (ri * grid_size * grid_size + gi * grid_size + bi) * 4
    };

    let v = |ri: usize, gi: usize, bi: usize, c: usize| -> f32 {
        let i = idx(ri, gi, bi) + c;
        if i < table.len() {
            table[i]
        } else {
            0.0
        }
    };

    let mut result = [0.0f32; 4];

    if rf >= gf && gf >= bf {
        let w0 = 1.0 - rf;
        let w1 = rf - gf;
        let w2 = gf - bf;
        let w3 = bf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0 + 1, g0, b0, c)
                + w2 * v(r0 + 1, g0 + 1, b0, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if rf >= bf && bf >= gf {
        let w0 = 1.0 - rf;
        let w1 = rf - bf;
        let w2 = bf - gf;
        let w3 = gf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0 + 1, g0, b0, c)
                + w2 * v(r0 + 1, g0, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if gf >= rf && rf >= bf {
        let w0 = 1.0 - gf;
        let w1 = gf - rf;
        let w2 = rf - bf;
        let w3 = bf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0 + 1, b0, c)
                + w2 * v(r0 + 1, g0 + 1, b0, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if gf >= bf && bf >= rf {
        let w0 = 1.0 - gf;
        let w1 = gf - bf;
        let w2 = bf - rf;
        let w3 = rf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0 + 1, b0, c)
                + w2 * v(r0, g0 + 1, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if bf >= rf && rf >= gf {
        let w0 = 1.0 - bf;
        let w1 = bf - rf;
        let w2 = rf - gf;
        let w3 = gf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0, b0 + 1, c)
                + w2 * v(r0 + 1, g0, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else {
        let w0 = 1.0 - bf;
        let w1 = bf - gf;
        let w2 = gf - rf;
        let w3 = rf;
        for (c, rc) in result.iter_mut().enumerate() {
            *rc = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0, b0 + 1, c)
                + w2 * v(r0, g0 + 1, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    }

    result
}

/// Validate an ICC profile by checking its 128-byte header.
///
/// Per ICC.1:2010 §7.2 (Profile header), the 128-byte header must contain:
/// - A valid profile class signature at bytes 12-15.
/// - A recognised colour space at bytes 16-19.
/// - A recognised PCS at bytes 20-23.
/// - The 'acsp' magic signature at bytes 36-39.
///
/// This is a structural check, not a full compliance audit.
pub fn validate_icc_profile(data: &[u8]) -> Result<(), String> {
    if data.len() < 128 {
        return Err(format!(
            "ICC profile too short: {} bytes, minimum 128",
            data.len()
        ));
    }

    // Bytes 36-39 must be 'acsp' magic signature.
    if &data[36..40] != b"acsp" {
        let sig = String::from_utf8_lossy(&data[36..40]);
        return Err(format!("Missing ICC magic 'acsp', got '{sig}'"));
    }

    // Bytes 12-15: profile class.
    let class_sig = &data[12..16];
    let valid_classes = [
        b"scnr", b"mntr", b"prtr", b"spac", b"abst", b"link", b"nmcl",
    ];
    let valid = valid_classes.iter().any(|c| class_sig == *c);
    if !valid {
        let sig_str = String::from_utf8_lossy(class_sig);
        return Err(format!("Invalid ICC profile class signature: '{sig_str}'"));
    }

    // Bytes 16-19: data colour space.
    let color_space = &data[16..20];
    if color_space != b"RGB "
        && color_space != b"CMYK"
        && color_space != b"GRAY"
        && color_space != b"Lab "
    {
        let cs_str = String::from_utf8_lossy(color_space);
        return Err(format!(
            "Unsupported ICC colour space: '{cs_str}', expected 'RGB ', 'CMYK', 'GRAY', or 'Lab '"
        ));
    }

    // Bytes 20-23: profile connection space.
    let pcs = &data[20..24];
    if pcs != b"Lab " && pcs != b"XYZ " {
        let pcs_str = String::from_utf8_lossy(pcs);
        return Err(format!(
            "Unsupported ICC PCS: '{pcs_str}', expected 'Lab ' or 'XYZ '"
        ));
    }

    Ok(())
}

/// Parse ICC profile header metadata from raw bytes.
///
/// Per ICC.1:2010 §7.2 (Profile header), the 128-byte header contains
/// all metadata fields. Returns a `ProfileInfo` struct, or an error
/// if the data is too short or doesn't have the 'acsp' magic.
pub fn parse_icc_profile_info(data: &[u8]) -> Result<ProfileInfo, String> {
    if data.len() < 128 {
        return Err(format!(
            "ICC profile too short: {} bytes, minimum 128",
            data.len()
        ));
    }

    if &data[36..40] != b"acsp" {
        let sig = String::from_utf8_lossy(&data[36..40]);
        return Err(format!("Missing ICC magic 'acsp', got '{sig}'"));
    }

    let size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    let version_major = data[8] as u32;
    let version_minor = data[9] as u32;
    let version = format!("{}.{}", version_major, version_minor);

    // Per ICC.1:2010 header layout:
    let device_class = ProfileClass::from_bytes(&data[12..16]);
    let color_space = String::from_utf8_lossy(&data[16..20]).trim().to_string();
    let pcs = String::from_utf8_lossy(&data[20..24]).trim().to_string();

    let intent_val = u32::from_be_bytes([data[64], data[65], data[66], data[67]]);
    let rendering_intent = match intent_val {
        0 => "Perceptual",
        1 => "Relative Colorimetric",
        2 => "Saturation",
        3 => "Absolute Colorimetric",
        _ => "Unknown",
    }
    .to_string();

    // Flags at bytes 44-47
    let flags = u32::from_be_bytes([data[44], data[45], data[46], data[47]]);
    // Device manufacturer at bytes 48-51
    let manufacturer = String::from_utf8_lossy(&data[48..52]).trim().to_string();
    // Device model at bytes 52-55
    let model = u32::from_be_bytes([data[52], data[53], data[54], data[55]]);
    // Profile creator at bytes 80-83
    let creator = String::from_utf8_lossy(&data[80..84]).trim().to_string();

    Ok(ProfileInfo {
        size,
        version,
        device_class: device_class.as_str().to_string(),
        color_space,
        pcs,
        rendering_intent,
        manufacturer,
        model,
        flags,
        creator,
    })
}

// ── Bundled ICC profile data ────────────────────────────────────────────

/// Return bundled sRGB ICC profile bytes.
///
/// Cross-target: same data embedded in native and WASM builds.
pub fn bundled_srgb() -> &'static [u8] {
    let arr = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/profiles/sRGB.icc"));
    arr.as_ref()
}

/// Return bundled default CMYK ICC profile bytes.
///
/// Cross-target: same data embedded in native and WASM builds.
pub fn bundled_cmyk() -> &'static [u8] {
    let arr = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/profiles/default_cmyk.icc"
    ));
    arr.as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Profile parsing ─────────────────────────────────────────────

    #[test]
    fn print_profile_parse_is_case_insensitive() {
        assert_eq!(PrintProfile::parse("Fogra39"), Some(PrintProfile::Fogra39));
        assert_eq!(PrintProfile::parse("fogra39"), Some(PrintProfile::Fogra39));
        assert_eq!(
            PrintProfile::parse("ISO Coated v2"),
            Some(PrintProfile::Fogra39)
        );
        assert_eq!(
            PrintProfile::parse("GRACoL2006"),
            Some(PrintProfile::Gracol2006)
        );
        assert_eq!(
            PrintProfile::parse("swop_coated"),
            Some(PrintProfile::SwopCoated)
        );
        assert_eq!(PrintProfile::parse("NoSuchProfile"), None);
        assert_eq!(PrintProfile::parse(""), None);
    }

    #[test]
    fn print_profile_icc_bytes_are_valid_profiles() {
        for profile in [
            PrintProfile::Fogra39,
            PrintProfile::Gracol2006,
            PrintProfile::SwopCoated,
        ] {
            assert!(
                validate_icc_profile(profile.icc_bytes()).is_ok(),
                "{} bundled profile must validate",
                profile.name()
            );
        }
    }

    // ── Profile data ────────────────────────────────────────────────

    #[test]
    fn bundled_profiles_load() {
        assert!(bundled_srgb().len() >= 128, "sRGB profile too short");
        assert!(bundled_cmyk().len() >= 128, "CMYK profile too short");
    }

    #[test]
    fn bundled_profiles_validate() {
        assert!(
            validate_icc_profile(bundled_srgb()).is_ok(),
            "sRGB should validate"
        );
        assert!(
            validate_icc_profile(bundled_cmyk()).is_ok(),
            "CMYK should validate"
        );
    }

    // ── validate_icc_profile ────────────────────────────────────────

    #[test]
    fn validate_icc_valid() {
        let mut header = vec![0u8; 128];
        header[12..16].copy_from_slice(b"mntr"); // class
        header[16..20].copy_from_slice(b"RGB "); // colour space
        header[20..24].copy_from_slice(b"Lab "); // PCS
        header[36..40].copy_from_slice(b"acsp"); // magic
        assert!(validate_icc_profile(&header).is_ok());
    }

    #[test]
    fn validate_icc_invalid_magic() {
        let mut header = vec![0u8; 128];
        header[12..16].copy_from_slice(b"mntr");
        header[16..20].copy_from_slice(b"RGB ");
        header[20..24].copy_from_slice(b"Lab ");
        header[36..40].copy_from_slice(b"xxxx"); // bad magic
        assert!(validate_icc_profile(&header).is_err());
    }

    #[test]
    fn validate_icc_invalid_class() {
        let mut header = vec![0u8; 128];
        header[12..16].copy_from_slice(b"xxxx"); // bad class
        header[16..20].copy_from_slice(b"RGB ");
        header[20..24].copy_from_slice(b"Lab ");
        header[36..40].copy_from_slice(b"acsp");
        assert!(validate_icc_profile(&header).is_err());
    }

    #[test]
    fn validate_icc_too_short() {
        assert!(validate_icc_profile(&[0u8; 50]).is_err());
    }

    #[test]
    fn validate_icc_invalid_pcs() {
        let mut header = vec![0u8; 128];
        header[12..16].copy_from_slice(b"mntr");
        header[16..20].copy_from_slice(b"CMYK");
        header[20..24].copy_from_slice(b"GRAY"); // invalid PCS
        header[36..40].copy_from_slice(b"acsp");
        assert!(validate_icc_profile(&header).is_err());
    }

    // ── parse_icc_profile_info ──────────────────────────────────────

    #[test]
    fn parse_profile_info_real_srgb() {
        let info = parse_icc_profile_info(bundled_srgb()).unwrap();
        assert_eq!(info.color_space, "RGB");
        assert!(info.size > 0);
    }

    #[test]
    fn parse_profile_info_real_cmyk() {
        let info = parse_icc_profile_info(bundled_cmyk()).unwrap();
        assert_eq!(info.color_space, "CMYK");
        assert!(info.size > 0);
    }

    #[test]
    fn parse_profile_info_too_short() {
        assert!(parse_icc_profile_info(&[0u8; 50]).is_err());
    }

    // ── tetrahedral_interpolate ─────────────────────────────────────

    #[test]
    fn tetrahedral_interpolate_basic() {
        let mut table = vec![0.0f32; 2 * 2 * 2 * 4];
        let idx = |r: usize, g: usize, b: usize| (r * 4 + g * 2 + b) * 4;
        table[idx(0, 0, 0) + 3] = 100.0;
        table[idx(1, 1, 1) + 3] = 0.0;
        let result = tetrahedral_interpolate([0.5, 0.5, 0.5], 2, &table);
        assert!(
            (result[3] - 50.0).abs() < 15.0,
            "K should be near 50, got {}",
            result[3]
        );
    }

    #[test]
    fn tetrahedral_interpolate_black() {
        let mut table = vec![0.0f32; 2 * 2 * 2 * 4];
        let idx = |r: usize, g: usize, b: usize| (r * 4 + g * 2 + b) * 4;
        table[idx(0, 0, 0) + 3] = 255.0;
        let result = tetrahedral_interpolate([0.0, 0.0, 0.0], 2, &table);
        assert!((result[3] - 255.0).abs() < 1.0, "K should be 255");
    }

    #[test]
    fn tetrahedral_interpolate_small_grid() {
        let table = vec![0.0; 4];
        let result = tetrahedral_interpolate([0.5, 0.5, 0.5], 1, &table);
        assert_eq!(result, [0.0; 4], "grid < 2 should return zero");
    }

    // ── Enums ────────────────────────────────────────────────────────

    #[test]
    fn print_profile_name() {
        assert_eq!(PrintProfile::Fogra39.name(), "Fogra39");
        assert_eq!(PrintProfile::Gracol2006.name(), "GRACoL2006");
        assert_eq!(PrintProfile::SwopCoated.name(), "SWOP Coated");
    }

    #[test]
    fn rendering_intent_from_str() {
        assert_eq!(
            RenderingIntent::parse_intent("perceptual"),
            Some(RenderingIntent::Perceptual)
        );
        assert_eq!(
            RenderingIntent::parse_intent("relative_colorimetric"),
            Some(RenderingIntent::Relative)
        );
        assert_eq!(RenderingIntent::parse_intent("unknown"), None);
    }

    #[test]
    fn rendering_intent_as_str() {
        assert_eq!(RenderingIntent::Perceptual.as_str(), "perceptual");
        assert_eq!(RenderingIntent::Saturation.as_str(), "saturation");
    }
}
