//! Raster-to-vector auto-tracing (Potrace-class contour tracing).
//!
//! `trace_contours()` binarizes a grayscale bitmap and traces the boundaries
//! of foreground regions, returning vector paths. Uses rayon for multi-
//! threaded processing of disjoint regions.
//!
//! Research basis: Potrace (Selinger, 2003) — contour tracing via path-
//! following on a binary edge map. Color quantization and centerline tracing
//! (vtracer-class) are future extensions.

#![forbid(unsafe_code)]

pub mod bezier_fit;
pub mod centerline;
pub mod chunked;
pub mod contours;
pub mod hierarchy;
pub mod pixel_art;
pub mod quantize;

#[cfg(feature = "rayon")]
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use varve_core::Point;

/// Shared cancellation flag for long-running traces.
///
/// Polled with a single relaxed atomic load inside computational loops so a
/// caller (Tauri command, UI job) can interrupt tracing between and within
/// stages. Cheap enough to check per chunk or per region.
pub type TraceCancellation = Arc<AtomicBool>;

/// Create a fresh, uncancelled cancellation flag.
pub fn new_cancellation() -> TraceCancellation {
    Arc::new(AtomicBool::new(false))
}

/// True when the cancellation flag has been set.
#[inline]
pub fn is_cancelled(cancel: &TraceCancellation) -> bool {
    cancel.load(Ordering::Relaxed)
}

/// Optional progress reporter. Receives a stage name and a 0.0-1.0 fraction.
/// Called from deterministic points between computational sections only —
/// never inside parallel regions — so output remains scheduling-independent.
pub type TraceProgress<'a> = Option<&'a (dyn Fn(&str, f64) + Sync)>;

/// Result of a trace run: fitted paths plus the number of hole rings that
/// could not be paired with a containing outer contour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceBezierResult {
    pub paths: Vec<BezierPath>,
    pub omitted_holes: usize,
}

/// A vector path: an ordered sequence of points forming a closed or open shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Path {
    pub points: Vec<Point>,
    pub closed: bool,
}

/// A single point in a Bezier path with optional handle offsets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BezierPoint {
    pub x: f64,
    pub y: f64,
    pub handle_in: Option<(f64, f64)>,
    pub handle_out: Option<(f64, f64)>,
}

/// A fitted Bezier path with fill color.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BezierPath {
    pub points: Vec<BezierPoint>,
    pub closed: bool,
    pub fill: Option<RgbColor>,
    /// Hole rings (same coordinate space as `points`) for compound paths.
    /// Empty for non-compound output. `serde(default)` keeps wire payloads
    /// written before this field existed decodable.
    #[serde(default)]
    pub holes: Vec<Vec<BezierPoint>>,
}

/// RGB color with alpha.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

/// Trace mode: silhouette (filled contours), centerline (stroked skeletons),
/// or pixel-art (hard-edged pixel-aligned color regions).
#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceMode {
    #[default]
    Silhouette,
    Centerline,
    PixelArt,
}

/// Options for raster-to-vector tracing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceOptions {
    /// Grayscale threshold (0-255) for binarization.
    pub threshold: u8,
    /// Minimum contour pixel count to include (filters noise).
    pub min_pixels: usize,
    /// Maximum number of colors for color quantization (0 = monochrome).
    pub max_colors: u8,
    /// Which luminance direction is treated as foreground. Matches the JS
    /// rasterTrace.ts default of dark foreground.
    pub foreground: Foreground,
    /// Interior angle threshold for sharp corners (degrees, 90-180).
    #[serde(default = "default_corner_angle")]
    pub corner_angle: f64,
    /// Maximum Bezier fitting error in pixels (0.01-10).
    #[serde(default = "default_max_error")]
    pub max_error: f64,
    /// Ramer-Douglas-Peucker tolerance in source pixels, applied before
    /// fitting silhouette and centerline paths. Pixel-art intentionally
    /// bypasses this to preserve the exact pixel grid.
    #[serde(default = "default_simplify_tolerance")]
    pub simplify_tolerance: f64,
    /// Trace mode: silhouette (filled) or centerline (stroked).
    #[serde(default)]
    pub trace_mode: TraceMode,
    /// Alpha threshold (0-255) for transparency handling.
    #[serde(default = "default_alpha_threshold")]
    pub alpha_threshold: u8,
    /// Target stroke width for centerline mode (pixels).
    #[serde(default = "default_centerline_width")]
    pub centerline_width: f64,
    /// Minimum branch length to keep for centerline mode (pixels).
    #[serde(default = "default_centerline_prune")]
    pub centerline_prune: f64,
    /// Maximum number of paths to keep (0 = unlimited).
    #[serde(default = "default_max_paths")]
    pub max_paths: usize,
    /// When true, attach holes to their containing outer via winding-number nesting.
    #[serde(default = "default_compound_holes")]
    pub compound_holes: bool,
}

