//! Procedural water caustics / liquid refraction kernel — faithful port of
//! `packages/engine/src/liveEffects/caustics.ts`.
//!
//! Multi-wave interference: the surface height field is a sum of travelling
//! sine waves with seeded directions/phases/speeds. Caustic brightness derives
//! from the field's Laplacian (focusing), and refraction displaces sampling
//! along the analytic gradient. Tileable mode uses integer-lattice wave
//! vectors so the field is exactly periodic in space.

use crate::prng::seeded01;
use crate::{clamp_byte, clamp01, js_round, CoordSpace, EffectQuality, Params};

/// Deterministic wave set — port of `buildCausticWaves`.
fn build_caustic_waves(p: &Params, scale_px: f64) -> Vec<(f64, f64, f64, f64, f64)> {
    let count = js_round(p.f("waveCount", 4.0)).max(2.0).min(8.0) as i64;
    let seed = js_round(p.f("seed", 0.0)) as i64 as u32;
    let tileable = p.b("tileable", false);
    let period = scale_px * 4.0;
    let mut waves = Vec::with_capacity(count as usize);
    for i in 0..count {
        let iu = i as u32;
        let (kx, ky): (f64, f64) = if tileable {
            let nx = js_round(
                seeded01(seed.wrapping_add(iu.wrapping_mul(101).wrapping_add(1))) * 3.0,
            )
            .max(1.0);
            let my = js_round(
                seeded01(seed.wrapping_add(iu.wrapping_mul(101).wrapping_add(2))) * 3.0,
            )
            .max(1.0);
            let kx = (nx * 2.0 * std::f64::consts::PI) / period;
            let ky = (my * 2.0 * std::f64::consts::PI) / period;
            let kx = if (i & 1) == 0 { -kx } else { kx };
            let ky = if (i & 2) == 0 { -ky } else { ky };
            (kx, ky)
        } else {
            let angle =
                seeded01(seed.wrapping_add(iu.wrapping_mul(101))) * std::f64::consts::PI * 2.0;
            let freq = ((2.0 * std::f64::consts::PI) / scale_px)
                * (0.7 + seeded01(seed.wrapping_add(iu.wrapping_mul(101).wrapping_add(7))) * 0.6);
            (angle.cos() * freq, angle.sin() * freq)
        };
        let phase =
            seeded01(seed.wrapping_add(iu.wrapping_mul(101).wrapping_add(3))) * std::f64::consts::PI * 2.0;
        let speed = (seeded01(seed.wrapping_add(iu.wrapping_mul(101).wrapping_add(5))) - 0.5)
            * 2.0
            * p.f("animationSpeed", 1.0);
        waves.push((kx, ky, phase, speed, 1.0 / count as f64));
    }
    waves
}

/// Bilinear sample of a single channel — port of `sampleBilinear`.
fn sample_bilinear(src: &[u8], w: u32, h: u32, x: f64, y: f64, c: usize) -> f64 {
    let x0 = x.floor();
    let y0 = y.floor();
    let fx = x - x0;
    let fy = y - y0;
    let x1 = ((x0 as i64 + 1).min(w as i64 - 1)).max(0) as u32;
    let y1 = ((y0 as i64 + 1).min(h as i64 - 1)).max(0) as u32;
    let c0 = ((x0 as i64).min(w as i64 - 1)).max(0) as u32;
    let r0 = ((y0 as i64).min(h as i64 - 1)).max(0) as u32;
    let a = src[((r0 * w + c0) * 4 + c as u32) as usize] as f64;
    let b = src[((r0 * w + x1) * 4 + c as u32) as usize] as f64;
    let d = src[((y1 * w + c0) * 4 + c as u32) as usize] as f64;
    let e = src[((y1 * w + x1) * 4 + c as u32) as usize] as f64;
    a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy
}

