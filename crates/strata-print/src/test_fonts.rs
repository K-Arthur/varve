//! Cross-platform test font resolver for strata-print tests.
//!
//! CI matrices run Ubuntu, macOS, and Windows runners. A test that only knows
//! `/usr/share/fonts` dies on the other two (this caused repeated macOS CI
//! failures), and macOS system fonts (e.g. Arial) can be rejected by
//! `ttf-parser`'s strict head/OS-2 table validation. For determinism every
//! test uses the bundled OpenSans-Regular fixture; system-font paths are only
//! a fallback for developers without the fixture checked out.
#![cfg(test)]

use std::path::Path;

/// Path to the bundled OpenSans test fixture (committed to the crate).
pub fn bundled_font_path() -> &'static str {
    concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/OpenSans-Regular.ttf")
}

/// Candidate system font paths as a fallback when the fixture is missing.
const SYSTEM_FONT_CANDIDATES: &[&str] = &[
    // Linux (Ubuntu runner)
    "/usr/share/fonts/TTF/OpenSans-Regular.ttf",
    "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
    "/usr/share/fonts/TTF/Vera.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/Inter-Regular.ttf",
    // macOS
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    // Windows
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\calibri.ttf",
];

/// Read the bundled fixture, or the first available system font, or panic
/// listing every path tried.
pub fn test_font_bytes() -> &'static [u8] {
    let bundled = Path::new(bundled_font_path());
    if let Ok(data) = std::fs::read(bundled) {
        return Box::leak(data.into_boxed_slice());
    }
    for p in SYSTEM_FONT_CANDIDATES {
        if let Ok(data) = std::fs::read(p) {
            return Box::leak(data.into_boxed_slice());
        }
    }
    panic!(
        "no test font found — tried bundled {:?} then system candidates {SYSTEM_FONT_CANDIDATES:?}",
        bundled
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_fixture_present_and_parseable() {
        let bytes = test_font_bytes();
        assert!(!bytes.is_empty(), "bundled font fixture must not be empty");
        assert_eq!(
            &bytes[0..4],
            &[0x00, 0x01, 0x00, 0x00],
            "fixture must be a TrueType (0x00010000) font",
        );
        assert!(
            ab_glyph::FontRef::try_from_slice(bytes).is_ok(),
            "fixture must parse with ab_glyph",
        );
    }
}
