//! Light leak generator — procedural camera/sensor light leaks — faithful
//! port of `packages/engine/src/liveEffects/lightLeak.ts`.
//!
//! A deterministic seeded noise field (fBm) is oriented along a direction and
//! masked by a soft positional falloff, then composited as a screen blend with
//! an HSL-derived colour. No black layers required: the effect is entirely
//! self-contained. Same (seed, params, surface) => same output.

use crate::prng::fbm2;
use crate::{clamp01, clamp_byte, js_round, Params};

/// Port of `hue2rgb`.
fn hue2rgb(p: f64, q: f64, t: f64) -> f64 {
    let mut tt = t;
    if tt < 0.0 {
        tt += 1.0;
    }
    if tt > 1.0 {
        tt -= 1.0;
    }
    if tt < 1.0 / 6.0 {
        p + (q - p) * 6.0 * tt
    } else if tt < 1.0 / 2.0 {
        q
    } else if tt < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - tt) * 6.0
    } else {
        p
    }
}

/// Port of `hslToRgb` — returns byte values (0..255).
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let hue = (((h % 360.0) + 360.0) % 360.0) / 360.0;
    if s <= 0.0 {
        let v = js_round(l * 255.0);
        return (v, v, v);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let r = js_round(hue2rgb(p, q, hue + 1.0 / 3.0) * 255.0);
    let g = js_round(hue2rgb(p, q, hue) * 255.0);
    let b = js_round(hue2rgb(p, q, hue - 1.0 / 3.0) * 255.0);
    (r, g, b)
}

/// Apply the light leak in place — port of `applyLightLeak`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params) {
    let intensity = p.f("intensity", 0.6).max(0.0);
    if intensity <= 0.0 {
        return;
    }

    let seed = js_round(p.f("seed", 0.0)) as i64 as u32;
    let cx = w as f64 * clamp01(p.f("x", 0.5));
    let cy = h as f64 * clamp01(p.f("y", 0.5));
    let angle = p.f("angle", 0.0) * std::f64::consts::PI / 180.0;
    let diag = (w as f64).hypot(h as f64);
    let size = p.f("size", 0.8).max(0.05);
    let sigma = diag * size * 0.14;
    let softness = clamp01(p.f("softness", 0.6));
    let noise_scale = clamp01(p.f("noiseScale", 0.5));
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    let noise_freq = (1.0 / (diag * 0.02).max(1.0)) * (0.3 + noise_scale * 1.6);
    let octaves = 1.0 + js_round(softness * 3.0);

    // HSL -> RGB (deterministic, analytic).
    let (cr, cg, cb) = hsl_to_rgb(
        p.f("hue", 0.0),
        clamp01(p.f("saturation", 0.7)),
        clamp01(p.f("lightness", 0.6)),
    );

    let sigma2 = 2.0 * sigma * sigma;
    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            // Oriented noise coordinates.
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let nx = dx * cos_a - dy * sin_a;
            let ny = dx * sin_a + dy * cos_a;
            let n = fbm2(nx * noise_freq, ny * noise_freq, seed, octaves);
            let g = (-(dx * dx + dy * dy) / sigma2).exp();
            let leak = n * g * intensity;
            if leak <= 0.004 {
                continue;
            }
            // Screen blend.
            let lr = cr * leak;
            let lg = cg * leak;
            let lb = cb * leak;
            out[o] = clamp_byte(255.0 - ((255.0 - out[o] as f64) * (255.0 - lr)) / 255.0);
            out[o + 1] = clamp_byte(255.0 - ((255.0 - out[o + 1] as f64) * (255.0 - lg)) / 255.0);
            out[o + 2] = clamp_byte(255.0 - ((255.0 - out[o + 2] as f64) * (255.0 - lb)) / 255.0);
        }
    }
}
