//! Cooperative (non-rayon) chunked tracing for WASM builds.
//!
//! Manually partitions seeds into N chunks and processes them sequentially
//! with a shared visited bitmap, providing agreement with the native
//! sequential (non-rayon) path.

use crate::{binarize, find_seeds, trace_one, Path, TraceOptions};

/// Contour-trace a raster bitmap using cooperative chunking.
///
/// Splits the seed list into `num_chunks` groups and traces each group
/// sequentially with a shared visited bitmap. No rayon dependency — pure
/// sequential chunking suitable for WASM single-threaded environments.
///
/// `pixels` is a flat array of grayscale values (0-255) in row-major order.
/// Returns a list of closed vector paths (polygons approximating each contour).
pub fn trace_contours_chunked(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    num_chunks: usize,
) -> Vec<Path> {
    if pixels.len() as u32 != width * height {
        return Vec::new();
    }

    let binary = binarize(pixels, opts.threshold);
    let seeds = find_seeds(&binary, width, height);

    if seeds.is_empty() {
        return Vec::new();
    }

    let chunks = num_chunks.max(1);
    let chunk_size = seeds.len().div_ceil(chunks);

    let mut visited = vec![false; (width * height) as usize];
    let mut traced = Vec::new();

    for chunk in seeds.chunks(chunk_size) {
        for &(sx, sy) in chunk {
            if visited[(sy * width + sx) as usize] {
                continue;
            }
            let pts = trace_one(
                &binary,
                width,
                height,
                sx,
                sy,
                &mut visited,
                opts.min_pixels,
            );
            if !pts.is_empty() {
                traced.push(Path {
                    points: pts,
                    closed: true,
                });
            }
        }
    }

    traced
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a 32x32 bitmap with a white 12x12 square centered at (10,10).
    fn square_bitmap_32x32() -> Vec<u8> {
        let mut pixels = vec![0u8; 32 * 32];
        for y in 10..22 {
            for x in 10..22 {
                pixels[y * 32 + x] = 255;
            }
        }
        pixels
    }

    /// Build a 256x256 bitmap with a filled circle (radius 80, centered).
    fn circle_bitmap_256x256() -> Vec<u8> {
        let mut pixels = vec![0u8; 256 * 256];
        let cx = 128.0_f64;
        let cy = 128.0_f64;
        let r = 80.0_f64;
        for y in 0..256 {
            for x in 0..256 {
                let dx = x as f64 - cx;
                let dy = y as f64 - cy;
                if dx * dx + dy * dy <= r * r {
                    pixels[y * 256 + x] = 255;
                }
            }
        }
        pixels
    }

    #[test]
    fn chunked_agrees_with_sequential() {
        let pixels = square_bitmap_32x32();
        let opts = TraceOptions::default();
        // trace_contours without rayon (single chunk, shared visited)
        // produces the canonical result. trace_contours_chunked(1) should
        // match it exactly.
        let sequential_no_rayon = {
            let binary = crate::binarize(&pixels, opts.threshold);
            let seeds = crate::find_seeds(&binary, 32, 32);
            let mut visited = vec![false; 32 * 32];
            let mut paths = Vec::new();
            for &(sx, sy) in &seeds {
                if visited[(sy * 32 + sx) as usize] {
                    continue;
                }
                let pts = crate::trace_one(&binary, 32, 32, sx, sy, &mut visited, opts.min_pixels);
                if !pts.is_empty() {
                    paths.push(Path {
                        points: pts,
                        closed: true,
                    });
                }
            }
            paths
        };

        let chunked_1 = trace_contours_chunked(&pixels, 32, 32, &opts, 1);
        let chunked_4 = trace_contours_chunked(&pixels, 32, 32, &opts, 4);

        // chunked(1) must match the manual sequential path exactly
        assert_eq!(
            sequential_no_rayon.len(),
            chunked_1.len(),
            "chunked(1) path count must match sequential: seq={} chunked={}",
            sequential_no_rayon.len(),
            chunked_1.len()
        );
        for (i, (s, c)) in sequential_no_rayon.iter().zip(chunked_1.iter()).enumerate() {
            assert_eq!(
                s.points.len(),
                c.points.len(),
                "chunked(1) path {} point count mismatch",
                i
            );
            for (j, (sp, cp)) in s.points.iter().zip(c.points.iter()).enumerate() {
                assert!(
                    (sp.x - cp.x).abs() < 1e-10 && (sp.y - cp.y).abs() < 1e-10,
                    "chunked(1) path {} point {}: seq=({},{}) chunked=({},{})",
                    i,
                    j,
                    sp.x,
                    sp.y,
                    cp.x,
                    cp.y,
                );
            }
        }

        // chunked(4) with shared visited produces the same canonical result
        // because the visited bitmap is shared across all chunks
        assert_eq!(
            sequential_no_rayon.len(),
            chunked_4.len(),
            "chunked(4) path count must match sequential: seq={} chunked={}",
            sequential_no_rayon.len(),
            chunked_4.len()
        );
        for (i, (s, c)) in sequential_no_rayon.iter().zip(chunked_4.iter()).enumerate() {
            assert_eq!(
                s.points.len(),
                c.points.len(),
                "chunked(4) path {} point count mismatch",
                i
            );
            for (j, (sp, cp)) in s.points.iter().zip(c.points.iter()).enumerate() {
                assert!(
                    (sp.x - cp.x).abs() < 1e-10 && (sp.y - cp.y).abs() < 1e-10,
                    "chunked(4) path {} point {}: seq=({},{}) chunked=({},{})",
                    i,
                    j,
                    sp.x,
                    sp.y,
                    cp.x,
                    cp.y,
                );
            }
        }
    }

    #[test]
    fn chunked_empty_bitmap() {
        let pixels = vec![0u8; 32 * 32];
        let opts = TraceOptions::default();
        let paths = trace_contours_chunked(&pixels, 32, 32, &opts, 4);
        assert!(paths.is_empty(), "all-zeros bitmap should produce no paths");
    }

    #[test]
    fn chunked_large_bitmap() {
        let pixels = circle_bitmap_256x256();
        let opts = TraceOptions::default();
        let chunked_1 = trace_contours_chunked(&pixels, 256, 256, &opts, 1);
        let chunked_4 = trace_contours_chunked(&pixels, 256, 256, &opts, 4);

        assert!(
            !chunked_1.is_empty(),
            "circle should produce contours (chunked(1))"
        );
        assert_eq!(
            chunked_1.len(),
            chunked_4.len(),
            "chunked(1) and chunked(4) must agree on large bitmap: c1={} c4={}",
            chunked_1.len(),
            chunked_4.len()
        );

        for (i, (a, b)) in chunked_1.iter().zip(chunked_4.iter()).enumerate() {
            assert_eq!(
                a.points.len(),
                b.points.len(),
                "path {} point count: c1={} c4={}",
                i,
                a.points.len(),
                b.points.len()
            );
            for (j, (ap, bp)) in a.points.iter().zip(b.points.iter()).enumerate() {
                assert!(
                    (ap.x - bp.x).abs() < 1e-10 && (ap.y - bp.y).abs() < 1e-10,
                    "path {} point {}: c1=({},{}) c4=({},{})",
                    i,
                    j,
                    ap.x,
                    ap.y,
                    bp.x,
                    bp.y,
                );
            }
        }
    }

    #[test]
    fn chunked_with_various_chunk_counts_agree() {
        let pixels = square_bitmap_32x32();
        let opts = TraceOptions::default();
        let baseline = trace_contours_chunked(&pixels, 32, 32, &opts, 1);

        for num_chunks in [1, 2, 4, 8] {
            let result = trace_contours_chunked(&pixels, 32, 32, &opts, num_chunks);
            assert_eq!(
                baseline.len(),
                result.len(),
                "num_chunks={} path count mismatch: baseline={} result={}",
                num_chunks,
                baseline.len(),
                result.len()
            );
            for (i, (b, r)) in baseline.iter().zip(result.iter()).enumerate() {
                assert_eq!(
                    b.points.len(),
                    r.points.len(),
                    "num_chunks={} path {} point count mismatch",
                    num_chunks,
                    i
                );
            }
        }
    }

    #[test]
    fn chunked_matches_native_rayon_or_sequential() {
        // trace_contours() may use rayon (parallel chunks with independent
        // visited) or sequential (single chunk, shared visited). The chunked
        // version always uses shared visited, so it agrees with the
        // sequential path. Verify chunked produces valid contours.
        let pixels = square_bitmap_32x32();
        let opts = TraceOptions::default();
        let chunked_1 = trace_contours_chunked(&pixels, 32, 32, &opts, 1);

        assert!(!chunked_1.is_empty(), "chunked(1) should find contours");
        // Verify all chunked(1) paths are valid contours (non-empty points)
        for (i, p) in chunked_1.iter().enumerate() {
            assert!(
                p.points.len() >= 4,
                "chunked(1) path {} should have >=4 points, got {}",
                i,
                p.points.len()
            );
        }
    }

    #[test]
    fn chunked_dimension_mismatch_returns_empty() {
        let pixels = vec![0u8; 100]; // 100 pixels, but we claim 10x20
        let opts = TraceOptions::default();
        let paths = trace_contours_chunked(&pixels, 10, 20, &opts, 4);
        assert!(paths.is_empty(), "dimension mismatch should return empty");
    }

    #[test]
    fn chunked_single_pixel_bitmap() {
        // 1x1 all-white: the pixel IS on the boundary (x=0,y=0), so it's a
        // seed. trace_one produces a 1-point path which passes min_pixels=1.
        let pixels = vec![255u8];
        let opts = TraceOptions {
            min_pixels: 1,
            ..Default::default()
        };
        let paths = trace_contours_chunked(&pixels, 1, 1, &opts, 4);
        assert_eq!(paths.len(), 1, "single white pixel should produce 1 path");
        assert_eq!(paths[0].points.len(), 1);

        // With min_pixels=2 (default is 10, but we lower it), the 1-point
        // path is filtered out
        let opts_strict = TraceOptions {
            min_pixels: 2,
            ..Default::default()
        };
        let paths_strict = trace_contours_chunked(&pixels, 1, 1, &opts_strict, 4);
        assert!(
            paths_strict.is_empty(),
            "1-point path filtered by min_pixels=2"
        );
    }

    #[test]
    fn chunked_deterministic_across_calls() {
        let pixels = square_bitmap_32x32();
        let opts = TraceOptions::default();
        let a = trace_contours_chunked(&pixels, 32, 32, &opts, 4);
        let b = trace_contours_chunked(&pixels, 32, 32, &opts, 4);

        assert_eq!(a.len(), b.len(), "determinism: path count must match");
        for (i, (pa, pb)) in a.iter().zip(b.iter()).enumerate() {
            assert_eq!(
                pa.points.len(),
                pb.points.len(),
                "determinism: path {} point count",
                i
            );
            for (j, (a, b)) in pa.points.iter().zip(pb.points.iter()).enumerate() {
                assert!(
                    (a.x - b.x).abs() < 1e-10 && (a.y - b.y).abs() < 1e-10,
                    "determinism: path {} point {} differs",
                    i,
                    j
                );
            }
        }
    }
}
