//! CRT / analog display emulation kernel — faithful port of
//! `packages/engine/src/liveEffects/crt.ts`.
//!
//! Reusable procedural primitives: barrel curvature warp, scanline shading,
//! phosphor mask layouts (RGB stripe / BGR stripe / aperture grille / shadow
//! mask), glow, vignette, sub-pixel convergence offsets, and brightness/
//! contrast gain. Every pattern is analytic and deterministic — no noise, no
//! randomness.

use crate::{clamp01, clamp_byte, js_round, Params};

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = clamp01((x - e0) / (e1 - e0));
    t * t * (3.0 - 2.0 * t)
}

fn clamp_range(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

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

/// Sub-pixel bilinear sample of channel `c` — port of `sampleBilinear`.
fn sample_bilinear(src: &[u8], w: u32, h: u32, x: f64, y: f64, c: usize) -> f64 {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    let w_ = w as i64;
    let h_ = h as i64;
    let x1 = (x0 + 1).clamp(0, w_ - 1);
    let y1 = (y0 + 1).clamp(0, h_ - 1);
    let c0 = x0.clamp(0, w_ - 1);
    let r0 = y0.clamp(0, h_ - 1);
    let a = src[((r0 * w_ + c0) * 4 + c as i64) as usize] as f64;
    let b = src[((r0 * w_ + x1) * 4 + c as i64) as usize] as f64;
    let d = src[((y1 * w_ + c0) * 4 + c as i64) as usize] as f64;
    let e = src[((y1 * w_ + x1) * 4 + c as i64) as usize] as f64;
    a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy
}

/// Phosphor mask multiplier triple — port of `phosphorMaskAt`.
fn phosphor_mask_at(mask: &str, x: f64, y: f64, pitch: f64) -> (f64, f64, f64) {
    let px = x % pitch;
    let t = px / pitch;
    match mask {
        "rgb-stripe" => {
            if t < 0.34 {
                (1.0, 0.22, 0.22)
            } else if t < 0.67 {
                (0.22, 1.0, 0.22)
            } else {
                (0.22, 0.22, 1.0)
            }
        }
        "bgr-stripe" => {
            if t < 0.34 {
                (0.22, 0.22, 1.0)
            } else if t < 0.67 {
                (0.22, 1.0, 0.22)
            } else {
                (1.0, 0.22, 0.22)
            }
        }
        "aperture-grille" => {
            if t < 0.5 {
                (1.0, 0.35, 0.35)
            } else {
                (0.35, 0.35, 1.0)
            }
        }
        "shadow-mask" => {
            let py = y % pitch;
            let dot = (t - 0.5).hypot(py / pitch - 0.5) * 2.0;
            let dark = if dot > 0.85 { 0.2 } else { 1.0 };
            (dark, dark, dark)
        }
        _ => (1.0, 1.0, 1.0),
    }
}

/// 3×3-ish box blur with float32 accumulation — port of `boxBlur3`.
fn box_blur3(data: &mut [u8], w: u32, h: u32, radius: i64) {
    let mut tmp = vec![0.0f32; (w * h * 4) as usize];
    for c in 0..4u32 {
        for y in 0..h {
            for x in 0..w {
                let mut sum = 0.0f64;
                let mut n = 0.0f64;
                for dy in -radius..=radius {
                    let ny = y as i64 + dy;
                    if ny < 0 || ny >= h as i64 {
                        continue;
                    }
                    for dx in -radius..=radius {
                        let nx = x as i64 + dx;
                        if nx < 0 || nx >= w as i64 {
                            continue;
                        }
                        sum += data[((ny * w as i64 + nx) * 4 + c as i64) as usize] as f64;
                        n += 1.0;
                    }
                }
                tmp[((y * w + x) * 4 + c) as usize] = (sum / n) as f32;
            }
        }
    }
    for (i, t) in tmp.iter().enumerate() {
        data[i] = js_round(*t as f64) as u8;
    }
}

/// Apply CRT emulation in place — port of `applyCrt`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params) {
    let curvature = clamp01(p.f("curvature", 0.0));
    let scan_period = p.f("scanlinePeriod", 3.0).max(1.5);
    let scan_strength = clamp01(p.f("scanlineStrength", 0.5));
    let scan_softness = clamp01(p.f("scanlineSoftness", 0.5));
    let phosphor = p.s("phosphorMask", "none");
    let pitch = p.f("phosphorPitch", 4.0).max(1.0);
    let ph_intensity = clamp01(p.f("phosphorIntensity", 0.6));
    let glow = clamp01(p.f("glow", 0.0));
    let vignette = clamp01(p.f("vignette", 0.0));
    let vignette_r = clamp01(p.f("vignetteRadius", 0.5));
    let cx = p.f("convergenceX", 0.0);
    let cy = p.f("convergenceY", 0.0);
    let brightness = clamp_range(p.f("brightness", 0.0), -1.0, 1.0);
    let contrast = clamp_range(p.f("contrast", 1.0), 0.0, 2.0);

    let mut src = out.to_vec();
    premultiply(&mut src);

    let half_w = w as f64 / 2.0;
    let half_h = h as f64 / 2.0;
    let warp_k = curvature * 0.28;
    let wf = w as f64;
    let hf = h as f64;
    let wu = w as usize;

    for y in 0..h {
        for x in 0..w {
            let o = (y as usize * wu + x as usize) * 4;
            let a = src[o + 3];

            // Curvature warp: inverse mapping (output px -> source offset).
            let mut sx = x as f64;
            let mut sy = y as f64;
            if warp_k > 0.0 {
                let nx = (x as f64 - half_w) / half_w;
                let ny = (y as f64 - half_h) / half_h;
                let r2 = nx * nx + ny * ny;
                let scale = 1.0 + warp_k * r2;
                sx = (half_w + (nx * half_w) / scale).max(0.0).min(wf - 1.0);
                sy = (half_h + (ny * half_h) / scale).max(0.0).min(hf - 1.0);
            }
            let x0 = sx.floor();
            let y0 = sy.floor();
            let fx = sx - x0;
            let fy = sy - y0;
            let x1 = (x0 + 1.0).min(wf - 1.0);
            let y1 = (y0 + 1.0).min(hf - 1.0);
            let x0i = x0 as usize;
            let y0i = y0 as usize;
            let x1i = x1 as usize;
            let y1i = y1 as usize;
            let o00 = (y0i * wu + x0i) * 4;
            let o10 = (y0i * wu + x1i) * 4;
            let o01 = (y1i * wu + x0i) * 4;
            let o11 = (y1i * wu + x1i) * 4;
            let mut r = lerp(
                lerp(src[o00] as f64, src[o10] as f64, fx),
                lerp(src[o01] as f64, src[o11] as f64, fx),
                fy,
            );
            let mut g = lerp(
                lerp(src[o00 + 1] as f64, src[o10 + 1] as f64, fx),
                lerp(src[o01 + 1] as f64, src[o11 + 1] as f64, fx),
                fy,
            );
            let mut b = lerp(
                lerp(src[o00 + 2] as f64, src[o10 + 2] as f64, fx),
                lerp(src[o01 + 2] as f64, src[o11 + 2] as f64, fx),
                fy,
            );

            // Convergence: red shifted +, blue shifted - (subpixel bilinear).
            if cx != 0.0 || cy != 0.0 {
                let rr = sample_bilinear(&src, w, h, x as f64 + cx, y as f64 + cy, 0);
                let rb = sample_bilinear(&src, w, h, x as f64 - cx, y as f64 - cy, 2);
                r = lerp(r, rr, 0.6);
                b = lerp(b, rb, 0.6);
            }

            // Scanlines.
            if scan_strength > 0.0 {
                let phase = ((y as f64 % scan_period) + scan_period) % scan_period;
                let pulse = 0.5 + 0.5 * (2.0 * std::f64::consts::PI * phase / scan_period).cos();
                let depth = scan_strength * pulse.powf(0.4 + scan_softness * 2.2);
                r *= 1.0 - depth;
                g *= 1.0 - depth;
                b *= 1.0 - depth;
            }

            // Phosphor mask.
            if phosphor != "none" && ph_intensity > 0.0 {
                let (mr, mg, mb) = phosphor_mask_at(phosphor, x as f64, y as f64, pitch);
                let m = ph_intensity;
                r = r * (1.0 - m) + r * mr * m;
                g = g * (1.0 - m) + g * mg * m;
                b = b * (1.0 - m) + b * mb * m;
            }

            // Vignette (also handles corner rounding via the same falloff).
            if vignette > 0.0 {
                let nx = (x as f64 - half_w) / (half_w * vignette_r * 2.0);
                let ny = (y as f64 - half_h) / (half_h * vignette_r * 2.0);
                let d = nx.hypot(ny).min(1.0);
                let vig = 1.0 - vignette * smoothstep(0.55, 1.0, d);
                r *= vig;
                g *= vig;
                b *= vig;
            }

            // Brightness/contrast.
            let gain = contrast;
            r = (r - 128.0) * gain + 128.0 + brightness * 128.0;
            g = (g - 128.0) * gain + 128.0 + brightness * 128.0;
            b = (b - 128.0) * gain + 128.0 + brightness * 128.0;

            out[o] = clamp_byte(r);
            out[o + 1] = clamp_byte(g);
            out[o + 2] = clamp_byte(b);
            out[o + 3] = a;
        }
    }

    // Glow: add a small blur of the bright content back (linear-light friendly).
    if glow > 0.0 {
        let mut glow_pass = out.to_vec();
        box_blur3(&mut glow_pass, w, h, 2);
        let m = glow * 0.5;
        for i in (0..out.len()).step_by(4) {
            out[i] = clamp_byte(out[i] as f64 + (glow_pass[i] as f64 - out[i] as f64) * m);
            out[i + 1] =
                clamp_byte(out[i + 1] as f64 + (glow_pass[i + 1] as f64 - out[i + 1] as f64) * m);
            out[i + 2] =
                clamp_byte(out[i + 2] as f64 + (glow_pass[i + 2] as f64 - out[i + 2] as f64) * m);
        }
    }

    unpremultiply(out);
}
