//! Strata trace: raster-to-vector auto-tracing.
//!
//! Research basis: Potrace (Selinger, 2003) for contour tracing and vtracer
//! for color quantization + centerline modes. Multi-threaded via rayon
//! (Strata plan §3.1). Filled in task 1.7.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