fn default_corner_angle() -> f64 {
    135.0
}
fn default_max_error() -> f64 {
    1.0
}
fn default_simplify_tolerance() -> f64 {
    0.75
}
fn default_alpha_threshold() -> u8 {
    1
}
fn default_centerline_width() -> f64 {
    2.0
}
fn default_centerline_prune() -> f64 {
    4.0
}
fn default_max_paths() -> usize {
    1000
}
fn default_compound_holes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Foreground {
    #[default]
    Dark,
    Light,
}

impl Default for TraceOptions {
    fn default() -> Self {
        Self {
            threshold: 128,
            min_pixels: 10,
            max_colors: 0,
            foreground: Foreground::default(),
            corner_angle: default_corner_angle(),
            max_error: default_max_error(),
            simplify_tolerance: default_simplify_tolerance(),
            trace_mode: TraceMode::default(),
            alpha_threshold: default_alpha_threshold(),
            centerline_width: default_centerline_width(),
            centerline_prune: default_centerline_prune(),
            max_paths: default_max_paths(),
            compound_holes: default_compound_holes(),
        }
    }
}

/// Contour-trace a single raster bitmap.
///
/// `pixels` is a flat array of grayscale values (0-255) in row-major order.
/// Returns a list of closed vector paths (polygons approximating each contour).
pub fn trace_contours(pixels: &[u8], width: u32, height: u32, opts: &TraceOptions) -> Vec<Path> {
    trace_contours_cancellable(pixels, width, height, opts, None)
}

/// Cancellable variant of [`trace_contours`]. Returns the contours traced so
/// far when the cancellation flag is set; partial output is safe to discard.
pub fn trace_contours_cancellable(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    cancel: Option<&TraceCancellation>,
) -> Vec<Path> {
    if pixels.len() as u64 != u64::from(width) * u64::from(height) {
        return Vec::new();
    }

    // Step 1: Binarize
    let binary = binarize(pixels, opts.threshold, opts.foreground);

    // Step 2: Find contour seeds (foreground pixels adjacent to background)
    let seeds: Vec<(u32, u32)> = find_seeds(&binary, width, height);

    // Step 3: Trace contours (parallel with rayon, sequential otherwise)
    #[cfg(feature = "rayon")]
    let path_groups: Vec<Vec<Path>> = {
        let chunk_size = seeds.len().max(1) / rayon::current_num_threads().max(1) + 1;
        seeds
            .par_chunks(chunk_size)
            .map(|chunk| trace_chunk(chunk, &binary, width, height, opts.min_pixels, cancel))
            .collect()
    };

    #[cfg(not(feature = "rayon"))]
    let path_groups: Vec<Vec<Path>> = {
        vec![trace_chunk(
            &seeds,
            &binary,
            width,
            height,
            opts.min_pixels,
            cancel,
        )]
    };

    path_groups.into_iter().flatten().collect()
}

fn trace_chunk(
    seeds: &[(u32, u32)],
    binary: &[bool],
    width: u32,
    height: u32,
    min_pixels: usize,
    cancel: Option<&TraceCancellation>,
) -> Vec<Path> {
    let mut traced = Vec::new();
    let mut visited = vec![false; (width * height) as usize];
    for &(sx, sy) in seeds {
        if cancel.is_some_and(is_cancelled) {
            break;
        }
        if visited[(sy * width + sx) as usize] {
            continue;
        }
        let pts = trace_one(binary, width, height, sx, sy, &mut visited, min_pixels);
        if !pts.is_empty() {
            traced.push(Path {
                points: pts,
                closed: true,
            });
        }
    }
    traced
}

fn binarize(pixels: &[u8], threshold: u8, foreground: Foreground) -> Vec<bool> {
    pixels
        .iter()
        .map(|&p| match foreground {
            Foreground::Light => p > threshold,
            Foreground::Dark => p < threshold,
        })
        .collect()
}

