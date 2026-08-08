//! Shared quantization core for the Dither and Palette Snap kernels —
//! faithful port of `packages/engine/src/liveEffects/paletteCore.ts`.

use crate::prng::{seeded01, srgb_to_linear01};
use serde::{Deserialize, Serialize};

pub type PaletteColor = [u8; 3];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColorMetric {
    Rgb,
    LinearRgb,
    Lab,
    Oklab,
}

impl ColorMetric {
    pub fn parse(s: &str) -> ColorMetric {
        match s {
            "linear-rgb" => ColorMetric::LinearRgb,
            "lab" => ColorMetric::Lab,
            "oklab" => ColorMetric::Oklab,
            _ => ColorMetric::Rgb,
        }
    }
}

const LUT_GRID: usize = 32;
const LUT_THRESHOLD: usize = 24;

/// Linear sRGB [r,g,b] (0-1) → Oklab [L, a, b] — port of
/// `linearSrgbToOklab` from @varve/shared colorConversion.ts.
pub fn linear_srgb_to_oklab(rgb: [f64; 3]) -> [f64; 3] {
    const M1: [[f64; 3]; 3] = [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ];
    const M2: [[f64; 3]; 3] = [
        [0.2104542553, 0.793617785, -0.0040720468],
        [1.9779984951, -2.428592205, 0.4505937099],
        [0.0259040371, 0.7827717662, -0.808675766],
    ];
    let mut lms = [0.0f64; 3];
    for row in 0..3 {
        lms[row] = M1[row][0] * rgb[0] + M1[row][1] * rgb[1] + M1[row][2] * rgb[2];
    }
    let lms_cb: [f64; 3] = [lms[0].cbrt(), lms[1].cbrt(), lms[2].cbrt()];
    let mut out = [0.0f64; 3];
    for row in 0..3 {
        out[row] = M2[row][0] * lms_cb[0] + M2[row][1] * lms_cb[1] + M2[row][2] * lms_cb[2];
    }
    out
}

