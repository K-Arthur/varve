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

pub mod chunked;

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

/// Options for raster-to-vector tracing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceOptions {
    /// Grayscale threshold (0-255) for binarization.
    pub threshold: u8,
    /// Minimum contour pixel count to include (filters noise).
    pub min_pixels: usize,
    /// Maximum number of colors for color quantization (0 = grayscale).
    pub max_colors: u8,
    /// Which luminance direction is treated as foreground. Matches the JS
    /// rasterTrace.ts default of dark foreground.
    pub foreground: Foreground,
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
            max_colors: 8,
            foreground: Foreground::default(),
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
