//! Strata print: font outlining + CMYK + PDF/X export.
//!
//! Research basis: PDF/X-1a and PDF/X-4 (ISO 15930), ICC profile-based
//! RGB->CMYK conversion, and Bézier outlining of shaped glyphs so commercial
//! printers never hit font substitution or kerning corruption (Strata plan
//! §3.1). Font outlining lands in task 1.4; CMYK/PDF-X in task 1.5.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