fn to_lab_space(r: f64, g: f64, b: f64, metric: ColorMetric) -> [f64; 3] {
    if metric == ColorMetric::Oklab {
        return linear_srgb_to_oklab([srgb_to_linear01(r), srgb_to_linear01(g), srgb_to_linear01(b)]);
    }
    // Lab via XYZ D65 (matches @varve/shared analytical conversion path).
    let rl = srgb_to_linear01(r);
    let gl = srgb_to_linear01(g);
    let bl = srgb_to_linear01(b);
    let mut x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    let mut z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
    x /= 0.95047;
    z /= 1.08883;
    let fx = f_lab(x);
    let fy = f_lab(y);
    let fz = f_lab(z);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn f_lab(t: f64) -> f64 {
    if t > 0.008856 {
        t.cbrt()
    } else {
        7.787 * t + 16.0 / 116.0
    }
}

/// Squared distance between an sRGB byte colour and a palette colour —
/// port of `paletteDistance`.
pub fn palette_distance(r: f64, g: f64, b: f64, pr: f64, pg: f64, pb: f64, metric: ColorMetric) -> f64 {
    match metric {
        ColorMetric::Rgb => {
            let dr = r - pr;
            let dg = g - pg;
            let db = b - pb;
            dr * dr + dg * dg + db * db
        }
        ColorMetric::LinearRgb => {
            let lr = srgb_to_linear01(r) - srgb_to_linear01(pr);
            let lg = srgb_to_linear01(g) - srgb_to_linear01(pg);
            let lb = srgb_to_linear01(b) - srgb_to_linear01(pb);
            lr * lr + lg * lg + lb * lb
        }
        ColorMetric::Lab | ColorMetric::Oklab => {
            let [l1, a1, b1] = to_lab_space(r, g, b, metric);
            let [l2, a2, b2] = to_lab_space(pr, pg, pb, metric);
            let dl = l1 - l2;
            let da = a1 - a2;
            let db = b1 - b2;
            dl * dl + da * da + db * db
        }
    }
}

fn nearest_brute(colors: &[PaletteColor], metric: ColorMetric, r: f64, g: f64, b: f64) -> PaletteColor {
    let mut best = colors[0];
    let mut best_d = f64::INFINITY;
    for c in colors {
        let d = palette_distance(r, g, b, c[0] as f64, c[1] as f64, c[2] as f64, metric);
        if d < best_d {
            best_d = d;
            best = *c;
        }
    }
    best
}

fn find_index_of(colors: &[PaletteColor], r: u8, g: u8, b: u8) -> u16 {
    for (i, c) in colors.iter().enumerate() {
        if c[0] == r && c[1] == g && c[2] == b {
            return i as u16;
        }
    }
    0
}

fn grid_index(r: f64, g: f64, b: f64) -> usize {
    let ri = ((r / (256.0 / LUT_GRID as f64)).floor() as usize).min(LUT_GRID - 1);
    let gi = ((g / (256.0 / LUT_GRID as f64)).floor() as usize).min(LUT_GRID - 1);
    let bi = ((b / (256.0 / LUT_GRID as f64)).floor() as usize).min(LUT_GRID - 1);
    (ri * LUT_GRID + gi) * LUT_GRID + bi
}

/// Nearest-palette lookup with uniform-grid LUT acceleration for large
/// palettes — port of `buildPaletteLookup`. The LUT is built once per call
/// (the TS WeakMap cache keyed on array identity is not portable; callers
/// that reuse a palette should hold the returned struct).
pub struct PaletteLookup {
    colors: Vec<PaletteColor>,
    metric: ColorMetric,
    lut: Option<Vec<u16>>,
}

impl PaletteLookup {
    pub fn build(colors: &[PaletteColor], metric: ColorMetric) -> PaletteLookup {
        if colors.is_empty() {
            return PaletteLookup { colors: vec![], metric, lut: None };
        }
        if colors.len() < LUT_THRESHOLD {
            return PaletteLookup { colors: colors.to_vec(), metric, lut: None };
        }
        let mut lut = vec![0u16; LUT_GRID * LUT_GRID * LUT_GRID];
        let step = 256.0 / LUT_GRID as f64;
        for ri in 0..LUT_GRID {
            for gi in 0..LUT_GRID {
                for bi in 0..LUT_GRID {
                    let r = (ri as f64 * step + step / 2.0).round();
                    let g = (gi as f64 * step + step / 2.0).round();
                    let b = (bi as f64 * step + step / 2.0).round();
                    let idx = (ri * LUT_GRID + gi) * LUT_GRID + bi;
                    let [pr, pg, pb] = nearest_brute(colors, metric, r, g, b);
                    lut[idx] = find_index_of(colors, pr, pg, pb);
                }
            }
        }
        PaletteLookup { colors: colors.to_vec(), metric, lut: Some(lut) }
    }

    /// Nearest palette color for an sRGB byte triple.
    pub fn find(&self, r: u8, g: u8, b: u8) -> PaletteColor {
        if self.colors.is_empty() {
            return [0, 0, 0];
        }
        match &self.lut {
            Some(lut) => {
                let idx = grid_index(r as f64, g as f64, b as f64);
                self.colors[lut[idx] as usize]
            }
            None => nearest_brute(&self.colors, self.metric, r as f64, g as f64, b as f64),
        }
    }
}

// ── Palette generation ─────────────────────────────────────────────────────

#[derive(Clone)]
struct Box {
    pixels: Vec<PaletteColor>,
    r_min: u8,
    r_max: u8,
    g_min: u8,
    g_max: u8,
    b_min: u8,
    b_max: u8,
}

/// Generate a palette via median cut + k-means refinement — port of
/// `generatePalette`.
pub fn generate_palette(
    pixels: &[u8],
    w: u32,
    h: u32,
    color_count: f64,
    metric: ColorMetric,
    seed: u32,
) -> Vec<PaletteColor> {
    let count = (color_count.round()).max(1.0).min(256.0) as usize;
    let sample = sample_pixels(pixels, w, h);
    if sample.is_empty() {
        return vec![[0, 0, 0]];
    }
    let box0 = Box {
        pixels: sample.clone(),
        r_min: 0,
        r_max: 255,
        g_min: 0,
        g_max: 255,
        b_min: 0,
        b_max: 255,
    };
    let leaves = median_cut(box0, count);
    let mut palette: Vec<PaletteColor> = leaves
        .iter()
        .map(|leaf| {
            let mut r = 0u64;
            let mut g = 0u64;
            let mut b = 0u64;
            for [pr, pg, pb] in &leaf.pixels {
                r += *pr as u64;
                g += *pg as u64;
                b += *pb as u64;
            }
            let n = if leaf.pixels.is_empty() { 1 } else { leaf.pixels.len() as u64 };
            [
                (r as f64 / n as f64).round() as u8,
                (g as f64 / n as f64).round() as u8,
                (b as f64 / n as f64).round() as u8,
            ]
        })
        .collect();
    palette = kmeans_refine(palette, &sample, 6, metric, seed);
    palette
}

fn sample_pixels(pixels: &[u8], w: u32, h: u32) -> Vec<PaletteColor> {
    let mut out = Vec::new();
    let step = (((w * h) as f64 / 262144.0).sqrt().round()).max(1.0) as u32;
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let o = ((y * w + x) * 4) as usize;
            if pixels[o + 3] >= 128 {
                out.push([pixels[o], pixels[o + 1], pixels[o + 2]]);
            }
            x += step;
        }
        y += step;
    }
    out
}