fn clamp_range(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// Apply caustics in place — port of `applyCaustics`.
pub fn apply(
    out: &mut [u8],
    w: u32,
    h: u32,
    p: &Params,
    quality: EffectQuality,
    coord: CoordSpace,
) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Ok(());
    }
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => quality,
    };
    let scale = if coord.scale > 0.0 { coord.scale } else { 1.0 };
    let scale_px = (p.f("scale", 24.0) * scale).max(4.0);
    let time = p.f("time", 0.0).max(0.0);
    let depth = clamp01(p.f("depth", 0.5));
    let sharpness = clamp01(p.f("sharpness", 0.5));
    let brightness = p.f("brightness", 1.0).max(0.0);
    let contrast = p.f("contrast", 1.0).max(0.0);
    let dispersion = clamp01(p.f("dispersion", 0.0));
    let distortion = clamp01(p.f("distortionAmount", 1.0));
    let refraction = clamp01(p.f("refractionAmount", 0.5));
    let output = p.s("output", "combined");
    let light_angle = (p.f("lightAngle", 60.0) * std::f64::consts::PI) / 180.0;
    let waves = build_caustic_waves(p, scale_px);

    // Deterministic per-call field evaluation at quality resolution.
    let field_w = (w as f64 * if tier == EffectQuality::Interactive { 0.5 } else { 1.0 })
        .floor()
        .max(8.0) as u32;
    let field_h = (h as f64 * if tier == EffectQuality::Interactive { 0.5 } else { 1.0 })
        .floor()
        .max(8.0) as u32;
    let step_x = w as f64 / field_w as f64;
    let step_y = h as f64 / field_h as f64;
    let field_n = (field_w * field_h) as usize;
    let mut fx = vec![0.0f64; field_n];
    let mut fy = vec![0.0f64; field_n];
    let mut lap = vec![0.0f64; field_n];

    for gy in 0..field_h {
        for gx in 0..field_w {
            let px = (gx as f64 + 0.5) * step_x;
            let py = (gy as f64 + 0.5) * step_y;
            let mut hx = 0.0;
            let mut hy = 0.0;
            let mut hlap = 0.0;
            for &(kx, ky, phase, speed, amp) in &waves {
                let arg = kx * px + ky * py + phase + speed * time * std::f64::consts::PI * 2.0;
                let s = arg.sin();
                let c = arg.cos();
                let k2 = kx * kx + ky * ky;
                hx += amp * kx * c;
                hy += amp * ky * c;
                hlap += -amp * k2 * s;
            }
            let gi = (gy * field_w + gx) as usize;
            fx[gi] = hx * depth;
            fy[gi] = hy * depth;
            lap[gi] = hlap * depth;
        }
    }

    // Complexity: mix a fine secondary field (deterministic) into the
    // laplacian.
    let complexity_raw = p.f("complexity", 0.0);
    if complexity_raw > 0.0 {
        let c = clamp01(complexity_raw);
        let seed_raw = p.f("seed", 0.0);
        for gi in 0..field_n {
            let gx = gi as u32 % field_w;
            let gy = gi as u32 / field_w;
            let n = seeded01(
                ((js_round(lap[gi] * 4096.0) as i64)
                    ^ (seed_raw + gy as f64 * 31.0 + gx as f64 * 7.0) as i64)
                    as u32,
            );
            lap[gi] = lap[gi] * (1.0 - c) + (n - 0.5) * 0.05 * c;
        }
    }

    // Composite at full res (bilinear sample of the field derivatives).
    let light_dir_x = light_angle.cos();
    let light_dir_y = light_angle.sin();
    let focus_scale = (0.3 + sharpness * 1.2) * 0.06 * scale_px;
    let wt = p.rgb("waterTint");
    let st = p.rgb("surfaceTint");

    for y in 0..h {
        let gy = (y as f64 / step_y - 0.5).max(0.0).min(field_h as f64 - 1.0);
        let gy0 = gy.floor() as u32;
        let gy1 = (gy0 + 1).min(field_h - 1);
        let fyy = gy - gy0 as f64;
        for x in 0..w {
            let gx = (x as f64 / step_x - 0.5).max(0.0).min(field_w as f64 - 1.0);
            let gx0 = gx.floor() as u32;
            let gx1 = (gx0 + 1).min(field_w - 1);
            let fxx = gx - gx0 as f64;
            let i00 = (gy0 * field_w + gx0) as usize;
            let i10 = (gy0 * field_w + gx1) as usize;
            let i01 = (gy1 * field_w + gx0) as usize;
            let i11 = (gy1 * field_w + gx1) as usize;
            let gx_ = fx[i00]
                + (fx[i10] - fx[i00]) * fxx
                + (fx[i01] - fx[i00]) * fyy
                + (fx[i00] - fx[i10] - fx[i01] + fx[i11]) * fxx * fyy;
            let gy_ = fy[i00]
                + (fy[i10] - fy[i00]) * fxx
                + (fy[i01] - fy[i00]) * fyy
                + (fy[i00] - fy[i10] - fy[i01] + fy[i11]) * fxx * fyy;
            let lap_ = lap[i00]
                + (lap[i10] - lap[i00]) * fxx
                + (lap[i01] - lap[i00]) * fyy
                + (lap[i00] - lap[i10] - lap[i01] + lap[i11]) * fxx * fyy;

            let o = (y * w + x) as usize * 4;
            let a = out[o + 3];

            // Refraction displacement (analytic gradient), per-channel
            // dispersion.
            let disp = 1.0 + dispersion * 0.6;
            let off_r = gx_ * refraction * distortion * scale_px * 0.09 * disp;
            let off_g = gx_ * refraction * distortion * scale_px * 0.09;
            let off_b = gx_ * refraction * distortion * scale_px * 0.09 * (2.0 - disp);
            let off_ry = gy_ * refraction * distortion * scale_px * 0.09 * disp;
            let off_gy = gy_ * refraction * distortion * scale_px * 0.09;
            let off_by = gy_ * refraction * distortion * scale_px * 0.09 * (2.0 - disp);

            let r: f64;
            let g: f64;
            let b: f64;
            if output == "lighting" {
                r = out[o] as f64;
                g = out[o + 1] as f64;
                b = out[o + 2] as f64;
            } else {
                r = sample_bilinear(out, w, h, x as f64 + off_r, y as f64 + off_ry, 0);
                g = sample_bilinear(out, w, h, x as f64 + off_g, y as f64 + off_gy, 1);
                b = sample_bilinear(out, w, h, x as f64 + off_b, y as f64 + off_by, 2);
            }

            // Caustic lighting.
            let c = clamp01(0.45 + lap_ * focus_scale * brightness);
            let shade = 0.5 + 0.5 * clamp_range(light_dir_x * gx_ + light_dir_y * gy_, -1.0, 1.0);
            let light = clamp01((c - 0.5) * contrast + 0.5);

            if output == "refraction" {
                out[o] = r as u8;
                out[o + 1] = g as u8;
                out[o + 2] = b as u8;
            } else {
                let bright = 0.55 + light * 0.9 * shade;
                let mut nr = r * bright;
                let mut ng = g * bright;
                let mut nb = b * bright;
                if let Some(wt) = wt {
                    let m = clamp01(light) * 0.5;
                    nr = nr * (1.0 - m) + wt[0] * light * 255.0 * m;
                    ng = ng * (1.0 - m) + wt[1] * light * 255.0 * m;
                    nb = nb * (1.0 - m) + wt[2] * light * 255.0 * m;
                }
                if let Some(st) = st {
                    nr = nr * (1.0 - 0.35) + nr * (st[0] / 255.0) * 0.35;
                    ng = ng * (1.0 - 0.35) + ng * (st[1] / 255.0) * 0.35;
                    nb = nb * (1.0 - 0.35) + nb * (st[2] / 255.0) * 0.35;
                }
                out[o] = clamp_byte(nr);
                out[o + 1] = clamp_byte(ng);
                out[o + 2] = clamp_byte(nb);
            }
            out[o + 3] = a;
        }
    }
    Ok(())
}