fn find_seeds(binary: &[bool], width: u32, height: u32) -> Vec<(u32, u32)> {
    let mut seeds = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            if !binary[idx] {
                continue;
            }
            // A foreground pixel adjacent to background is a contour seed
            let is_boundary = x == 0
                || y == 0
                || x == width - 1
                || y == height - 1
                || !binary[((y - 1) * width + x) as usize]
                || !binary[((y + 1) * width + x) as usize]
                || !binary[(y * width + (x - 1)) as usize]
                || !binary[(y * width + (x + 1)) as usize];
            if is_boundary {
                seeds.push((x, y));
            }
        }
    }
    seeds
}

/// Follow a single contour starting from (sx, sy).
/// Uses 8-directional path following along the foreground edge.
fn trace_one(
    binary: &[bool],
    width: u32,
    height: u32,
    sx: u32,
    sy: u32,
    visited: &mut [bool],
    min_pixels: usize,
) -> Vec<Point> {
    // 8-direction offsets: right, down-right, down, down-left, left, up-left, up, up-right
    let dirs: [(i32, i32); 8] = [
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
    ];

    let mut path = Vec::new();
    let mut cx = sx as i32;
    let mut cy = sy as i32;
    let mut dir = 5; // start going up-left

    loop {
        let idx = (cy as u32 * width + cx as u32) as usize;
        if idx >= visited.len() {
            break;
        }
        visited[idx] = true;

        let px = cx as f64;
        let py = cy as f64;
        if path.is_empty() || path.last() != Some(&Point::new(px, py)) {
            path.push(Point::new(px, py));
        }

        // Search around the current point for the next boundary pixel
        let mut found = false;
        for i in 0..8 {
            let nd = (dir + i) % 8;
            let (dx, dy) = dirs[nd as usize];
            let nx = cx + dx;
            let ny = cy + dy;

            if nx < 0 || nx >= width as i32 || ny < 0 || ny >= height as i32 {
                continue;
            }

            let nidx = (ny as u32 * width + nx as u32) as usize;
            if binary[nidx] {
                cx = nx;
                cy = ny;
                dir = (nd + 5) % 8; // turn right relative to direction
                found = true;
                break;
            }
        }

        if !found || (cx == sx as i32 && cy == sy as i32) || path.len() > (width * height) as usize
        {
            break;
        }
    }

    if path.len() < min_pixels {
        return Vec::new();
    }

    path
}

/// Simplify a path using Ramer-Douglas-Peucker with the given epsilon.
pub fn simplify_path(path: &[Point], epsilon: f64) -> Vec<Point> {
    if path.len() <= 2 {
        return path.to_vec();
    }

    let mut result = Vec::new();
    rdp(path, epsilon, &mut result);
    result
}

/// Simplify a closed contour without treating the arbitrary first vertex as a
/// hard endpoint. The farthest vertex splits the ring into two open spans;
/// RDP then preserves the seam and returns an unclosed ring suitable for
/// contour fitting and hole pairing.
fn simplify_closed_path(path: &[Point], epsilon: f64) -> Vec<Point> {
    if epsilon <= 0.0 || path.len() <= 3 {
        return path.to_vec();
    }

    let anchor = path[0];
    let (pivot_index, max_distance_sq) = path
        .iter()
        .enumerate()
        .skip(1)
        .map(|(index, point)| {
            let dx = point.x - anchor.x;
            let dy = point.y - anchor.y;
            (index, dx * dx + dy * dy)
        })
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or((0, 0.0));
    if pivot_index == 0 || max_distance_sq == 0.0 {
        return path.to_vec();
    }

    let mut first = simplify_path(&path[..=pivot_index], epsilon);
    let mut second_span = path[pivot_index..].to_vec();
    second_span.push(anchor);
    let second = simplify_path(&second_span, epsilon);

    // Join at the pivot, then remove the repeated closing anchor.
    first.pop();
    first.extend(second);
    first.pop();
    if first.len() >= 3 {
        first
    } else {
        path.to_vec()
    }
}

fn rdp(path: &[Point], epsilon: f64, result: &mut Vec<Point>) {
    if path.is_empty() {
        return;
    }
    if path.len() <= 2 {
        result.extend_from_slice(path);
        return;
    }

    let start = path[0];
    let end = *path.last().unwrap();

    let (max_dist, max_idx) = path[1..path.len() - 1]
        .iter()
        .enumerate()
        .map(|(i, p)| (point_line_distance(*p, start, end), i + 1))
        .max_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or((0.0, 0));

    if max_dist > epsilon {
        rdp(&path[..=max_idx], epsilon, result);
        result.pop(); // remove duplicate endpoint
        rdp(&path[max_idx..], epsilon, result);
    } else {
        result.push(start);
        result.push(end);
    }
}

