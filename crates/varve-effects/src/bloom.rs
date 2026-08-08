//! Optical bloom / high-key diffusion kernel — faithful port of
//! `packages/engine/src/liveEffects/bloom.ts`.
//!
//! Pipeline: threshold+soft-knee on linearized luma → bright-pass extraction →
//! box-downsample pyramid → linear-light Gaussian blur per level → bilinear
//! upsample + additive combine → tint → optional anamorphic streak pass.
//! Blur and brightness math run in linear light; final compositing in gamma
//! space, matching the TS kernel exactly.

use crate::blur::gaussian_blur_linear_light;
use crate::prng::srgb_to_linear01;
use crate::quality::{downsample_box, quality_resolution_factor, upsample_bilinear};
use crate::{clamp_byte, clamp01, js_round, CoordSpace, EffectQuality, Params};

fn srgb_back(linear: f64) -> f64 {
    let v = linear.max(0.0).min(1.0);
    let srgb = if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    srgb * 255.0
}

/// Directional smear (streak) in linear light along an angle — port of
/// `streakSmear` in bloom.ts. Mutates `data` in place.
#[allow(clippy::too_many_arguments)]
fn streak_smear(
    data: &mut [u8],
    w: u32,
    h: u32,
    angle_deg: f64,
    length_px: f64,
    intensity: f64,
    aspect: f64,
    lin_lut: &[f64; 256],
) {
    if length_px < 1.0 {
        return;
    }
    let angle = (angle_deg * std::f64::consts::PI) / 180.0;
    let dx = angle.cos();
    let dy = angle.sin();
    let n = (w * h) as usize;
    let mut linear = vec![0.0f64; n * 3];
    for i in 0..n {
        let o = i * 4;
        linear[i * 3] = lin_lut[data[o] as usize];
        linear[i * 3 + 1] = lin_lut[data[o + 1] as usize];
        linear[i * 3 + 2] = lin_lut[data[o + 2] as usize];
    }
    let mut out = vec![0.0f64; n * 3];
    let steps = js_round(length_px / 3.0).max(3.0).min(32.0) as i64;
    let step_px = length_px / steps as f64;
    for y in 0..h {
        for x in 0..w {
            let mut ar = 0.0;
            let mut ag = 0.0;
            let mut ab = 0.0;
            let mut cnt = 0i64;
            for s in -steps..=steps {
                let sx = x as f64 + dx * s as f64 * step_px;
                let sy = y as f64 + dy * s as f64 * step_px;
                let xi = js_round(sx) as i64;
                let yi = js_round(sy) as i64;
                if xi < 0 || xi >= w as i64 || yi < 0 || yi >= h as i64 {
                    continue;
                }
                let o = ((yi as u32 * w + xi as u32) * 3) as usize;
                ar += linear[o];
                ag += linear[o + 1];
                ab += linear[o + 2];
                cnt += 1;
            }
            if cnt == 0 {
                continue;
            }
            let o = ((y * w + x) * 3) as usize;
            out[o] = ar / cnt as f64;
            out[o + 1] = ag / cnt as f64;
            out[o + 2] = ab / cnt as f64;
        }
    }
    let aspect_scale = aspect.max(1.0);
    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            let s = intensity * 0.5;
            let lr = out[(y * w + x) as usize * 3];
            let lg = out[(y * w + x) as usize * 3 + 1];
            let lb = out[(y * w + x) as usize * 3 + 2];
            let mix = s / (aspect_scale * 0.5).max(1.0);
            let nr = (data[o] as f64 / 255.0) * (1.0 - mix) + lr * mix;
            data[o] = clamp_byte(srgb_back(nr));
            let ng = (data[o + 1] as f64 / 255.0) * (1.0 - mix) + lg * mix;
            data[o + 1] = clamp_byte(srgb_back(ng));
            let nb = (data[o + 2] as f64 / 255.0) * (1.0 - mix) + lb * mix;
            data[o + 2] = clamp_byte(srgb_back(nb));
        }
    }
}