fn median_cut(box0: Box, target: usize) -> Vec<Box> {
    let mut boxes = vec![box0];
    while boxes.len() < target {
        let mut largest = -1i64;
        let mut largest_volume = -1i64;
        for (i, b) in boxes.iter().enumerate() {
            let vol = (b.r_max as i64 - b.r_min as i64 + 1)
                * (b.g_max as i64 - b.g_min as i64 + 1)
                * (b.b_max as i64 - b.b_min as i64 + 1);
            if vol > largest_volume {
                largest_volume = vol;
                largest = i as i64;
            }
        }
        if largest < 0 || boxes[largest as usize].pixels.len() < 2 {
            break;
        }
        let split = split_box(boxes[largest as usize].clone());
        let Some((lo, hi)) = split else {
            break;
        };
        let mut next = Vec::with_capacity(boxes.len() + 1);
        next.extend_from_slice(&boxes[..largest as usize]);
        next.push(lo);
        next.push(hi);
        next.extend_from_slice(&boxes[largest as usize + 1..]);
        boxes = next;
    }
    boxes
}

fn split_box(box0: Box) -> Option<(Box, Box)> {
    let r_range = box0.r_max as i32 - box0.r_min as i32;
    let g_range = box0.g_max as i32 - box0.g_min as i32;
    let b_range = box0.b_max as i32 - box0.b_min as i32;
    let channel: u8 = if g_range >= r_range && g_range >= b_range {
        1
    } else if b_range >= r_range && b_range >= g_range {
        2
    } else {
        0
    };
    let mut sorted = box0.pixels.clone();
    sorted.sort_by_key(|c| c[channel as usize]);
    let mid = sorted.len() / 2;
    if mid == 0 {
        return None;
    }
    let lo = sorted[..mid].to_vec();
    let hi = sorted[mid..].to_vec();
    Some((make_box(lo), make_box(hi)))
}

fn make_box(pixels: Vec<PaletteColor>) -> Box {
    let mut r_min = 255u8;
    let mut r_max = 0u8;
    let mut g_min = 255u8;
    let mut g_max = 0u8;
    let mut b_min = 255u8;
    let mut b_max = 0u8;
    for [r, g, b] in &pixels {
        if *r < r_min {
            r_min = *r;
        }
        if *r > r_max {
            r_max = *r;
        }
        if *g < g_min {
            g_min = *g;
        }
        if *g > g_max {
            g_max = *g;
        }
        if *b < b_min {
            b_min = *b;
        }
        if *b > b_max {
            b_max = *b;
        }
    }
    Box { pixels, r_min, r_max, g_min, g_max, b_min, b_max }
}

fn kmeans_refine(
    centroids: Vec<PaletteColor>,
    samples: &[PaletteColor],
    iterations: usize,
    metric: ColorMetric,
    seed: u32,
) -> Vec<PaletteColor> {
    let mut centers = centroids;
    for iter in 0..iterations {
        let mut sums = vec![[0u64; 4]; centers.len()];
        for [r, g, b] in samples {
            let mut best_i = 0usize;
            let mut best_d = f64::INFINITY;
            for (i, c) in centers.iter().enumerate() {
                let d = palette_distance(
                    *r as f64,
                    *g as f64,
                    *b as f64,
                    c[0] as f64,
                    c[1] as f64,
                    c[2] as f64,
                    metric,
                );
                if d < best_d {
                    best_d = d;
                    best_i = i;
                }
            }
            let s = &mut sums[best_i];
            s[0] += *r as u64;
            s[1] += *g as u64;
            s[2] += *b as u64;
            s[3] += 1;
        }
        let next: Vec<PaletteColor> = centers
            .iter()
            .enumerate()
            .map(|(i, _c)| {
                let s = sums[i];
                if s[3] == 0 {
                    let jitter = (seeded01(seed.wrapping_add((iter * 7919) as u32)) * 255.0).round() as u8;
                    [jitter, jitter, jitter]
                } else {
                    [
                        (s[0] as f64 / s[3] as f64).round() as u8,
                        (s[1] as f64 / s[3] as f64).round() as u8,
                        (s[2] as f64 / s[3] as f64).round() as u8,
                    ]
                }
            })
            .collect();
        let changed = next.iter().zip(centers.iter()).any(|(a, b)| a != b);
        centers = next;
        if !changed {
            break;
        }
    }
    centers
}

/// Deduplicate palette colors (exact equality) — port of `dedupePalette`.
pub fn dedupe_palette(colors: &[PaletteColor]) -> Vec<PaletteColor> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for c in colors {
        let key = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | c[2] as u32;
        if seen.insert(key) {
            out.push(*c);
        }
    }
    out
}

/// Validate a palette from user input; drops malformed entries, caps size —
/// port of `sanitizePalette`.
pub fn sanitize_palette(colors: &[[f64; 3]]) -> Vec<PaletteColor> {
    let mut out = Vec::new();
    for c in colors {
        let r = (c[0].max(0.0).min(255.0).round()) as u8;
        let g = (c[1].max(0.0).min(255.0).round()) as u8;
        let b = (c[2].max(0.0).min(255.0).round()) as u8;
        out.push([r, g, b]);
        if out.len() >= 256 {
            break;
        }
    }
    dedupe_palette(&out)
}
