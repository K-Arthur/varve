//! Pixel-art tracing: hard-edged, pixel-aligned color regions.
//!
//! Unlike silhouette/color modes, pixel-art mode:
//!   - preserves exact (or perceptually-near) color regions without
//!     anti-aliased smoothing;
//!   - never Bézier-fits: contours are only simplified by collapsing
//!     collinear runs, so boundaries stay on the source pixel grid;
//!   - keeps every palette color as a region, including dominant whites
//!     (in pixel art white is usually intentional, unlike scanned photos);
//!   - uses 4-connected regions: diagonally touching pixels stay separate
//!     regions, so checkerboard patterns are never merged. This matches the
//!     TS fallback tracer (`traceMaskToPaths`) for cross-provider parity.
//!
//! Contours are extracted by the shared `contours` module (unit boundary
//! edge chaining), so 1-pixel-thick rings yield proper outer + hole loops.
//!
//! Deterministic by construction: palette ordering is sorted by
//! (count desc, RGB asc), components and edges are scan-ordered, and no
//! rayon parallelism is used in this module — output never depends on
//! scheduling.

use crate::contours::{component_polylines, pair_compound_holes, split_outers_holes};
use crate::quantize::{oklab_distance_sq, QuantizedColor};
use crate::{
    is_cancelled, BezierPath, BezierPoint, RgbColor, TraceBezierResult, TraceCancellation,
    TraceOptions, TraceProgress,
};
use std::collections::HashMap;
use varve_core::Point;

/// Colors closer than this squared Oklab distance are merged into one region
/// (≈ 0.05 Oklab distance — perceptually equivalent, not merely near).
const MERGE_DISTANCE_SQ: f64 = 0.0025;

/// Above this many unique colors the exact-merge path (O(U²) per merge) is
/// too slow, so we fall back to median-cut quantization (O(n·max_colors)).
/// Real pixel-art palettes are far smaller; this only guards adversarial
/// inputs (e.g. 64×64 photo-like noise).
const EXACT_PALETTE_LIMIT: usize = 256;

/// Unique opaque colors, sorted by (count desc, RGB asc) for determinism.
fn census(pixels: &[u8], width: u32, height: u32, alpha_threshold: u8) -> Vec<(u8, u8, u8, usize)> {
    let count = (width * height) as usize;
    // HashMap census for O(n); the result is fully sorted afterwards, so
    // iteration order never reaches the output.
    let mut counts: HashMap<(u8, u8, u8), usize> = HashMap::new();
    for pixel in pixels.chunks_exact(4).take(count) {
        if pixel[3] < alpha_threshold {
            continue;
        }
        *counts.entry((pixel[0], pixel[1], pixel[2])).or_insert(0) += 1;
    }
    let mut colors: Vec<(u8, u8, u8, usize)> = counts
        .into_iter()
        .map(|((r, g, b), c)| (r, g, b, c))
        .collect();
    sort_colors(&mut colors);
    colors
}

fn sort_colors(colors: &mut [(u8, u8, u8, usize)]) {
    colors.sort_by(|a, b| {
        b.3.cmp(&a.3)
            .then(a.0.cmp(&b.0))
            .then(a.1.cmp(&b.1))
            .then(a.2.cmp(&b.2))
    });
}

/// Merge colors `i` and `j` into the more frequent one (weighted average).
fn merge_pair(colors: &mut Vec<(u8, u8, u8, usize)>, i: usize, j: usize) {
    let (a, b) = if colors[i].3 >= colors[j].3 {
        (i, j)
    } else {
        (j, i)
    };
    let total = (colors[a].3 + colors[b].3).max(1) as f64;
    colors[a] = (
        ((colors[a].0 as f64 * colors[a].3 as f64 + colors[b].0 as f64 * colors[b].3 as f64)
            / total)
            .round() as u8,
        ((colors[a].1 as f64 * colors[a].3 as f64 + colors[b].1 as f64 * colors[b].3 as f64)
            / total)
            .round() as u8,
        ((colors[a].2 as f64 * colors[a].3 as f64 + colors[b].2 as f64 * colors[b].3 as f64)
            / total)
            .round() as u8,
        colors[a].3 + colors[b].3,
    );
    colors.remove(b);
    sort_colors(colors);
}

