//! Dither kernel — faithful port of `packages/engine/src/liveEffects/dither.ts`.
//!
//! Algorithms: Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke, Stucki, Sierra,
//! Bayer (2/4/8 ordered), and blue-noise. Error diffusion is inherently
//! sequential; it runs in a single row-major pass (serpentine optional).
//!
//! Anchoring: when a `coordSpace` with `scale > 0` is supplied, the ordered
//! pattern phase is anchored to document coordinates so panning/zooming never
//! makes the pattern "swim" relative to layer content. Without it, the
//! pattern anchors to the surface's own pixel grid.
//!
//! Alpha: dithered colour is never applied to pixels whose alpha falls below
//! `alphaCutoff`, and the alpha channel itself is never modified.

use crate::palette_core::{self, ColorMetric, PaletteLookup};
use crate::prng::hash2;
use crate::{clamp01, clamp_byte, js_round, CoordSpace, Params};

/// Document coordinate of a local (region-space) pixel given a CoordSpace —
/// port of `docCoordOf` in dither.ts. Returns `(x, y)`.
pub fn doc_coord_of(x: f64, y: f64, coord_space: CoordSpace) -> (f64, f64) {
    let scale = if coord_space.scale > 0.0 {
        coord_space.scale
    } else {
        1.0
    };
    (
        (coord_space.region_x + x - coord_space.origin_x) / scale,
        (coord_space.region_y + y - coord_space.origin_y) / scale,
    )
}

/// Recursively construct a Bayer threshold matrix — port of
/// `bayerThresholdMatrix` in exportPipeline/dither.ts.
///
/// The TS uses `const n = matrix.length` (the whole array, not the row
/// count), so on the second iteration the source reads are out of bounds:
/// `Uint16Array` yields `undefined`, arithmetic produces `NaN`, and the
/// `Uint16Array` assignment zeroes it. This port reproduces that NaN-to-zero
/// behaviour; a size-4 request therefore yields a 64-entry matrix (8x8).
fn bayer_threshold_matrix(size: f64) -> Vec<u16> {
    let mut matrix = vec![0u16];
    while (matrix.len() as f64) < size * size {
        let n = matrix.len();
        let next_n = n * 2;
        let mut next = vec![0u16; n * n * 4];
        for y in 0..n {
            for x in 0..n {
                let v: f64 = matrix.get(y * n + x).map(|v| *v as f64).unwrap_or(f64::NAN);
                next[y * next_n + x] = (v * 4.0) as u16;
                next[y * next_n + x + n] = (v * 4.0 + 2.0) as u16;
                next[(y + n) * next_n + x] = (v * 4.0 + 3.0) as u16;
                next[(y + n) * next_n + x + n] = (v * 4.0 + 1.0) as u16;
            }
        }
        matrix = next;
    }
    matrix
}

struct KernelEntry {
    dx: i64,
    dy: i64,
    weight: f64,
}

const FLOYD_STEINBERG: &[KernelEntry] = &[
    KernelEntry { dx: 1, dy: 0, weight: 7.0 / 16.0 },
    KernelEntry { dx: -1, dy: 1, weight: 3.0 / 16.0 },
    KernelEntry { dx: 0, dy: 1, weight: 5.0 / 16.0 },
    KernelEntry { dx: 1, dy: 1, weight: 1.0 / 16.0 },
];

const ATKINSON: &[KernelEntry] = &[
    KernelEntry { dx: 1, dy: 0, weight: 1.0 / 8.0 },
    KernelEntry { dx: 2, dy: 0, weight: 1.0 / 8.0 },
    KernelEntry { dx: -1, dy: 1, weight: 1.0 / 8.0 },
    KernelEntry { dx: 0, dy: 1, weight: 1.0 / 8.0 },
    KernelEntry { dx: 1, dy: 1, weight: 1.0 / 8.0 },
    KernelEntry { dx: 0, dy: 2, weight: 1.0 / 8.0 },
];

const JARVIS_JUDICE_NINKE: &[KernelEntry] = &[
    KernelEntry { dx: 1, dy: 0, weight: 7.0 / 48.0 },
    KernelEntry { dx: 2, dy: 0, weight: 5.0 / 48.0 },
    KernelEntry { dx: -2, dy: 1, weight: 3.0 / 48.0 },
    KernelEntry { dx: -1, dy: 1, weight: 5.0 / 48.0 },
    KernelEntry { dx: 0, dy: 1, weight: 7.0 / 48.0 },
    KernelEntry { dx: 1, dy: 1, weight: 5.0 / 48.0 },
    KernelEntry { dx: 2, dy: 1, weight: 3.0 / 48.0 },
    KernelEntry { dx: -2, dy: 2, weight: 1.0 / 48.0 },
    KernelEntry { dx: -1, dy: 2, weight: 3.0 / 48.0 },
    KernelEntry { dx: 0, dy: 2, weight: 5.0 / 48.0 },
    KernelEntry { dx: 1, dy: 2, weight: 3.0 / 48.0 },
    KernelEntry { dx: 2, dy: 2, weight: 1.0 / 48.0 },
];

