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
pub mod hierarchy;
pub mod quantize;

#[cfg(feature = "rayon")]
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use strata_core::Point;

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
}

/// RGB color with alpha.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

/// Trace mode: silhouette (filled contours) or centerline (stroked skeletons).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceMode {
    Silhouette,
    Centerline,
}

impl Default for TraceMode {
    fn default() -> Self {
        Self::Silhouette
    }
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
    /// Maximum Bezier fitting error in pixels (0.1-10).
    #[serde(default = "default_max_error")]
    pub max_error: f64,
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

fn default_corner_angle() -> f64 { 135.0 }
fn default_max_error() -> f64 { 1.0 }
fn default_alpha_threshold() -> u8 { 1 }
fn default_centerline_width() -> f64 { 2.0 }
fn default_centerline_prune() -> f64 { 4.0 }
fn default_max_paths() -> usize { 1000 }
fn default_compound_holes() -> bool { true }

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
    if pixels.len() as u32 != width * height {
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
            .map(|chunk| trace_chunk(chunk, &binary, width, height, opts.min_pixels))
            .collect()
    };

    #[cfg(not(feature = "rayon"))]
    let path_groups: Vec<Vec<Path>> =
        { vec![trace_chunk(&seeds, &binary, width, height, opts.min_pixels)] };

    path_groups.into_iter().flatten().collect()
}

