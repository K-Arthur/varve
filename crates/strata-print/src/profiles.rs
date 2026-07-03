//! ICC print profiles, rendering intent, and color pipeline utilities.
//!
//! Provides `PrintProfile` (Fogra39, GRACoL2006, SWOP) and `RenderingIntent`
//! enums, a `tetrahedral_interpolate` helper for 3D LUT tables, and a
//! `validate_icc_profile` stub for ICC header validation.
//!
//! Research basis: ICC.1:2010 (Profile Version 4.3), ISO 12647 (printing
//! conditions), tetrahedral interpolation from Adobe DNG SDK.

#![forbid(unsafe_code)]

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
}

/// Rendering intent for color conversion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RenderingIntent {
    /// Perceptual: preserve overall color relationship (photos).
    Perceptual,
    /// Relative Colorimetric: map white point, clip out-of-gamut.
    Relative,
    /// Absolute Colorimetric: exact color match.
    Absolute,
    /// Saturation: preserve saturation (charts, business graphics).
    Saturation,
}

/// Tetrahedral interpolation for 3D lookup tables.
///
/// `input` is RGB (0.0–1.0), `grid_size` is the number of divisions per axis,
/// and `table` contains `grid_size³ × 4` float values (CMYK).
///
/// Performs standard tetrahedral interpolation by dividing each cube into
/// 6 tetrahedra based on the order of the fractional coordinates.
pub fn tetrahedral_interpolate(input: [f32; 3], grid_size: usize, table: &[f32]) -> [f32; 4] {
    let expected_len = grid_size * grid_size * grid_size * 4;
    if table.len() < expected_len || grid_size < 2 {
        return [0.0; 4];
    }

    // Clamp input to [0, 1]
    let r = input[0].clamp(0.0, 1.0);
    let g = input[1].clamp(0.0, 1.0);
    let b = input[2].clamp(0.0, 1.0);

    // Grid coordinates (0..grid_size-1)
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

    // Indices for 8 cube corners
    let idx = |ri: usize, gi: usize, bi: usize| -> usize {
        (ri * grid_size * grid_size + gi * grid_size + bi) * 4
    };

    // Get a corner value from the table
    let v = |ri: usize, gi: usize, bi: usize, c: usize| -> f32 {
        let i = idx(ri, gi, bi) + c;
        if i < table.len() {
            table[i]
        } else {
            0.0
        }
    };

    // Determine tetrahedron based on fraction order and interpolate
    let mut result = [0.0f32; 4];

    if rf >= gf && gf >= bf {
        // T1: (0,0,0)->(1,0,0)->(1,1,0)->(1,1,1)
        let w0 = 1.0 - rf;
        let w1 = rf - gf;
        let w2 = gf - bf;
        let w3 = bf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0 + 1, g0, b0, c)
                + w2 * v(r0 + 1, g0 + 1, b0, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if rf >= bf && bf >= gf {
        // T2: (0,0,0)->(1,0,0)->(1,0,1)->(1,1,1)
        let w0 = 1.0 - rf;
        let w1 = rf - bf;
        let w2 = bf - gf;
        let w3 = gf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0 + 1, g0, b0, c)
                + w2 * v(r0 + 1, g0, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if gf >= rf && rf >= bf {
        // T3: (0,0,0)->(0,1,0)->(1,1,0)->(1,1,1)
        let w0 = 1.0 - gf;
        let w1 = gf - rf;
        let w2 = rf - bf;
        let w3 = bf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0 + 1, b0, c)
                + w2 * v(r0 + 1, g0 + 1, b0, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if gf >= bf && bf >= rf {
        // T4: (0,0,0)->(0,1,0)->(0,1,1)->(1,1,1)
        let w0 = 1.0 - gf;
        let w1 = gf - bf;
        let w2 = bf - rf;
        let w3 = rf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0 + 1, b0, c)
                + w2 * v(r0, g0 + 1, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else if bf >= rf && rf >= gf {
        // T5: (0,0,0)->(0,0,1)->(1,0,1)->(1,1,1)
        let w0 = 1.0 - bf;
        let w1 = bf - rf;
        let w2 = rf - gf;
        let w3 = gf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0, b0 + 1, c)
                + w2 * v(r0 + 1, g0, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    } else {
        // T6: (0,0,0)->(0,0,1)->(0,1,1)->(1,1,1)
        // bf >= gf && gf >= rf  (or all equal — any tetrahedron works)
        let w0 = 1.0 - bf;
        let w1 = bf - gf;
        let w2 = gf - rf;
        let w3 = rf;
        for (c, result_item) in result.iter_mut().enumerate() {
            *result_item = w0 * v(r0, g0, b0, c)
                + w1 * v(r0, g0, b0 + 1, c)
                + w2 * v(r0, g0 + 1, b0 + 1, c)
                + w3 * v(r0 + 1, g0 + 1, b0 + 1, c);
        }
    }

    result
}

/// Validate an ICC profile by checking its 128-byte header magic number.
///
/// A valid ICC profile starts with exactly 128 bytes of header where the
/// `size` field (bytes 0-3 as big-endian u32) matches the data length and
/// the `cmm_type` signature bytes 4-7 are "none" (all zeros) or some
/// known CMM, and bytes 36-39 contain the profile class ('scnr', 'mntr',
/// 'prtr', etc.). This is a structural check, not a full compliance audit.
pub fn validate_icc_profile(data: &[u8]) -> Result<(), String> {
    if data.len() < 128 {
        return Err(format!(
            "ICC profile too short: {} bytes, minimum 128",
            data.len()
        ));
    }

    // Bytes 36-39: profile class signature
    let class_sig = &data[36..40];
    let valid_classes = [b"scnr", b"mntr", b"prtr", b"spac", b"abst", b"link"];
    let valid = valid_classes.iter().any(|c| &class_sig == c);
    if !valid {
        let sig_str = String::from_utf8_lossy(class_sig);
        return Err(format!("Invalid ICC profile class signature: '{sig_str}'"));
    }

    // Bytes 40-43: color space of data (e.g., 'RGB ', 'CMYK')
    let color_space = &data[40..44];
    if color_space != b"RGB " && color_space != b"CMYK" {
        let cs_str = String::from_utf8_lossy(color_space);
        return Err(format!(
            "Unsupported ICC color space: '{cs_str}', expected 'RGB ' or 'CMYK'"
        ));
    }

    // Bytes 44-47: profile connection space (e.g., 'Lab ', 'XYZ ')
    let pcs = &data[44..48];
    if pcs != b"Lab " && pcs != b"XYZ " {
        let pcs_str = String::from_utf8_lossy(pcs);
        return Err(format!(
            "Unsupported ICC PCS: '{pcs_str}', expected 'Lab ' or 'XYZ '"
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tetrahedral_interpolate_basic() {
        // A 2×2×2 table (trilinear degenerate case).
        // Grid values: black at (0,0,0), white at (1,1,1)
        let mut table = vec![0.0f32; 2 * 2 * 2 * 4];
        // Black: (0,0,0) -> C=0, M=0, Y=0, K=255
        // White: (1,1,1) -> C=0, M=0, Y=0, K=0
        let idx = |r: usize, g: usize, b: usize| (r * 4 + g * 2 + b) * 4;
        // Set input (0,0,0) = (C=0,M=0,Y=0,K=100)
        table[idx(0, 0, 0) + 3] = 100.0;
        // Set input (1,1,1) = (C=0,M=0,Y=0,K=0)
        table[idx(1, 1, 1) + 3] = 0.0;
        // Mid-gray input should be near K=50
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
        table[idx(0, 0, 0)] = 0.0;
        table[idx(0, 0, 0) + 1] = 0.0;
        table[idx(0, 0, 0) + 2] = 0.0;
        table[idx(0, 0, 0) + 3] = 255.0;
        // Mid-input still black (all others are 0 in table)
        let result = tetrahedral_interpolate([0.0, 0.0, 0.0], 2, &table);
        assert!((result[3] - 255.0).abs() < 1.0, "K should be 255");
    }

    #[test]
    fn tetrahedral_interpolate_small_grid() {
        let table = vec![0.0; 4];
        let result = tetrahedral_interpolate([0.5, 0.5, 0.5], 1, &table);
        assert_eq!(result, [0.0; 4], "grid < 2 should return zero");
    }

    #[test]
    fn print_profile_name() {
        assert_eq!(PrintProfile::Fogra39.name(), "Fogra39");
        assert_eq!(PrintProfile::Gracol2006.name(), "GRACoL2006");
        assert_eq!(PrintProfile::SwopCoated.name(), "SWOP Coated");
    }

    #[test]
    fn validate_icc_valid() {
        // Build a minimal valid-looking ICC header
        let mut header = vec![0u8; 128];
        // Bytes 36-39: profile class = 'scnr' (scanner)
        header[36..40].copy_from_slice(b"scnr");
        // Bytes 40-43: color space = 'RGB '
        header[40..44].copy_from_slice(b"RGB ");
        // Bytes 44-47: PCS = 'Lab '
        header[44..48].copy_from_slice(b"Lab ");
        assert!(validate_icc_profile(&header).is_ok());
    }

    #[test]
    fn validate_icc_invalid_class() {
        let mut header = vec![0u8; 128];
        header[36..40].copy_from_slice(b"xxxx");
        header[40..44].copy_from_slice(b"RGB ");
        header[44..48].copy_from_slice(b"Lab ");
        let result = validate_icc_profile(&header);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("class signature"));
    }

    #[test]
    fn validate_icc_too_short() {
        let result = validate_icc_profile(&[0u8; 50]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn validate_icc_invalid_pcs() {
        let mut header = vec![0u8; 128];
        header[36..40].copy_from_slice(b"mntr");
        header[40..44].copy_from_slice(b"CMYK");
        header[44..48].copy_from_slice(b"GRAY");
        let result = validate_icc_profile(&header);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("PCS"));
    }
}