const STUCKI: &[KernelEntry] = &[
    KernelEntry { dx: 1, dy: 0, weight: 8.0 / 42.0 },
    KernelEntry { dx: 2, dy: 0, weight: 4.0 / 42.0 },
    KernelEntry { dx: -2, dy: 1, weight: 2.0 / 42.0 },
    KernelEntry { dx: -1, dy: 1, weight: 4.0 / 42.0 },
    KernelEntry { dx: 0, dy: 1, weight: 8.0 / 42.0 },
    KernelEntry { dx: 1, dy: 1, weight: 4.0 / 42.0 },
    KernelEntry { dx: 2, dy: 1, weight: 2.0 / 42.0 },
    KernelEntry { dx: -2, dy: 2, weight: 1.0 / 42.0 },
    KernelEntry { dx: -1, dy: 2, weight: 2.0 / 42.0 },
    KernelEntry { dx: 0, dy: 2, weight: 4.0 / 42.0 },
    KernelEntry { dx: 1, dy: 2, weight: 2.0 / 42.0 },
    KernelEntry { dx: 2, dy: 2, weight: 1.0 / 42.0 },
];

struct OrderedState {
    strength: f64,
    alpha_cutoff: f64,
    cell: f64,
    scale: f64,
    seed: u32,
}

/// Apply the dither effect in place — port of `applyDither`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params, coord: CoordSpace) {
    if w == 0 || h == 0 {
        return;
    }

    let algorithm = p.s("algorithm", "floyd-steinberg");
    let strength = clamp01(p.f("strength", 1.0));
    let alpha_cutoff = clamp01(p.f("alphaCutoff", 0.0));
    let serpentine = p.b("serpentine", true);
    let seed = (js_round(p.f("seed", 0.0)) as i64) as u32;

    let coord_valid = coord.scale > 0.0;
    let scale = if coord_valid { coord.scale } else { 1.0 };
    let phase_x = if coord_valid { coord.region_x } else { 0.0 };
    let phase_y = if coord_valid { coord.region_y } else { 0.0 };
    let origin_x = if coord_valid { coord.origin_x } else { 0.0 };
    let origin_y = if coord_valid { coord.origin_y } else { 0.0 };
    let resolved = CoordSpace { scale, origin_x, origin_y, region_x: phase_x, region_y: phase_y };

    if algorithm == "bayer" || algorithm == "blue-noise" {
        let st = OrderedState {
            strength,
            alpha_cutoff,
            cell: f64::max(1.0, p.f("cellSize", 1.0)) * scale,
            scale,
            seed,
        };
        apply_ordered(out, w, h, p, &st, resolved);
        return;
    }

    if strength <= 0.0 {
        return;
    }

    // 'none' palette mode = no quantization = no dithering at all. Error
    // diffusion requires a quantization target to diffuse error towards.
    if p.s("paletteMode", "levels") == "none" {
        return;
    }

    let metric = ColorMetric::parse(p.s("metric", "rgb"));
    let mut lookup: Option<PaletteLookup> = None;
    if p.s("paletteMode", "levels") == "custom" {
        let raw = p.rgb_list("colors");
        let colors_f64: Vec<[f64; 3]> =
            raw.iter().map(|c| [c[0] as f64, c[1] as f64, c[2] as f64]).collect();
        let colors = palette_core::sanitize_palette(&colors_f64);
        if !colors.is_empty() {
            lookup = Some(PaletteLookup::build(&colors, metric));
        }
    }
    let levels = js_round(p.f("levels", 4.0)).clamp(1.0, 8.0) as i64;
    let step = 1.0 / ((1i64 << levels) - 1) as f64;

    let kernel: &[KernelEntry] = match algorithm {
        "atkinson" => ATKINSON,
        "jarvis-judice-ninke" | "sierra" => JARVIS_JUDICE_NINKE,
        "stucki" => STUCKI,
        _ => FLOYD_STEINBERG,
    };

    let len = (w * h) as usize;
    let mut err_r = vec![0.0f32; len];
    let mut err_g = vec![0.0f32; len];
    let mut err_b = vec![0.0f32; len];

    for y in 0..h {
        let ltr = !serpentine || y % 2 == 0;
        for sx in 0..w {
            let x = if ltr { sx } else { w - 1 - sx };
            let o = ((y * w + x) * 4) as usize;
            let a = out[o + 3];
            if (a as f64) / 255.0 < alpha_cutoff || a == 0 {
                continue;
            }
            let eo = (y * w + x) as usize;
            let r = clamp01((out[o] as f64) / 255.0 + (err_r[eo] as f64) * strength);
            let g = clamp01((out[o + 1] as f64) / 255.0 + (err_g[eo] as f64) * strength);
            let b = clamp01((out[o + 2] as f64) / 255.0 + (err_b[eo] as f64) * strength);

            let (qr, qg, qb): (f64, f64, f64) = if let Some(lookup) = &lookup {
                let c = lookup.find(
                    js_round(r * 255.0) as u8,
                    js_round(g * 255.0) as u8,
                    js_round(b * 255.0) as u8,
                );
                (c[0] as f64 / 255.0, c[1] as f64 / 255.0, c[2] as f64 / 255.0)
            } else {
                (js_round(r / step) * step, js_round(g / step) * step, js_round(b / step) * step)
            };
            out[o] = clamp_byte(clamp01(qr) * 255.0);
            out[o + 1] = clamp_byte(clamp01(qg) * 255.0);
            out[o + 2] = clamp_byte(clamp01(qb) * 255.0);

            let er = (r - qr) * strength;
            let eg = (g - qg) * strength;
            let eb = (b - qb) * strength;
            for entry in kernel {
                let nx = if ltr { x as i64 + entry.dx } else { x as i64 - entry.dx };
                let ny = y as i64 + entry.dy;
                if nx < 0 || nx >= w as i64 || ny >= h as i64 {
                    continue;
                }
                let ne = (ny * w as i64 + nx) as usize;
                err_r[ne] = (err_r[ne] as f64 + er * entry.weight) as f32;
                err_g[ne] = (err_g[ne] as f64 + eg * entry.weight) as f32;
                err_b[ne] = (err_b[ne] as f64 + eb * entry.weight) as f32;
            }
        }
    }
}

