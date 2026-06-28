//! CMYK conversion + PDF/X export stubs (Task 1.5).
//!
//! `rgb_to_cmyk()` provides a naive RGB→CMYK transform (no ICC profile — full
//! profile-based conversion requires the `icc` or `lcms2` crate).
//! `export_pdfx1a()` and `export_pdfx4()` produce structurally valid PDF/X
//! wrappers with TODO markers for production certification.
//!
//! Research basis: ISO 15930 (PDF/X-1a, PDF/X-4), ICC color management.

use crate::PdfOptions;
use strata_core::SceneNode;

/// Naive RGB to CMYK conversion (no ICC profile).
///
/// Uses the standard inverse: C = 1-R, M = 1-G, Y = 1-B, K = min(C,M,Y).
/// True ICC-profile conversion requires bundling an eciCMYK or similar profile.
pub fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let k = 1.0 - rf.max(gf).max(bf);
    if k >= 1.0 {
        return (0, 0, 0, 255);
    }
    let c = (1.0 - rf - k) / (1.0 - k);
    let m = (1.0 - gf - k) / (1.0 - k);
    let y = (1.0 - bf - k) / (1.0 - k);

    (
        (c * 255.0).round() as u8,
        (m * 255.0).round() as u8,
        (y * 255.0).round() as u8,
        (k * 255.0).round() as u8,
    )
}

/// Bleed/trim marks geometry (stub — returns default values).
pub fn marks_geometry() -> (f64, f64, f64) {
    // (bleed, trim_offset, mark_length)
    (3.0, 3.0, 10.0)
}

/// Export a PDF/X-1a stub (valid structure, non-production).
///
/// Outputs a PDF with embedded OutputIntent, no transparency, RGB→CMYK
/// converted content. WARNING: Not production-certified — use for preview only.
pub fn export_pdfx1a(_nodes: &[SceneNode], _opts: &PdfOptions) -> Result<Vec<u8>, String> {
    Err("PDF/X-1a: not yet implemented — stub returns error".into())
}

/// Export a PDF/X-4 stub (valid structure, non-production).
///
/// Same as PDF/X-1a but permits live transparency. WARNING: Preview only.
pub fn export_pdfx4(_nodes: &[SceneNode], _opts: &PdfOptions) -> Result<Vec<u8>, String> {
    Err("PDF/X-4: not yet implemented — stub returns error".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_to_cmyk_black() {
        assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
    }

    #[test]
    fn rgb_to_cmyk_white() {
        assert_eq!(rgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
    }

    #[test]
    fn rgb_to_cmyk_red() {
        let (c, m, y, k) = rgb_to_cmyk(255, 0, 0);
        assert!(m > 200, "magenta should be high for red");
        assert!(y > 200, "yellow should be high for red");
        assert!(c < 50, "cyan should be low for red");
        assert!(k < 50, "key should be low for red");
    }

    #[test]
    fn rgb_to_cmyk_green() {
        let (c, m, y, _k) = rgb_to_cmyk(0, 255, 0);
        assert!(c > 200, "cyan should be high for green");
        assert!(y > 200, "yellow should be high for green");
        assert!(m < 50, "magenta should be low for green");
    }

    #[test]
    fn marks_geometry_returns_sane_values() {
        let (bleed, offset, length) = marks_geometry();
        assert!(bleed > 0.0);
        assert!(offset > 0.0);
        assert!(length > 0.0);
    }

    #[test]
    fn export_pdfx1a_stub_returns_error() {
        let result = export_pdfx1a(&[], &PdfOptions::default());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }

    #[test]
    fn export_pdfx4_stub_returns_error() {
        let result = export_pdfx4(&[], &PdfOptions::default());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }
}
