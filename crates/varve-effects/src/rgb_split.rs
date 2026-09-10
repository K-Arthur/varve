//! RGB Split / chromatic aberration kernel — faithful port of
//! `packages/engine/src/liveEffects/rgbSplit.ts`.
//!
//! Modes: `offset` (independent per-channel displacement in doc px) and
//! `radial` (channels separate with distance from an optical centre). Border
//! modes: transparent / clamp / mirror / wrap. Sampling runs on a
//! premultiplied copy so displaced channels never produce dark or white halos
//! at semi-transparent edges; the result is unpremultiplied before return.
//!
//! Offsets are expressed in document pixels and scaled by the caller-provided
//! coordSpace, so a 4px split stays a 4px split at any zoom.

use crate::{clamp01, clamp_byte, CoordSpace, Params};

const PI: f64 = std::f64::consts::PI;

/// JS `Math.hypot(x, y)` for the finite range — V8 computes
/// `sqrt(max^2 + min^2)` (with overflow/underflow scaling branches that never
/// trigger for kernel inputs); Rust's `f64::hypot` uses a different libm
/// algorithm that can differ in the last ulp.
fn js_hypot(x: f64, y: f64) -> f64 {
    if !x.is_finite() || !y.is_finite() {
        if x.is_infinite() || y.is_infinite() {
            return f64::INFINITY;
        }
        return f64::NAN;
    }
    let ax = x.abs();
    let ay = y.abs();
    if ax == 0.0 && ay == 0.0 {
        return 0.0;
    }
    let max = ax.max(ay);
    let min = ax.min(ay);
    const K_SQRT_MAX: f64 = 1.3407807929942596e154;
    const K_SQRT_MIN: f64 = 1.4916681462400413e-154;
    if max > K_SQRT_MAX {
        let s = K_SQRT_MAX / max;
        let (max2, min2) = (max * s, min * s);
        return (max2 * max2 + min2 * min2).sqrt() / s;
    }
    if max < K_SQRT_MIN {
        let s = K_SQRT_MIN / max;
        let (max2, min2) = (max * s, min * s);
        return (max2 * max2 + min2 * min2).sqrt() / s;
    }
    (max * max + min * min).sqrt()
}

/// Apply RGB split in place — port of `applyRgbSplit`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params, coord: CoordSpace) {
    if w == 0 || h == 0 {
        return;
    }
    let scale = if coord.scale > 0.0 { coord.scale } else { 1.0 };
    let intensity = clamp01(p.f("intensity", 1.0));
    if intensity <= 0.0 {
        return;
    }

    let mut src = out.to_vec();
    premultiply(&mut src);

    let mode = p.s("mode", "offset");
    let border = p.s("borderMode", "transparent");

    if mode == "offset" {
        let red_x = p.f("redX", 0.0) * scale * intensity;
        let red_y = p.f("redY", 0.0) * scale * intensity;
        let green_x = p.f("greenX", 0.0) * scale * intensity;
        let green_y = p.f("greenY", 0.0) * scale * intensity;
        let blue_x = p.f("blueX", 0.0) * scale * intensity;
        let blue_y = p.f("blueY", 0.0) * scale * intensity;
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                out[o] = interpolate(&src, w, h, x, y, 0, red_x, red_y, border);
                out[o + 1] = interpolate(&src, w, h, x, y, 1, green_x, green_y, border);
                out[o + 2] = interpolate(&src, w, h, x, y, 2, blue_x, blue_y, border);
            }
        }
    } else {
        let amount = p.f("amount", 4.0) * scale * intensity;
        let falloff = f64::max(0.0, p.f("falloff", 1.0));
        let angle = p.f("fringeAngle", 0.0) * PI / 180.0;
        let cx = p.f("centerX", 0.5) * w as f64;
        let cy = p.f("centerY", 0.5) * h as f64;
        let max_r = f64::max(
            1.0,
            js_hypot(f64::max(cx, w as f64 - cx), f64::max(cy, h as f64 - cy)),
        );
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                let r = js_hypot(x as f64 - cx, y as f64 - cy) / max_r;
                let t = r.powf(falloff) * amount;
                let dx = t * angle.cos();
                let dy = t * angle.sin();
                out[o] = interpolate(&src, w, h, x, y, 0, dx, dy, border);
                out[o + 1] = interpolate(&src, w, h, x, y, 1, 0.0, 0.0, border);
                out[o + 2] = interpolate(&src, w, h, x, y, 2, -dx, -dy, border);
            }
        }
    }

    unpremultiply(out);
}