/// Apply bloom in place — port of `applyBloom` + `applyBloomResolved`.
pub fn apply(
    out: &mut [u8],
    w: u32,
    h: u32,
    p: &Params,
    quality: EffectQuality,
    coord: CoordSpace,
) -> Result<(), String> {
    let threshold = clamp01(p.f("threshold", 0.7));
    let soft_knee = clamp01(p.f("softKnee", 0.2));
    let intensity = p.f("intensity", 1.0).max(0.0);
    let diffusion = clamp01(p.f("diffusion", 0.5));
    let tint = p.rgb("tint");
    let tint_amount = clamp01(p.f("tintAmount", 0.0));
    let composite = p.s("composite", "screen");
    let streak_enabled = p.b("streakEnabled", false);
    let streak_angle = p.f("streakAngle", 0.0);
    let streak_length = p.f("streakLength", 64.0).max(0.0);
    let streak_intensity = clamp01(p.f("streakIntensity", 0.5));
    let streak_aspect = p.f("streakAspect", 2.0).max(1.0);
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => quality,
    };
    if intensity <= 0.0 {
        return Ok(());
    }
    let scale = if coord.scale > 0.0 { coord.scale } else { 1.0 };
    if w == 0 || h == 0 {
        return Ok(());
    }

    let res_factor = quality_resolution_factor(tier);
    let radius = (p.f("radius", 24.0).max(0.0) * scale).max(0.5);
    let streak_length = streak_length * scale;

    let mut src = out.to_vec();
    let mut sw = w;
    let mut sh = h;
    let mut work: Option<Vec<u8>> = None;
    if res_factor < 1.0 {
        let (data, dw, dh) = downsample_box(out, w, h, 2);
        work = Some(data.clone());
        sw = dw;
        sh = dh;
        src = data;
    }

    // Linearized-luma LUT (256 entries) for the threshold test.
    let mut lin_lut = [0.0f64; 256];
    for v in 0..256 {
        lin_lut[v] = srgb_to_linear01(v as f64);
    }

    // Bright pass.
    let n = (sw * sh) as usize;
    let mut bright = vec![0u8; n * 4];
    let knee = soft_knee;
    let thresh = threshold;
    for i in 0..n {
        let o = i * 4;
        let r = src[o] as f64;
        let g = src[o + 1] as f64;
        let b = src[o + 2] as f64;
        let a = src[o + 3];
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let lin = lin_lut[js_round(lum) as usize];
        let m: f64 = if knee <= 0.0 {
            if lin >= thresh {
                1.0
            } else {
                0.0
            }
        } else {
            let d = (lin - thresh) / knee;
            if d <= -1.0 {
                0.0
            } else if d >= 1.0 {
                1.0
            } else {
                d * 0.5 + 0.5
            }
        };
        let f = m * m;
        bright[o] = js_round(r * f) as u8;
        bright[o + 1] = js_round(g * f) as u8;
        bright[o + 2] = js_round(b * f) as u8;
        bright[o + 3] = a;
    }

    // Pyramid: levels at 1/2^k, blurred in linear light.
    struct Level {
        data: Vec<u8>,
        width: u32,
        height: u32,
        weight: f64,
    }
    let mut levels: Vec<Level> = Vec::new();
    let level_count = if tier == EffectQuality::Export { 4 } else { 3 };
    let mut lw = sw;
    let mut lh = sh;
    let mut lsrc = bright;
    for k in 0..level_count {
        let (data, dw, dh) = downsample_box(&lsrc, lw, lh, 2);
        lsrc = data.clone();
        lw = dw;
        lh = dh;
        let blur_radius = js_round(radius / 2f64.powi(k as i32)).max(1.0);
        let blurred = gaussian_blur_linear_light(&data, lw, lh, blur_radius.min(32.0) as i64);
        let weight = 1.0 + (level_count - k) as f64 * diffusion * 0.35;
        levels.push(Level {
            data: blurred,
            width: lw,
            height: lh,
            weight,
        });
        if lw <= 1 || lh <= 1 {
            break;
        }
    }

    // Streak pass: directional smear on the widest level.
    if streak_enabled && streak_intensity > 0.0 && !levels.is_empty() {
        let top = levels.last_mut().unwrap();
        streak_smear(
            &mut top.data,
            top.width,
            top.height,
            streak_angle,
            streak_length / 2f64.powi((level_count - 1) as i32),
            streak_intensity,
            streak_aspect,
            &lin_lut,
        );
    }

    // Combine: upsample each level to full res and add.
    let mut glow = vec![0.0f64; n * 4];
    let mut glow_count = vec![0.0f64; n];
    let mut half = vec![0u8; n * 4];
    for level in &levels {
        upsample_bilinear(&level.data, level.width, level.height, &mut half, sw, sh);
        let lwgt = level.weight;
        for i in 0..n {
            let o = i * 4;
            glow[o] += half[o] as f64 * lwgt;
            glow[o + 1] += half[o + 1] as f64 * lwgt;
            glow[o + 2] += half[o + 2] as f64 * lwgt;
            glow_count[i] += lwgt;
        }
    }
    for i in 0..n {
        let o = i * 4;
        let c = glow_count[i];
        let cnt = if c == 0.0 { 1.0 } else { c };
        glow[o] /= cnt;
        glow[o + 1] /= cnt;
        glow[o + 2] /= cnt;
    }

    // Composite glow over the source (with optional tint).
    let tr = tint.map_or(255.0, |t| t[0]);
    let tg = tint.map_or(255.0, |t| t[1]);
    let tb = tint.map_or(255.0, |t| t[2]);
    let tint_mix = if tint.is_some() && tint_amount > 0.0 {
        tint_amount
    } else {
        0.0
    };
    for i in 0..n {
        let o = i * 4;
        let mut gr = glow[o];
        let mut gg = glow[o + 1];
        let mut gb = glow[o + 2];
        if tint_mix > 0.0 {
            gr = gr + (gr * (tr / 255.0) - gr) * tint_mix;
            gg = gg + (gg * (tg / 255.0) - gg) * tint_mix;
            gb = gb + (gb * (tb / 255.0) - gb) * tint_mix;
        }
        if composite == "add" {
            src[o] = clamp_byte(src[o] as f64 + gr * intensity);
            src[o + 1] = clamp_byte(src[o + 1] as f64 + gg * intensity);
            src[o + 2] = clamp_byte(src[o + 2] as f64 + gb * intensity);
        } else {
            let inv_r = 255.0 - src[o] as f64;
            src[o] = clamp_byte(255.0 - (inv_r * (255.0 - gr * intensity)) / 255.0);
            src[o + 1] = clamp_byte(
                255.0 - ((255.0 - src[o + 1] as f64) * (255.0 - gg * intensity)) / 255.0,
            );
            src[o + 2] = clamp_byte(
                255.0 - ((255.0 - src[o + 2] as f64) * (255.0 - gb * intensity)) / 255.0,
            );
        }
    }

    // Upscale interactive-tier result back to full resolution, or write the
    // composed result back to the source buffer at full resolution.
    if work.is_some() && (sw != w || sh != h) {
        let mut restored = vec![0u8; (w * h * 4) as usize];
        upsample_bilinear(&src, sw, sh, &mut restored, w, h);
        out.copy_from_slice(&restored);
    } else {
        out.copy_from_slice(&src);
    }
    Ok(())
}
