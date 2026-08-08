//! Volumetric light shafts — screen-space radial light scattering — faithful
//! port of `packages/engine/src/liveEffects/lightShafts.ts`.
//!
//! This is NOT ray tracing: a small number of steps is marched along each
//! pixel's ray toward the light source, accumulating luminance-weighted
//! scattering. Occlusion source 'luminance' treats bright content as
//! light-emitting; 'alpha' treats opaque content as scattering surfaces.
//! Quality tiers scale the step count (interactive 0.5x, export 2x).

use crate::prng::srgb_to_linear01;
use crate::{clamp01, clamp_byte, js_round, EffectQuality, Params};

/// Box-average blur of the scatter buffer (float32 accumulation) — port of
/// `blurScatter`.
fn blur_scatter(scatter: &mut [f32], w: u32, h: u32, radius: i64) {
    let mut tmp = vec![0.0f32; scatter.len()];
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let mut r = 0.0f64;
            let mut g = 0.0f64;
            let mut b = 0.0f64;
            let mut n = 0.0f64;
            for dy in -radius..=radius {
                let ny = y + dy;
                if ny < 0 || ny >= h as i64 {
                    continue;
                }
                for dx in -radius..=radius {
                    let nx = x + dx;
                    if nx < 0 || nx >= w as i64 {
                        continue;
                    }
                    let o = ((ny * w as i64 + nx) * 3) as usize;
                    r += scatter[o] as f64;
                    g += scatter[o + 1] as f64;
                    b += scatter[o + 2] as f64;
                    n += 1.0;
                }
            }
            let o = ((y * w as i64 + x) * 3) as usize;
            tmp[o] = (r / n) as f32;
            tmp[o + 1] = (g / n) as f32;
            tmp[o + 2] = (b / n) as f32;
        }
    }
    scatter.copy_from_slice(&tmp);
}

/// Apply light shafts in place — port of `applyLightShafts`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params, caller: EffectQuality) {
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => caller,
    };
    let intensity = p.f("intensity", 1.0).max(0.0);
    if intensity <= 0.0 {
        return;
    }
    let exposure = p.f("exposure", 0.0).clamp(-1.0, 1.0);
    let decay = clamp01(p.f("decay", 0.9));
    let density = clamp01(p.f("density", 0.15));
    let weight = clamp01(p.f("weight", 0.8));
    let scattering = clamp01(p.f("scattering", 0.5));
    let occlusion = p.s("occlusionSource", "luminance");
    let sample_factor = match tier {
        EffectQuality::Interactive => 0.5,
        EffectQuality::Export => 2.0,
        EffectQuality::Normal => 1.0,
    };
    let steps = (js_round(p.f("sampleCount", 24.0)) * sample_factor).clamp(4.0, 96.0) as u32;

    // sRGB LUT (float32 storage matches the TS Float32Array).
    let lin_lut: Vec<f32> = (0..256u32)
        .map(|v| srgb_to_linear01(v as f64) as f32)
        .collect();

    // Precompute the occlusion mask (0..1): how strongly each pixel scatters.
    let mut occ = vec![0.0f32; (w * h) as usize];
    for (i, occ_i) in occ.iter_mut().enumerate() {
        let o = i * 4;
        if occlusion == "alpha" {
            *occ_i = (out[o + 3] as f64 / 255.0) as f32;
        } else {
            let lum = lin_lut[js_round(
                0.2126 * out[o] as f64 + 0.7152 * out[o + 1] as f64 + 0.0722 * out[o + 2] as f64,
            ) as usize];
            *occ_i = ((lum as f64 - 0.12).max(0.0) * weight) as f32;
        }
    }

    let light_x = w as f64 * clamp01(p.f("lightX", 0.5));
    let light_y = h as f64 * clamp01(p.f("lightY", 0.5));
    let is_directional = p.s("lightType", "point") == "directional";
    let angle = p.f("direction", 0.0) * std::f64::consts::PI / 180.0;
    let dir_x = -angle.cos();
    let dir_y = -angle.sin();
    let max_dist = (w as f64).hypot(h as f64);

    let tint = p.rgb("tint");
    let (tr, tg, tb) = match tint {
        Some(t) => (t[0], t[1], t[2]),
        None => (255.0, 255.0, 255.0),
    };
    let tint_mix = if tint.is_some() { 1.0 } else { 0.0 };

    // Scatter buffer (float32 accumulation like the TS Float32Array).
    let mut scatter = vec![0.0f32; (w * h * 3) as usize];

    let wf = w as i64;
    let hf = h as i64;
    let wu = w as usize;
    for y in 0..hf {
        for x in 0..wf {
            let i = (y * wu as i64 + x) as usize;
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let (ray_x, ray_y, dist_to_light): (f64, f64, f64) = if is_directional {
                (dir_x, dir_y, max_dist)
            } else {
                let ddx = light_x - px;
                let ddy = light_y - py;
                let d = ddx.hypot(ddy);
                let d = if d == 0.0 { 1.0 } else { d };
                (ddx / d, ddy / d, ddx.hypot(ddy))
            };
            let step_len = (dist_to_light / steps as f64).max(1.0);
            let mut acc = 0.0f64;
            let mut sample_x = px;
            let mut sample_y = py;
            let mut e = 1.0f64;
            for _ in 0..steps {
                sample_x += ray_x * step_len;
                sample_y += ray_y * step_len;
                let si = (sample_x.floor().max(0.0).min((w - 1) as f64) as usize)
                    + (sample_y.floor().max(0.0).min((h - 1) as f64) as usize) * wu;
                acc += occ[si] as f64 * e * density;
                e *= decay;
                if sample_x < 0.0 || sample_x >= w as f64 || sample_y < 0.0 || sample_y >= h as f64
                {
                    break;
                }
            }
            scatter[i * 3] = acc as f32;
            scatter[i * 3 + 1] = acc as f32;
            scatter[i * 3 + 2] = acc as f32;
        }
    }

    // Optional diffuse pass: blur the scatter map by the scattering amount.
    if scattering > 0.0 {
        blur_scatter(
            &mut scatter,
            w,
            h,
            js_round(scattering * 6.0).max(1.0) as i64,
        );
    }

    let gain = intensity * 2f64.powf(exposure);
    for i in 0..(w as usize * h as usize) {
        let o = i * 4;
        let a = out[o + 3];
        let s = scatter[i * 3] as f64;
        let mut lr = s * gain;
        let mut lg = s * gain;
        let mut lb = s * gain;
        if tint_mix > 0.0 {
            lr *= tr / 255.0;
            lg *= tg / 255.0;
            lb *= tb / 255.0;
        }
        out[o] = clamp_byte(out[o] as f64 + lr);
        out[o + 1] = clamp_byte(out[o + 1] as f64 + lg);
        out[o + 2] = clamp_byte(out[o + 2] as f64 + lb);
        out[o + 3] = a;
    }
}