/// Pixel-art palette: exact colors when they fit the budget; otherwise the
/// perceptually-nearest pair is merged (greedy closest-pair, weighted
/// average) until the palette fits. Deterministic and bounded.
pub(crate) fn quantize_exact_palette(
    pixels: &[u8],
    width: u32,
    height: u32,
    max_colors: u8,
    alpha_threshold: u8,
) -> Vec<QuantizedColor> {
    let mut colors = census(pixels, width, height, alpha_threshold);
    if colors.is_empty() {
        return Vec::new();
    }

    let budget = max_colors.max(1) as usize;
    if colors.len() > EXACT_PALETTE_LIMIT {
        // Adversarially large unique-color count: median-cut in Oklab (the
        // shared color-mode quantizer) instead of the exact-merge path.
        return crate::quantize::quantize_palette(
            pixels,
            width,
            height,
            max_colors,
            alpha_threshold,
            false,
        );
    }

    // Pass 1: merge perceptually-equivalent colors (within MERGE_DISTANCE_SQ).
    // This never blends meaningfully different colors, only near-duplicates.
    let mut merged = true;
    while colors.len() > budget && merged {
        merged = false;
        for i in 0..colors.len() {
            for j in (i + 1)..colors.len() {
                let d = oklab_distance_sq(
                    colors[i].0,
                    colors[i].1,
                    colors[i].2,
                    colors[j].0,
                    colors[j].1,
                    colors[j].2,
                );
                if d < MERGE_DISTANCE_SQ {
                    merge_pair(&mut colors, i, j);
                    merged = true;
                    break;
                }
            }
            if merged {
                break;
            }
        }
    }
    // Pass 2: still over budget — force-merge the perceptually-nearest pair
    // (weighted average) until the palette fits. Exceeds perceptual tolerance,
    // but honors the user's color-count target.
    while colors.len() > budget {
        let mut best: Option<(usize, usize, f64)> = None;
        for i in 0..colors.len() {
            for j in (i + 1)..colors.len() {
                let d = oklab_distance_sq(
                    colors[i].0,
                    colors[i].1,
                    colors[i].2,
                    colors[j].0,
                    colors[j].1,
                    colors[j].2,
                );
                if best.is_none_or(|(_, _, bd)| d < bd) {
                    best = Some((i, j, d));
                }
            }
        }
        let Some((i, j, _)) = best else {
            break;
        };
        merge_pair(&mut colors, i, j);
    }

    colors
        .into_iter()
        .map(|(r, g, b, c)| QuantizedColor {
            r,
            g,
            b,
            a: 255,
            count: c,
        })
        .collect()
}

fn to_beziers(points: &[Point]) -> Vec<BezierPoint> {
    points
        .iter()
        .map(|pt| BezierPoint {
            x: pt.x,
            y: pt.y,
            handle_in: None,
            handle_out: None,
        })
        .collect()
}

/// Trace one color mask to pixel-aligned compound polygons.
///
/// Components are 4-connected (diagonally touching pixels stay separate) and
/// discovered in scan order, so output order is deterministic.
fn trace_color_mask(
    mask: &[bool],
    dims: (u32, u32),
    min_region: usize,
    cancel: Option<&TraceCancellation>,
    fill: RgbColor,
    compound_holes: bool,
    omitted_holes: &mut usize,
) -> Vec<BezierPath> {
    let (width, height) = dims;
    let polys = component_polylines(mask, width, height, min_region, cancel);
    if polys.is_empty() {
        return Vec::new();
    }

    if compound_holes {
        let (compounds, omitted) = pair_compound_holes(&polys);
        *omitted_holes += omitted;
        return compounds
            .into_iter()
            .map(|c| BezierPath {
                points: to_beziers(&c.outer),
                closed: true,
                fill: Some(fill),
                holes: c.holes.iter().map(|ring| to_beziers(ring)).collect(),
            })
            .collect();
    }

    let (outers, hole_rings) = split_outers_holes(&polys);
    *omitted_holes += hole_rings.len();
    outers
        .into_iter()
        .map(|poly| BezierPath {
            points: to_beziers(&poly),
            closed: true,
            fill: Some(fill),
            holes: Vec::new(),
        })
        .collect()
}