fn trace_chunk(
    seeds: &[(u32, u32)],
    binary: &[bool],
    width: u32,
    height: u32,
    min_pixels: usize,
) -> Vec<Path> {
    let mut traced = Vec::new();
    let mut visited = vec![false; (width * height) as usize];
    for &(sx, sy) in seeds {
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
    let count = (width * height) as usize;
    let mut mask = vec![false; count];
    for i in 0..count {
        let offset = i * 4;
        let alpha = pixels[offset + 3];
        if alpha < opts.alpha_threshold {
            continue;
        }
        let r = pixels[offset];
        let g = pixels[offset + 1];
        let b = pixels[offset + 2];
        let luma = luminance(r, g, b);
        mask[i] = is_foreground(luma, opts.threshold, opts.foreground);
    }
    mask
}

/// Convert a bool mask to grayscale pixels for contour tracing.
fn mask_to_grayscale(mask: &[bool]) -> Vec<u8> {
    mask.iter().map(|&b| if b { 255 } else { 0 }).collect()
}

/// Trace a single binary mask to Bezier paths.
/// Uses Light foreground with threshold=128 so any mask=true pixel appears as
/// luma=255 and is treated as foreground regardless of the original color.
fn trace_mask_to_beziers(
    mask: &[bool],
    width: u32,
    height: u32,
    opts: &TraceOptions,
    fill_color: Option<RgbColor>,
) -> Vec<BezierPath> {
    let gray = mask_to_grayscale(mask);
    let binary = binarize(&gray, 128, Foreground::Light);
    let seeds = find_seeds(&binary, width, height);
    let mut traced = Vec::new();
    let mut visited = vec![false; (width * height) as usize];
    for &(sx, sy) in &seeds {
        if visited[(sy * width + sx) as usize] {
            continue;
        }
        let pts = trace_one(&binary, width, height, sx, sy, &mut visited, opts.min_pixels);
        if !pts.is_empty() {
            traced.push(Path { points: pts, closed: true });
        }
    }
    let mut result: Vec<BezierPath> = traced
        .into_iter()
        .map(|p| {
            let contour: Vec<(f64, f64)> = p.points.iter().map(|pt| (pt.x, pt.y)).collect();
            let points = bezier_fit::fit_bezier_to_contour(
                &contour,
                p.closed,
                opts.corner_angle,
                opts.max_error,
            );
            BezierPath {
                points,
                closed: p.closed,
                fill: fill_color,
            }
        })
        .collect();

    // Apply hole pairing if enabled
    if opts.compound_holes && result.len() >= 2 {
        let mut outers: Vec<Vec<Point>> = Vec::new();
        let mut hole_contours: Vec<Vec<Point>> = Vec::new();
        for bp in &result {
            let pts: Vec<Point> = bp.points.iter().map(|p| Point::new(p.x, p.y)).collect();
            let area = polygon_area_internal(&pts);
            if area >= 0.0 {
                outers.push(pts);
            } else {
                hole_contours.push(pts);
            }
        }
        let (compounds, _omitted) = hierarchy::pair_holes(&outers, &hole_contours);
        let color = fill_color;
        result = compounds
            .into_iter()
            .map(|c| {
                let points: Vec<BezierPoint> = c
                    .outer
                    .iter()
                    .map(|pt| BezierPoint {
                        x: pt.x,
                        y: pt.y,
                        handle_in: None,
                        handle_out: None,
                    })
                    .collect();
                BezierPath {
                    points,
                    closed: true,
                    fill: color,
                }
            })
            .collect();
    }

    // Apply max_paths limit
    if opts.max_paths > 0 && result.len() > opts.max_paths {
        result.sort_by(|a, b| {
            let area_a: f64 = a.points.iter().map(|p| p.x * p.y).sum();
            let area_b: f64 = b.points.iter().map(|p| p.x * p.y).sum();
            area_b.partial_cmp(&area_a).unwrap_or(std::cmp::Ordering::Equal)
        });
        result.truncate(opts.max_paths);
    }

    result
}

fn polygon_area_internal(points: &[Point]) -> f64 {
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
/// skeleton extraction instead of contour tracing.
pub fn trace_to_beziers(pixels: &[u8], width: u32, height: u32, opts: &TraceOptions) -> Vec<BezierPath> {
    // Centerline mode
    if opts.trace_mode == TraceMode::Centerline {
        let mask = binarize_rgba(pixels, width, height, opts);
        let skeleton = centerline::thin_image(&mask, width, height);
        let branches = centerline::extract_skeleton(&skeleton, width, height, opts.centerline_prune);
        return branches
            .into_iter()
            .map(|branch| {
                let contour: Vec<(f64, f64)> = branch.iter().map(|p| (p.0, p.1)).collect();
                let points = bezier_fit::fit_bezier_to_contour(
                    &contour,
                    false,
                    opts.corner_angle,
                    opts.max_error,
                );
                BezierPath {
                    points,
                    closed: false,
                    fill: None,
                }
            })
            .collect();
    }

    // Silhouette mode
    // Color quantization path
    if opts.max_colors > 0 {
        let palette = quantize::quantize_palette(
            pixels, width, height, opts.max_colors, opts.alpha_threshold, false,
        );
        if palette.is_empty() {
            return Vec::new();
        }

        let count = (width * height) as usize;
        let mut assignments = vec![-1i16; count];
        for i in 0..count {
            let offset = i * 4;
            let alpha = pixels[offset + 3];
            if alpha < opts.alpha_threshold {
                continue;
            }
            let r = pixels[offset];
            let g = pixels[offset + 1];
            let b = pixels[offset + 2];
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
        let count_pixels = count as f64;
        for (pi, color) in palette.iter().enumerate() {
            // Skip near-white background buckets (>40% of opaque pixels)
            let is_near_white = color.r > 245 && color.g > 245 && color.b > 245;
            if is_near_white && color.count as f64 / count_pixels > 0.4 {
                continue;
            }

            let mut mask = vec![false; count];
            for i in 0..count {
                mask[i] = assignments[i] == pi as i16;
            }
            let paths = trace_mask_to_beziers(
                &mask,
                width,
                height,
                opts,
                Some(RgbColor { r: color.r, g: color.g, b: color.b, a: color.a }),
            );
            all_paths.extend(paths);
            if opts.max_paths > 0 && all_paths.len() >= opts.max_paths {
                break;
            }
        }

        if opts.max_paths > 0 && all_paths.len() > opts.max_paths {
            all_paths.sort_by(|a, b| {
                let area_a: f64 = a.points.iter().map(|p| p.x * p.y).sum();
                let area_b: f64 = b.points.iter().map(|p| p.x * p.y).sum();
                area_b.partial_cmp(&area_a).unwrap_or(std::cmp::Ordering::Equal)
            });
            all_paths.truncate(opts.max_paths);
        }

        return all_paths;
    }

    // Monochrome path
    // Convert RGBA to grayscale
    let count = (width * height) as usize;
    let mut gray = Vec::with_capacity(count);
    for chunk in pixels.chunks_exact(4) {
        let a = chunk[3];
        if a < opts.alpha_threshold {
            gray.push(if opts.foreground == Foreground::Light { 0 } else { 255 });
        } else {
            let luma = luminance(chunk[0], chunk[1], chunk[2]);
            gray.push(luma);
        }
    }

    let paths = trace_contours(&gray, width, height, opts);
    let mut result: Vec<BezierPath> = paths
        .into_iter()
        .map(|p| {
            let contour: Vec<(f64, f64)> = p.points.iter().map(|pt| (pt.x, pt.y)).collect();
            let points = bezier_fit::fit_bezier_to_contour(
                &contour,
                p.closed,
                opts.corner_angle,
                opts.max_error,
            );
            BezierPath {
                points,
                closed: p.closed,
                fill: None,
            }
        })
        .collect();

    // Apply hole pairing for monochrome
    if opts.compound_holes && result.len() >= 2 {
        let mut outers: Vec<Vec<Point>> = Vec::new();
        let mut hole_contours: Vec<Vec<Point>> = Vec::new();
        for bp in &result {
            let pts: Vec<Point> = bp.points.iter().map(|p| Point::new(p.x, p.y)).collect();
            let area = polygon_area_internal(&pts);
            if area >= 0.0 {
                outers.push(pts);
            } else {
                hole_contours.push(pts);
            }
        }
        let (compounds, _omitted) = hierarchy::pair_holes(&outers, &hole_contours);
        result = compounds
            .into_iter()
            .map(|c| {
                let points: Vec<BezierPoint> = c
                    .outer
                    .iter()
                    .map(|pt| BezierPoint {
                        x: pt.x,
                        y: pt.y,
                        handle_in: None,
                        handle_out: None,
                    })
                    .collect();
                BezierPath {
                    points,
                    closed: true,
                    fill: None,
                }
            })
            .collect();
    }

    if opts.max_paths > 0 && result.len() > opts.max_paths {
        result.sort_by(|a, b| {
            let area_a: f64 = a.points.iter().map(|p| p.x * p.y).sum();
            let area_b: f64 = b.points.iter().map(|p| p.x * p.y).sum();
            area_b.partial_cmp(&area_a).unwrap_or(std::cmp::Ordering::Equal)
        });
        result.truncate(opts.max_paths);
    }

    result
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
}
