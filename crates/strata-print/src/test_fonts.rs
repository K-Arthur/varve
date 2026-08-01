//! Cross-platform test font resolver for strata-print tests.
//!
//! CI matrices run Ubuntu, macOS, and Windows runners. A test that only knows
//! `/usr/share/fonts` dies on the other two (this caused repeated macOS CI
//! failures). Every font-loading test helper should delegate here.
#![cfg(test)]

/// Candidate font paths across the three runner platforms.
/// macOS runners don't have `/usr/share/fonts`; Windows uses `C:\Windows\Fonts`.
pub const FONT_CANDIDATES: &[&str] = &[
    // Linux (Ubuntu runner)
    "/usr/share/fonts/TTF/OpenSans-Regular.ttf",
    "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
    "/usr/share/fonts/TTF/Vera.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/Inter-Regular.ttf",
    // macOS
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    // Windows
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\calibri.ttf",
];

/// Read the first available font, or panic listing every path tried.
pub fn test_font_bytes() -> &'static [u8] {
    for p in FONT_CANDIDATES {
        if let Ok(data) = std::fs::read(p) {
            return Box::leak(data.into_boxed_slice());
        }
    }
    panic!("no test font found — tried {FONT_CANDIDATES:?}")
}