fn point_line_distance(p: Point, a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len_sq = dx * dx + dy * dy;
    if len_sq == 0.0 {
        return ((p.x - a.x).powi(2) + (p.y - a.y).powi(2)).sqrt();
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len_sq;
    let t = t.clamp(0.0, 1.0);
    let proj_x = a.x + t * dx;
    let proj_y = a.y + t * dy;
    ((p.x - proj_x).powi(2) + (p.y - proj_y).powi(2)).sqrt()
}

/// Determine if a pixel is foreground based on threshold and foreground direction.
fn is_foreground(luma: u8, threshold: u8, foreground: Foreground) -> bool {
    match foreground {
        Foreground::Dark => luma < threshold,
        Foreground::Light => luma > threshold,
    }
}

/// Luminance from RGB.
fn luminance(r: u8, g: u8, b: u8) -> u8 {
    (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64).round() as u8
}

/// Binarize RGBA pixels to a bool mask, skipping transparent pixels.
fn binarize_rgba(pixels: &[u8], width: u32, height: u32, opts: &TraceOptions) -> Vec<bool> {
    let mut mask = vec![false; (width * height) as usize];
    for (i, pixel) in pixels.chunks_exact(4).enumerate() {
        if i >= mask.len() {
            break;
        }
        let alpha = pixel[3];
        if alpha < opts.alpha_threshold {
            continue;
        }
        let r = pixel[0];
        let g = pixel[1];
        let b = pixel[2];
        let luma = luminance(r, g, b);
        mask[i] = is_foreground(luma, opts.threshold, opts.foreground);
    }
    mask
}

/// Trace a single binary mask to Bezier paths.
/// Uses the shared boundary-edge extractor (4-connected components), then
/// fits each closed polyline with cubic Béziers. Hole rings are paired with
/// their containing outer when `compound_holes` is enabled.
fn trace_mask_to_beziers(
    mask: &[bool],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    cancel: Option<&TraceCancellation>,
    fill_color: Option<RgbColor>,
    omitted_holes: &mut usize,
) -> Vec<BezierPath> {
    let raw_polys =
        contours::component_polylines(mask, width, height, opts.min_pixels.max(1), cancel);
    let polys: Vec<Vec<Point>> = raw_polys
        .iter()
        .map(|poly| simplify_closed_path(poly, opts.simplify_tolerance))
        .collect();
    let mut result: Vec<BezierPath> = polys
        .iter()
        .map(|p| {
            let contour: Vec<(f64, f64)> = p.iter().map(|pt| (pt.x, pt.y)).collect();
            let points = bezier_fit::fit_bezier_to_contour(
                &contour,
                true,
                opts.corner_angle,
                opts.max_error,
            );
            BezierPath {
                points,
                closed: true,
                fill: fill_color,
                holes: Vec::new(),
            }
        })
        .collect();

    // Apply hole pairing if enabled
    if opts.compound_holes && result.len() >= 2 {
        let (compounds, omitted) = contours::pair_compound_holes(&polys);
        *omitted_holes += omitted;
        let color = fill_color;
        result = compounds
            .into_iter()
            .map(|c| {
                let contour: Vec<(f64, f64)> = c.outer.iter().map(|pt| (pt.x, pt.y)).collect();
                let points = bezier_fit::fit_bezier_to_contour(
                    &contour,
                    true,
                    opts.corner_angle,
                    opts.max_error,
                );
                let holes: Vec<Vec<BezierPoint>> = c
                    .holes
                    .iter()
                    .map(|ring| {
                        let contour: Vec<(f64, f64)> = ring.iter().map(|pt| (pt.x, pt.y)).collect();
                        bezier_fit::fit_bezier_to_contour(
                            &contour,
                            true,
                            opts.corner_angle,
                            opts.max_error,
                        )
                    })
                    .collect();
                BezierPath {
                    points,
                    closed: true,
                    fill: color,
                    holes,
                }
            })
            .collect();
    }

    // Apply max_paths limit
    if opts.max_paths > 0 && result.len() > opts.max_paths {
        sort_paths_by_area_desc(&mut result);
        result.truncate(opts.max_paths);
    }

    result
}

pub(crate) fn polygon_area_internal(points: &[Point]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        sum += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    sum / 2.0
}

/// Trace a raster bitmap to Bezier paths with full support for color quantization,
/// contour hierarchy, and centerline mode.
///
/// When `max_colors > 0`, performs median-cut quantization and traces each color
/// independently. When `trace_mode == Centerline`, uses Zhang-Suen thinning and
/// skeleton extraction instead of contour tracing. When `trace_mode == PixelArt`,
/// traces hard-edged pixel-aligned regions per exact/near-exact color.
pub fn trace_to_beziers(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts: &TraceOptions,
) -> Vec<BezierPath> {
    trace_to_beziers_cancellable(pixels, width, height, opts, None, None).paths
}

/// Cancellable, progress-reporting variant of [`trace_to_beziers`].
///
/// Polls `cancel` inside computational loops (binarize/assign/contour/centerline)
/// and returns the paths traced so far when cancelled — callers must treat a
/// cancelled result as stale and discard it. `progress` is reported between
/// deterministic sections only, so parallel scheduling never changes output.
pub fn trace_to_beziers_cancellable(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    cancel: Option<&TraceCancellation>,
    progress: TraceProgress<'_>,
) -> TraceBezierResult {
    if is_cancelled_flag(cancel) {
        return TraceBezierResult {
            paths: Vec::new(),
            omitted_holes: 0,
        };
    }
    if pixels.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return TraceBezierResult {
            paths: Vec::new(),
            omitted_holes: 0,
        };
    }

    // Centerline mode
    if opts.trace_mode == TraceMode::Centerline {
        if let Some(report) = progress {
            report("preprocessing", 0.15);
        }
        let mask = binarize_rgba(pixels, width, height, opts);
        let skeleton = centerline::thin_image(&mask, width, height, cancel);
        let branches =
            centerline::extract_skeleton(&skeleton, width, height, opts.centerline_prune, cancel);
        let total = branches.len().max(1);
        let mut paths = Vec::new();
        for (i, branch) in branches.into_iter().enumerate() {
            if is_cancelled_flag(cancel) {
                break;
            }
            let branch_points: Vec<Point> = branch
                .iter()
                .map(|point| Point::new(point.0, point.1))
                .collect();
            let contour: Vec<(f64, f64)> = simplify_path(&branch_points, opts.simplify_tolerance)
                .iter()
                .map(|point| (point.x, point.y))
                .collect();
            let points = bezier_fit::fit_bezier_to_contour(
                &contour,
                false,
                opts.corner_angle,
                opts.max_error,
            );
            if !points.is_empty() {
                paths.push(BezierPath {
                    points,
                    closed: false,
                    fill: None,
                    holes: Vec::new(),
                });
            }
            if let Some(report) = progress {
                report("fitting", 0.15 + 0.8 * (i as f64 + 1.0) / total as f64);
            }
        }
        return TraceBezierResult {
            paths,
            omitted_holes: 0,
        };
    }

    // Pixel-art mode
    if opts.trace_mode == TraceMode::PixelArt {
        return pixel_art::trace_pixel_art(pixels, width, height, opts, cancel, progress);
    }

    // Silhouette mode
    // Color quantization path
    if opts.max_colors > 0 {
        if let Some(report) = progress {
            report("quantizing", 0.1);
        }
        let palette = quantize::quantize_palette(
            pixels,
            width,
            height,
            opts.max_colors,
            opts.alpha_threshold,
            false,
        );
        if palette.is_empty() {
            return TraceBezierResult {
                paths: Vec::new(),
                omitted_holes: 0,
            };
        }

        let count = (width * height) as usize;
        let mut assignments = vec![-1i16; count];
        for (i, pixel) in pixels.chunks_exact(4).enumerate().take(count) {
            if i % 65536 == 0 && is_cancelled_flag(cancel) {
                return TraceBezierResult {
                    paths: Vec::new(),
                    omitted_holes: 0,
                };
            }
            let alpha = pixel[3];
            if alpha < opts.alpha_threshold {
                continue;
            }
            let r = pixel[0];
            let g = pixel[1];
            let b = pixel[2];
            // Assign to nearest palette color
            let mut best = 0i16;
            let mut best_dist = f64::MAX;
            for (pi, pc) in palette.iter().enumerate() {
                let dr = r as f64 - pc.r as f64;
                let dg = g as f64 - pc.g as f64;
                let db = b as f64 - pc.b as f64;
                let dist = dr * dr + dg * dg + db * db;
                if dist < best_dist {
                    best_dist = dist;
                    best = pi as i16;
                }
            }
            assignments[i] = best;
        }

        let mut all_paths: Vec<BezierPath> = Vec::new();
        let mut omitted_holes = 0usize;
        let count_pixels = count as f64;
        let total_colors = palette.len().max(1);
        for (pi, color) in palette.iter().enumerate() {
            if is_cancelled_flag(cancel) {
                break;
            }
            if let Some(report) = progress {
                report(
                    "segmenting",
                    0.15 + 0.8 * (pi as f64 + 1.0) / total_colors as f64,
                );
            }
            // Skip near-white background buckets (>40% of opaque pixels)
            let is_near_white = color.r > 245 && color.g > 245 && color.b > 245;
            if is_near_white && color.count as f64 / count_pixels > 0.4 {
                continue;
            }

            let mut mask = vec![false; count];
            for (m, &a) in mask.iter_mut().zip(assignments.iter()) {
                *m = a == pi as i16;
            }
            let paths = trace_mask_to_beziers(
                &mask,
                width,
                height,
                opts,
                cancel,
                Some(RgbColor {
                    r: color.r,
                    g: color.g,
                    b: color.b,
                    a: color.a,
                }),
                &mut omitted_holes,
            );
            all_paths.extend(paths);
            if opts.max_paths > 0 && all_paths.len() >= opts.max_paths {
                break;
            }
        }

        if opts.max_paths > 0 && all_paths.len() > opts.max_paths {
            sort_paths_by_area_desc(&mut all_paths);
            all_paths.truncate(opts.max_paths);
        }

        if let Some(report) = progress {
            report("done", 1.0);
        }
        return TraceBezierResult {
            paths: all_paths,
            omitted_holes,
        };
    }

    // Monochrome path
    let mask = binarize_rgba(pixels, width, height, opts);
    if is_cancelled_flag(cancel) {
        return TraceBezierResult {
            paths: Vec::new(),
            omitted_holes: 0,
        };
    }

    if let Some(report) = progress {
        report("tracing", 0.5);
    }
    let mut omitted_holes = 0usize;
    let result =
        trace_mask_to_beziers(&mask, width, height, opts, cancel, None, &mut omitted_holes);
    if is_cancelled_flag(cancel) {
        return TraceBezierResult {
            paths: Vec::new(),
            omitted_holes: 0,
        };
    }

    if let Some(report) = progress {
        report("done", 1.0);
    }
    TraceBezierResult {
        paths: result,
        omitted_holes,
    }
}