/// Bilinear sample of channel `c` at `(x + dx, y + dy)` with border policy —
/// port of `interpolate` (keeps the TS signature shape).
#[allow(clippy::too_many_arguments)]
fn interpolate(
    src: &[u8],
    w: u32,
    h: u32,
    x: u32,
    y: u32,
    c: usize,
    dx: f64,
    dy: f64,
    border: &str,
) -> u8 {
    let sx = x as f64 + dx;
    let sy = y as f64 + dy;
    let x0 = sx.floor();
    let y0 = sy.floor();
    let fx = sx - x0;
    let fy = sy - y0;
    let a = sample_clamped(src, w, h, x0 as i64, y0 as i64, c, border) as f64;
    let b = sample_clamped(src, w, h, x0 as i64 + 1, y0 as i64, c, border) as f64;
    let d = sample_clamped(src, w, h, x0 as i64, y0 as i64 + 1, c, border) as f64;
    let e = sample_clamped(src, w, h, x0 as i64 + 1, y0 as i64 + 1, c, border) as f64;
    clamp_byte(a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy)
}

/// Border-policy sample of channel `c` at integer `(x, y)` — port of
/// `sampleClamped`.
fn sample_clamped(src: &[u8], w: u32, h: u32, x: i64, y: i64, c: usize, border: &str) -> u8 {
    let mut ix = x;
    let mut iy = y;
    if ix < 0 || ix >= w as i64 || iy < 0 || iy >= h as i64 {
        match border {
            "transparent" => return 0,
            "clamp" => {
                ix = ix.max(0).min(w as i64 - 1);
                iy = iy.max(0).min(h as i64 - 1);
            }
            "wrap" => {
                ix = ix.rem_euclid(w as i64);
                iy = iy.rem_euclid(h as i64);
            }
            "mirror" => {
                let period = 2 * w as i64;
                ix = ix.rem_euclid(period);
                if ix >= w as i64 {
                    ix = period - ix - 1;
                }
                let period_y = 2 * h as i64;
                iy = iy.rem_euclid(period_y);
                if iy >= h as i64 {
                    iy = period_y - iy - 1;
                }
            }
            _ => return 0,
        }
    }
    src[((iy * w as i64 + ix) * 4 + c as i64) as usize]
}

/// Port of `premultiply` — multiplies RGB by alpha on the working copy.
fn premultiply(data: &mut [u8]) {
    for i in (0..data.len()).step_by(4) {
        let a = data[i + 3];
        if a == 255 {
            continue;
        }
        if a == 0 {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            continue;
        }
        data[i] = clamp_byte((data[i] as f64 * a as f64) / 255.0);
        data[i + 1] = clamp_byte((data[i + 1] as f64 * a as f64) / 255.0);
        data[i + 2] = clamp_byte((data[i + 2] as f64 * a as f64) / 255.0);
    }
}

/// Port of `unpremultiply` — divides RGB by alpha, clamping to bytes.
fn unpremultiply(data: &mut [u8]) {
    for i in (0..data.len()).step_by(4) {
        let a = data[i + 3];
        if a == 0 || a == 255 {
            continue;
        }
        let inv = 255.0 / a as f64;
        data[i] = clamp_byte(data[i] as f64 * inv);
        data[i + 1] = clamp_byte(data[i + 1] as f64 * inv);
        data[i + 2] = clamp_byte(data[i + 2] as f64 * inv);
    }
}