/// Ordered (Bayer / blue-noise) pattern dither — port of `applyOrdered`.
fn apply_ordered(out: &mut [u8], w: u32, h: u32, p: &Params, st: &OrderedState, coord: CoordSpace) {
    let levels = js_round(p.f("levels", 4.0)).clamp(1.0, 8.0) as i64;
    let step = 1.0 / ((1i64 << levels) - 1) as f64;
    let metric = ColorMetric::parse(p.s("metric", "rgb"));
    let mut lookup: Option<PaletteLookup> = None;
    if p.s("paletteMode", "levels") == "custom" {
        let raw = p.rgb_list("colors");
        let colors_f64: Vec<[f64; 3]> =
            raw.iter().map(|c| [c[0] as f64, c[1] as f64, c[2] as f64]).collect();
        let colors = palette_core::sanitize_palette(&colors_f64);
        if !colors.is_empty() {
            lookup = Some(PaletteLookup::build(&colors, metric));
        }
    }
    let bayer = if p.s("algorithm", "floyd-steinberg") == "bayer" {
        Some(bayer_threshold_matrix(p.f("bayerSize", 4.0).clamp(2.0, 8.0)))
    } else {
        None
    };

    let inv_scale = 1.0 / st.scale;
    let cell_size_doc = st.cell * inv_scale;

    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            let a = out[o + 3];
            if (a as f64) / 255.0 < st.alpha_cutoff || a == 0 {
                continue;
            }
            // Document-anchored phase: the cell index derives from the
            // document coordinate of the pixel.
            let (doc_x, doc_y) = doc_coord_of(x as f64, y as f64, coord);
            let cell_idx_x = (doc_x / cell_size_doc).floor() as i64;
            let cell_idx_y = (doc_y / cell_size_doc).floor() as i64;
            let threshold: f64;
            if let Some(bayer) = &bayer {
                let size = (bayer.len() as f64).sqrt();
                let cix = cell_idx_x as f64 % size;
                let ciy = cell_idx_y as f64 % size;
                let idx = ciy * size + cix;
                // Out-of-range (negative cell index) yields `undefined` in JS,
                // which propagates NaN through the threshold math and zeroes
                // the pixel on Uint8ClampedArray assignment.
                let t = if idx < 0.0 || idx >= bayer.len() as f64 {
                    f64::NAN
                } else {
                    (bayer[idx as usize] as f64 + 0.5) / (size * size)
                };
                threshold = (t - 0.5) * st.strength * step * 1.5;
            } else {
                threshold =
                    (hash2(cell_idx_x as i32, cell_idx_y as i32, st.seed) - 0.5) * st.strength * step;
            }
            let r = clamp01((out[o] as f64) / 255.0 + threshold);
            let g = clamp01((out[o + 1] as f64) / 255.0 + threshold);
            let b = clamp01((out[o + 2] as f64) / 255.0 + threshold);
            if let Some(lookup) = &lookup {
                let c = lookup.find(
                    js_round(r * 255.0) as u8,
                    js_round(g * 255.0) as u8,
                    js_round(b * 255.0) as u8,
                );
                out[o] = c[0];
                out[o + 1] = c[1];
                out[o + 2] = c[2];
            } else {
                out[o] = quantize_byte(r, step);
                out[o + 1] = quantize_byte(g, step);
                out[o + 2] = quantize_byte(b, step);
            }
        }
    }
}

/// `Math.round(clamp01(Math.round(v / step) * step) * 255)` — port of
/// `quantizeByte`.
fn quantize_byte(v: f64, step: f64) -> u8 {
    clamp_byte(clamp01(js_round(v / step) * step) * 255.0)
}