fn is_cancelled_flag(cancel: Option<&TraceCancellation>) -> bool {
    cancel.is_some_and(is_cancelled)
}

pub(crate) fn sort_paths_by_area_desc(paths: &mut [BezierPath]) {
    paths.sort_by(|a, b| {
        let area_a: f64 = a.points.iter().map(|p| p.x * p.y).sum();
        let area_b: f64 = b.points.iter().map(|p| p.x * p.y).sum();
        area_b
            .partial_cmp(&area_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }

    #[test]
    fn trace_simple_square() {
        // 10x10 bitmap with a 4x4 white square in the center
        let mut pixels = vec![0u8; 100]; // 10x10 black
        for y in 3..7 {
            for x in 3..7 {
                pixels[y * 10 + x] = 255;
            }
        }
        let paths = trace_contours(&pixels, 10, 10, &TraceOptions::default());
        assert!(!paths.is_empty(), "should find at least one contour");
        assert!(paths[0].points.len() >= 4, "square should have >=4 points");
    }

    #[test]
    fn trace_empty_bitmap() {
        // All-white with dark foreground means no foreground to trace.
        let pixels = vec![255u8; 100];
        let paths = trace_contours(&pixels, 10, 10, &TraceOptions::default());
        assert!(paths.is_empty());
    }

    #[test]
    fn trace_full_bitmap() {
        // All-black with dark foreground means the whole image is foreground;
        // the boundary should be traced.
        let pixels = vec![0u8; 100];
        let paths = trace_contours(&pixels, 10, 10, &TraceOptions::default());
        assert!(!paths.is_empty());
    }

    #[test]
    fn trace_options_default() {
        let opts = TraceOptions::default();
        assert_eq!(opts.threshold, 128);
        assert_eq!(opts.min_pixels, 10);
        assert_eq!(opts.simplify_tolerance, 0.75);
    }

    #[test]
    fn simplify_path_short_path() {
        let pts = vec![Point::new(0.0, 0.0), Point::new(10.0, 10.0)];
        let simplified = simplify_path(&pts, 1.0);
        assert_eq!(simplified.len(), 2);
    }

    #[test]
    fn simplify_path_removes_redundant_points() {
        let pts = vec![
            Point::new(0.0, 0.0),
            Point::new(5.0, 0.1), // close to line
            Point::new(10.0, 0.0),
        ];
        let simplified = simplify_path(&pts, 2.0);
        assert_eq!(simplified.len(), 2); // collinear points removed
    }

    #[test]
    fn simplify_path_preserves_sharp_corner() {
        let pts = vec![
            Point::new(0.0, 0.0),
            Point::new(5.0, 5.0), // sharp corner
            Point::new(10.0, 0.0),
        ];
        let simplified = simplify_path(&pts, 0.5);
        assert_eq!(simplified.len(), 3); // sharp corner preserved
    }

    #[test]
    fn simplify_closed_path_removes_redundant_ring_points_without_opening_the_loop() {
        let ring = vec![
            Point::new(0.0, 0.0),
            Point::new(5.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 5.0),
            Point::new(10.0, 10.0),
            Point::new(5.0, 10.0),
            Point::new(0.0, 10.0),
            Point::new(0.0, 5.0),
        ];
        let simplified = simplify_closed_path(&ring, 0.5);
        assert_eq!(simplified.len(), 4);
        assert_eq!(simplified[0], Point::new(0.0, 0.0));
        assert_eq!(simplified, simplify_closed_path(&ring, 0.5));
    }

    /// Build an RGBA donut: opaque dark ring with a transparent center hole.
    fn donut_rgba(width: u32, height: u32, r0: u32, r1: u32, cx: u32, cy: u32) -> Vec<u8> {
        let mut buf = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let dx = x as i64 - cx as i64;
                let dy = y as i64 - cy as i64;
                let dist = ((dx * dx + dy * dy) as f64).sqrt();
                if dist >= r0 as f64 && dist <= r1 as f64 {
                    let i = ((y * width + x) * 4) as usize;
                    buf[i..i + 4].copy_from_slice(&[30, 30, 30, 255]);
                }
            }
        }
        buf
    }

    #[test]
    fn cancellable_trace_returns_empty_when_pre_cancelled() {
        let pixels = donut_rgba(32, 32, 4, 14, 16, 16);
        let cancel = new_cancellation();
        cancel.store(true, Ordering::SeqCst);
        let result = trace_to_beziers_cancellable(
            &pixels,
            32,
            32,
            &TraceOptions::default(),
            Some(&cancel),
            None,
        );
        assert!(result.paths.is_empty());
    }

    #[test]
    fn cancellable_trace_matches_non_cancellable_when_not_aborted() {
        let pixels = donut_rgba(32, 32, 4, 14, 16, 16);
        let cancel = new_cancellation();
        let a = trace_to_beziers_cancellable(
            &pixels,
            32,
            32,
            &TraceOptions::default(),
            Some(&cancel),
            None,
        );
        let b = trace_to_beziers(&pixels, 32, 32, &TraceOptions::default());
        assert_eq!(a.paths.len(), b.len());
    }

    #[test]
    fn color_mode_attaches_holes() {
        // Two-color donut: dark ring + a second solid blob, max_colors=2.
        let mut pixels = donut_rgba(32, 32, 4, 14, 16, 16);
        // Solid red square elsewhere (opaque).
        for y in 2..8u32 {
            for x in 2..8u32 {
                let i = ((y * 32 + x) * 4) as usize;
                pixels[i..i + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let opts = TraceOptions {
            max_colors: 3,
            compound_holes: true,
            min_pixels: 4,
            ..Default::default()
        };
        let result = trace_to_beziers_cancellable(&pixels, 32, 32, &opts, None, None);
        // The dark ring must keep its hole ring attached instead of dropping it.
        let ring = result
            .paths
            .iter()
            .find(|p| p.fill.is_some_and(|f| f.r < 100))
            .expect("dark ring path exists");
        assert_eq!(ring.holes.len(), 1, "dark ring keeps its center hole");
        assert!(ring.closed);
    }

    #[test]
    fn monochrome_compound_hole_preserved() {
        let pixels = donut_rgba(32, 32, 4, 14, 16, 16);
        let opts = TraceOptions {
            compound_holes: true,
            min_pixels: 4,
            ..Default::default()
        };
        let result = trace_to_beziers_cancellable(&pixels, 32, 32, &opts, None, None);
        assert_eq!(result.omitted_holes, 0);
        let ring = result
            .paths
            .iter()
            .find(|p| !p.holes.is_empty())
            .expect("compound path with a hole exists");
        assert_eq!(ring.holes.len(), 1);
        assert!(
            ring.points
                .iter()
                .chain(ring.holes.iter().flatten())
                .any(|point| point.handle_in.is_some() || point.handle_out.is_some()),
            "compound contours must retain the cubic fitting result rather than\
             reverting to raw pixel-boundary anchors"
        );
    }

    #[test]
    fn higher_simplify_tolerance_never_increases_native_anchor_count() {
        let pixels = donut_rgba(64, 64, 9, 28, 32, 32);
        let exact = TraceOptions {
            compound_holes: true,
            min_pixels: 4,
            simplify_tolerance: 0.0,
            ..Default::default()
        };
        let simplified = TraceOptions {
            simplify_tolerance: 2.0,
            ..exact.clone()
        };
        let count_anchors = |result: &TraceBezierResult| {
            result
                .paths
                .iter()
                .map(|path| path.points.len() + path.holes.iter().map(Vec::len).sum::<usize>())
                .sum::<usize>()
        };
        let baseline = trace_to_beziers_cancellable(&pixels, 64, 64, &exact, None, None);
        let reduced = trace_to_beziers_cancellable(&pixels, 64, 64, &simplified, None, None);
        assert!(!baseline.paths.is_empty());
        assert!(
            count_anchors(&reduced) <= count_anchors(&baseline),
            "higher source-pixel simplification tolerance must not add anchors"
        );
        assert_eq!(
            reduced,
            trace_to_beziers_cancellable(&pixels, 64, 64, &simplified, None, None),
            "a fixed source/settings tuple must be deterministic"
        );
    }

    #[test]
    fn pixel_art_routes_through_trace_to_beziers() {
        let mut pixels = vec![0u8; 16 * 16 * 4];
        for y in 2..6u32 {
            for x in 2..6u32 {
                let i = ((y * 16 + x) * 4) as usize;
                pixels[i..i + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let opts = TraceOptions {
            trace_mode: TraceMode::PixelArt,
            max_colors: 8,
            min_pixels: 1,
            compound_holes: true,
            ..Default::default()
        };
        let result = trace_to_beziers(&pixels, 16, 16, &opts);
        assert_eq!(result.len(), 1);
        assert!(result[0].closed);
        assert_eq!(result[0].points.len(), 4, "square collapses to 4 corners");
        assert!(result[0].points.iter().all(|p| p.handle_in.is_none()));
        assert_eq!(
            result[0].fill,
            Some(RgbColor {
                r: 255,
                g: 0,
                b: 0,
                a: 255
            })
        );
    }

    #[test]
    fn progress_reports_ordered_stages() {
        let pixels = donut_rgba(24, 24, 3, 10, 12, 12);
        let stages: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
        let cancel = new_cancellation();
        let result = trace_to_beziers_cancellable(
            &pixels,
            24,
            24,
            &TraceOptions {
                max_colors: 2,
                min_pixels: 4,
                compound_holes: true,
                ..Default::default()
            },
            Some(&cancel),
            Some(&|stage, _frac| {
                stages.lock().unwrap().push(stage.to_string());
            }),
        );
        assert!(!result.paths.is_empty());
        let stages = stages.lock().unwrap().clone();
        assert_eq!(stages[0], "quantizing");
        assert!(stages.iter().any(|s| s == "segmenting"));
        assert_eq!(stages.last().map(String::as_str), Some("done"));
    }

    #[test]
    fn bezier_path_holes_serde_default_backwards_compat() {
        // Payload written before the holes field existed must still decode.
        let legacy = r#"{"points":[],"closed":true,"fill":null}"#;
        let path: BezierPath = serde_json::from_str(legacy).expect("legacy payload decodes");
        assert!(path.holes.is_empty());
        // And the field round-trips.
        let with_holes = BezierPath {
            points: vec![BezierPoint {
                x: 0.0,
                y: 0.0,
                handle_in: None,
                handle_out: None,
            }],
            closed: true,
            fill: None,
            holes: vec![vec![BezierPoint {
                x: 5.0,
                y: 5.0,
                handle_in: None,
                handle_out: None,
            }]],
        };
        let json = serde_json::to_string(&with_holes).unwrap();
        let decoded: BezierPath = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, with_holes);
    }
}
