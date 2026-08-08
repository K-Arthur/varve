//! Render quality tiers and resample helpers — faithful port of
//! `packages/engine/src/liveEffects/quality.ts`.

use crate::js_round;

/// Resolution factor for an effective tier (1 = full res).
pub fn quality_resolution_factor(quality: crate::EffectQuality) -> f64 {
    match quality {
        crate::EffectQuality::Interactive => 0.5,
        crate::EffectQuality::Normal | crate::EffectQuality::Export => 1.0,
    }
}

/// Sample-count multiplier for a tier (relative to normal = 1).
pub fn quality_sample_factor(quality: crate::EffectQuality) -> f64 {
    match quality {
        crate::EffectQuality::Interactive => 0.5,
        crate::EffectQuality::Normal => 1.0,
        crate::EffectQuality::Export => 2.0,
    }
}

/// Box-average downsample by an integer factor (deterministic, no canvas) —
/// port of `downsampleBox`.
pub fn downsample_box(src: &[u8], w: u32, h: u32, factor: u32) -> (Vec<u8>, u32, u32) {
    let f = factor.max(1);
    let dw = (w / f).max(1);
    let dh = (h / f).max(1);
    let mut out = vec![0u8; (dw * dh * 4) as usize];
    for y in 0..dh {
        for x in 0..dw {
            let mut r = 0u64;
            let mut g = 0u64;
            let mut b = 0u64;
            let mut a = 0u64;
            let mut n = 0u64;
            let y0 = y * f;
            let x0 = x * f;
            for sy in y0..(y0 + f).min(h) {
                for sx in x0..(x0 + f).min(w) {
                    let o = ((sy * w + sx) * 4) as usize;
                    r += src[o] as u64;
                    g += src[o + 1] as u64;
                    b += src[o + 2] as u64;
                    a += src[o + 3] as u64;
                    n += 1;
                }
            }
            let o = ((y * dw + x) * 4) as usize;
            out[o] = js_round(r as f64 / n as f64) as u8;
            out[o + 1] = js_round(g as f64 / n as f64) as u8;
            out[o + 2] = js_round(b as f64 / n as f64) as u8;
            out[o + 3] = js_round(a as f64 / n as f64) as u8;
        }
    }
    (out, dw, dh)
}

/// Bilinear-upsample a buffer into a destination sized w×h (deterministic) —
/// port of `upsampleBilinear`.
#[allow(clippy::too_many_arguments)]
pub fn upsample_bilinear(
    src: &[u8],
    sw: u32,
    sh: u32,
    dst: &mut [u8],
    w: u32,
    h: u32,
) {
    let sx_scale = sw as f64 / w as f64;
    let sy_scale = sh as f64 / h as f64;
    for y in 0..h {
        let sy = (((y as f64 + 0.5) * sy_scale - 0.5).max(0.0)).min((sh - 1) as f64);
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(sh - 1);
        let fy = sy - y0 as f64;
        for x in 0..w {
            let sx = (((x as f64 + 0.5) * sx_scale - 0.5).max(0.0)).min((sw - 1) as f64);
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let fx = sx - x0 as f64;
            let o00 = ((y0 * sw + x0) * 4) as usize;
            let o10 = ((y0 * sw + x1) * 4) as usize;
            let o01 = ((y1 * sw + x0) * 4) as usize;
            let o11 = ((y1 * sw + x1) * 4) as usize;
            let do_ = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                let top = src[o00 + c] as f64 + (src[o10 + c] as f64 - src[o00 + c] as f64) * fx;
                let bot = src[o01 + c] as f64 + (src[o11 + c] as f64 - src[o01 + c] as f64) * fx;
                dst[do_ + c] = js_round(top + (bot - top) * fy) as u8;
            }
        }
    }
}