/// Trace an RGBA raster as pixel art.
///
/// Every opaque color becomes a region traced as a hard-edged polygon;
/// colors within a small perceptual distance are merged when the palette
/// exceeds `max_colors`. Transparent pixels are always background.
pub(crate) fn trace_pixel_art(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    cancel: Option<&TraceCancellation>,
    progress: TraceProgress<'_>,
) -> TraceBezierResult {
    if cancel.is_some_and(is_cancelled) {
        return empty_result();
    }
    let palette =
        quantize_exact_palette(pixels, width, height, opts.max_colors, opts.alpha_threshold);
    if palette.is_empty() {
        return empty_result();
    }

    let count = (width * height) as usize;
    let mut assignments = vec![-1i16; count];
    for (i, pixel) in pixels.chunks_exact(4).enumerate().take(count) {
        if i % 65536 == 0 && cancel.is_some_and(is_cancelled) {
            return empty_result();
        }
        if pixel[3] < opts.alpha_threshold {
            continue;
        }
        let mut best = 0i16;
        let mut best_dist = f64::MAX;
        for (pi, pc) in palette.iter().enumerate() {
            let d = oklab_distance_sq(pixel[0], pixel[1], pixel[2], pc.r, pc.g, pc.b);
            if d < best_dist {
                best_dist = d;
                best = pi as i16;
            }
        }
        assignments[i] = best;
    }

    let mut paths: Vec<BezierPath> = Vec::new();
    let mut omitted_holes = 0usize;
    let total = palette.len().max(1);
    for (pi, color) in palette.iter().enumerate() {
        if cancel.is_some_and(is_cancelled) {
            break;
        }
        if let Some(report) = progress {
            report("segmenting", 0.15 + 0.8 * (pi as f64 + 1.0) / total as f64);
        }
        let mut mask = vec![false; count];
        for (m, &a) in mask.iter_mut().zip(assignments.iter()) {
            *m = a == pi as i16;
        }
        let fill = RgbColor {
            r: color.r,
            g: color.g,
            b: color.b,
            a: color.a,
        };
        paths.extend(trace_color_mask(
            &mask,
            (width, height),
            opts.min_pixels.max(1),
            cancel,
            fill,
            opts.compound_holes,
            &mut omitted_holes,
        ));
        if opts.max_paths > 0 && paths.len() >= opts.max_paths {
            break;
        }
    }

    if opts.max_paths > 0 && paths.len() > opts.max_paths {
        paths.sort_by(|a, b| {
            let area_a: f64 = a.points.iter().map(|p| p.x * p.y).sum();
            let area_b: f64 = b.points.iter().map(|p| p.x * p.y).sum();
            area_b
                .partial_cmp(&area_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        paths.truncate(opts.max_paths);
    }

    if let Some(report) = progress {
        report("done", 1.0);
    }
    TraceBezierResult {
        paths,
        omitted_holes,
    }
}

fn empty_result() -> TraceBezierResult {
    TraceBezierResult {
        paths: Vec::new(),
        omitted_holes: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TraceOptions;

    fn rgba(width: u32, height: u32, pixels: &[(u32, u32, [u8; 4])]) -> Vec<u8> {
        let mut buf = vec![0u8; (width * height * 4) as usize];
        for &(x, y, c) in pixels {
            let i = ((y * width + x) * 4) as usize;
            buf[i..i + 4].copy_from_slice(&c);
        }
        buf
    }

    #[test]
    fn pixel_art_single_rect_region() {
        // 8x8 canvas, red 4x4 block at (2,2), rest transparent.
        let mut block = Vec::new();
        for y in 2..6u32 {
            for x in 2..6u32 {
                block.push((x, y, [255, 0, 0, 255]));
            }
        }
        let pixels = rgba(8, 8, &block);
        let mut opts = TraceOptions {
            max_colors: 8,
            min_pixels: 1,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 8, 8, &opts, None, None);
        assert_eq!(result.paths.len(), 1, "one region for one color");
        let path = &result.paths[0];
        assert!(path.closed);
        assert_eq!(
            path.fill,
            Some(RgbColor {
                r: 255,
                g: 0,
                b: 0,
                a: 255
            })
        );
        // Axis-aligned square: 4 points, no handles.
        assert_eq!(path.points.len(), 4);
        assert!(path.points.iter().all(|p| p.handle_in.is_none()));
    }

    #[test]
    fn pixel_art_two_colors_two_regions() {
        let pixels = rgba(8, 8, &[(2, 2, [255, 0, 0, 255]), (2, 5, [0, 0, 255, 255])]);
        let mut opts = TraceOptions {
            max_colors: 8,
            min_pixels: 1,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 8, 8, &opts, None, None);
        assert_eq!(result.paths.len(), 2);
    }

    #[test]
    fn pixel_art_preserves_hole() {
        // Donut: red ring with transparent center.
        let mut pixels = vec![0u8; 10 * 10 * 4];
        for y in 0..10u32 {
            for x in 0..10u32 {
                let ring = (2..=7).contains(&x)
                    && (2..=7).contains(&y)
                    && !((4..=5).contains(&x) && (4..=5).contains(&y));
                if ring {
                    let i = ((y * 10 + x) * 4) as usize;
                    pixels[i] = 200;
                    pixels[i + 1] = 30;
                    pixels[i + 2] = 30;
                    pixels[i + 3] = 255;
                }
            }
        }
        let mut opts = TraceOptions {
            max_colors: 8,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 10, 10, &opts, None, None);
        assert_eq!(result.paths.len(), 1);
        assert_eq!(result.paths[0].holes.len(), 1, "hole ring preserved");
        assert_eq!(result.omitted_holes, 0);
    }

    #[test]
    fn pixel_art_merges_near_colors_when_over_budget() {
        // Two reds that differ slightly, budget of 1 color → merged.
        let pixels = rgba(8, 8, &[(2, 2, [255, 0, 0, 255]), (3, 2, [250, 4, 4, 255])]);
        let mut opts = TraceOptions {
            max_colors: 1,
            min_pixels: 1,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 8, 8, &opts, None, None);
        assert_eq!(result.paths.len(), 1);
        let merged = result.paths[0].fill.unwrap();
        assert!((merged.r as i16 - 255).abs() <= 5);
    }

    #[test]
    fn pixel_art_exact_colors_kept_when_within_budget() {
        let pixels = rgba(8, 8, &[(2, 2, [255, 0, 0, 255]), (2, 5, [0, 255, 0, 255])]);
        let mut opts = TraceOptions {
            max_colors: 8,
            min_pixels: 1,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 8, 8, &opts, None, None);
        assert_eq!(result.paths.len(), 2);
        let fills: Vec<(u8, u8, u8)> = result
            .paths
            .iter()
            .map(|p| {
                let f = p.fill.unwrap();
                (f.r, f.g, f.b)
            })
            .collect();
        assert!(fills.contains(&(255, 0, 0)));
        assert!(fills.contains(&(0, 255, 0)));
    }

    #[test]
    fn pixel_art_transparent_is_background() {
        let pixels = vec![0u8; 4 * 4 * 4]; // fully transparent
        let result = trace_pixel_art(&pixels, 4, 4, &TraceOptions::default(), None, None);
        assert!(result.paths.is_empty());
    }

    #[test]
    fn pixel_art_single_pixel_is_unit_rect() {
        let pixels = rgba(4, 4, &[(2, 2, [10, 10, 10, 255])]);
        let mut opts = TraceOptions {
            max_colors: 4,
            min_pixels: 1,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 4, 4, &opts, None, None);
        assert_eq!(result.paths.len(), 1);
        let points = &result.paths[0].points;
        assert_eq!(points.len(), 4, "single pixel becomes a unit rect");
        let xs: Vec<f64> = points.iter().map(|p| p.x).collect();
        let ys: Vec<f64> = points.iter().map(|p| p.y).collect();
        assert!(xs.contains(&2.0) && xs.contains(&3.0));
        assert!(ys.contains(&2.0) && ys.contains(&3.0));
    }

    #[test]
    fn pixel_art_deterministic() {
        let mut pixels = vec![0u8; 32 * 32 * 4];
        for y in 0..32u32 {
            for x in 0..32u32 {
                let i = ((y * 32 + x) * 4) as usize;
                let c = ((x * 7 + y * 13) % 5) as u8;
                pixels[i] = c * 51;
                pixels[i + 1] = 255 - c * 40;
                pixels[i + 2] = ((c as u16 * 90) % 256) as u8;
                pixels[i + 3] = 255;
            }
        }
        let mut opts = TraceOptions {
            max_colors: 6,
            ..Default::default()
        };
        opts.compound_holes = true;
        let a = trace_pixel_art(&pixels, 32, 32, &opts, None, None);
        let b = trace_pixel_art(&pixels, 32, 32, &opts, None, None);
        assert_eq!(a.paths.len(), b.paths.len());
        for (pa, pb) in a.paths.iter().zip(b.paths.iter()) {
            assert_eq!(pa.points.len(), pb.points.len());
            assert_eq!(pa.fill, pb.fill);
            assert_eq!(pa.holes.len(), pb.holes.len());
        }
    }

    #[test]
    fn pixel_art_cancellation_returns_partial() {
        let mut pixels = vec![0u8; 64 * 64 * 4];
        for y in 0..64u32 {
            for x in 0..64u32 {
                let i = ((y * 64 + x) * 4) as usize;
                pixels[i] = (x * 3) as u8;
                pixels[i + 1] = (y * 3) as u8;
                pixels[i + 2] = 40;
                pixels[i + 3] = 255;
            }
        }
        let cancel = crate::new_cancellation();
        let mut opts = TraceOptions {
            max_colors: 4,
            ..Default::default()
        };
        opts.compound_holes = true;
        let result = trace_pixel_art(&pixels, 64, 64, &opts, Some(&cancel), None);
        // Without cancellation this is deterministic; with a fresh flag the
        // result must equal the uncancelled run.
        let reference = trace_pixel_art(&pixels, 64, 64, &opts, None, None);
        assert_eq!(result.paths.len(), reference.paths.len());
        cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        let cancelled = trace_pixel_art(&pixels, 64, 64, &opts, Some(&cancel), None);
        // Cancelled runs are either partial or empty, never panicked.
        assert!(cancelled.paths.len() <= reference.paths.len());
    }
}
