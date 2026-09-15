//! VHS / analog tape artifact kernel — faithful port of
//! `packages/engine/src/liveEffects/vhs.ts`.
//!
//! Every artifact derives from a deterministic field hash keyed on
//! (seed, frame, artifact channel) — never Math.random(). Artifacts: luma
//! noise, chroma noise, chroma bleed, per-line horizontal jitter, tracking
//! roll band, dropout lines, head-switching offset, tearing slices, signal
//! blur, and slow time instability.

use crate::prng::{hash3, mulberry32_next, seeded01};
use crate::{clamp01, clamp_byte, js_round, EffectQuality, Params};

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

/// Apply VHS artifacts in place — port of `applyVhs`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params, caller: EffectQuality) {
    let seed = js_round(p.f("seed", 0.0)) as i64 as u32;
    let frame_rate = p.f("frameRate", 24.0).max(1.0);
    let time = p.f("time", 0.0).max(0.0);
    let frame = (time * frame_rate).floor() as i32;
    let field = hash3(seed as i32, frame, 0, seed);

    let luma_noise = clamp01(p.f("lumaNoise", 0.0));
    let chroma_noise = clamp01(p.f("chromaNoise", 0.0));
    let bleed = clamp01(p.f("chromaBleed", 0.0));
    let jitter = clamp01(p.f("jitter", 0.0));
    let tracking = clamp01(p.f("tracking", 0.0));
    let dropouts = clamp01(p.f("dropouts", 0.0));
    let head_switch = clamp01(p.f("headSwitching", 0.0));
    let tearing = clamp01(p.f("tearing", 0.0));
    let signal_blur = clamp01(p.f("signalBlur", 0.0));
    let instability = clamp01(p.f("timeInstability", 0.0));
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => caller,
    };

    let src = out.to_vec();

    // Per-frame deterministic channels. JS: `field` is a [0,1) hash; `x | 0`
    // on it (hash3 first arg) truncates to 0.
    let r31 = js_round(field * 2f64.powi(31)) as i64 as i32 as u32;
    let jitter_phase = seeded01(r31 ^ 0x5f3759df);
    let tracking_y = (seeded01(r31 ^ 0x9e3779b9) * h as f64).floor() as i64;
    let drop_count = js_round(dropouts * 12.0) as i64;
    let tear_count = js_round(tearing * 24.0).max(1.0) as i64;
    let drift_x = (jitter_phase - 0.5) * 2.0 * instability * 24.0;

    // Precompute per-line jitter (Float32 storage matches the TS array).
    let mut line_jitter = vec![0.0f32; h as usize];
    for y in 0..h as i64 {
        line_jitter[y as usize] =
            ((hash3(0, y as i32, 1, seed) - 0.5) * 2.0 * jitter * 16.0) as f32;
    }

    // Tear slices: hash boundaries, each slice shifted.
    let mut tear_offsets = vec![0i32; h as usize];
    if tearing > 0.0 {
        let slice_h = ((h as f64 / tear_count as f64).floor()).max(4.0) as i64;
        for s in 0..tear_count {
            let y0 = s * slice_h;
            let offset =
                js_round((hash3(0, s as i32, 2, seed) - 0.5) * 2.0 * tearing * 48.0) as i32;
            for y in y0..(y0 + slice_h).min(h as i64) {
                tear_offsets[y as usize] = offset;
            }
        }
    }

    // Dropout lines.
    let mut dropout_rows = std::collections::HashSet::new();
    for i in 0..drop_count {
        let y = (hash3(0, i as i32, 3, seed) * h as f64).floor() as i64;
        dropout_rows.insert(y);
        dropout_rows.insert((y + 1).min(h as i64 - 1));
    }

    let mut rng_state = r31;
    let wf = w as i32;
    let hf = h as i64;
    let wu = w as usize;

    for y in 0..hf {
        let is_dropout = dropout_rows.contains(&y);
        let head_offset: i64 = if y as f64 > h as f64 * 0.92 {
            js_round((hash3(0, 9, 4, seed) - 0.5) * 2.0 * head_switch * 40.0) as i64
        } else {
            0
        };
        let track_offset: i64 =
            if tracking > 0.0 && ((y - tracking_y).abs() as f64) < (h as f64 * 0.03).max(2.0) {
                js_round((hash3(0, y as i32, 5, seed) - 0.5) * 2.0 * tracking * 24.0) as i64
            } else {
                0
            };
        for x in 0..w as i64 {
            let o = ((y * wu as i64 + x) * 4) as usize;
            let a = src[o + 3];
            let shift = js_round(
                line_jitter[y as usize] as f64
                    + tear_offsets[y as usize] as f64
                    + head_offset as f64
                    + track_offset as f64,
            ) as i64;
            let sx = x + shift;
            let sx_wrapped = ((sx % wf as i64) + wf as i64) % wf as i64;
            let so = ((y * wu as i64 + sx_wrapped) * 4) as usize;
            let mut r = src[so] as f64;
            let mut g = src[so + 1] as f64;
            let mut b = src[so + 2] as f64;

            // Time instability: global slow drift of the sampled position.
            if instability > 0.0 && drift_x != 0.0 {
                let dx = js_round(drift_x) as i64;
                let sxo = (((x + dx) % wf as i64) + wf as i64) % wf as i64;
                let so2 = ((y * wu as i64 + sxo) * 4) as usize;
                r = r * 0.5 + src[so2] as f64 * 0.5;
                g = g * 0.5 + src[so2 + 1] as f64 * 0.5;
                b = b * 0.5 + src[so2 + 2] as f64 * 0.5;
            }

            // Luma noise.
            if luma_noise > 0.0 {
                let n = (mulberry32_next(&mut rng_state) - 0.5) * 2.0 * luma_noise * 42.0;
                r += n;
                g += n;
                b += n;
            }
            // Chroma noise (opposed red/blue).
            if chroma_noise > 0.0 {
                let n = (mulberry32_next(&mut rng_state) - 0.5) * 2.0 * chroma_noise * 34.0;
                r += n;
                b -= n;
            }

            // Dropout: white burst line.
            if is_dropout {
                let d = 0.55 + mulberry32_next(&mut rng_state) * 0.3;
                r = r * 0.3 + 255.0 * d * 0.7;
                g = g * 0.3 + 255.0 * d * 0.7;
                b = b * 0.3 + 255.0 * d * 0.7;
            }

            out[o] = clamp_byte(r);
            out[o + 1] = clamp_byte(g);
            out[o + 2] = clamp_byte(b);
            out[o + 3] = a;
        }
    }

    // Chroma bleed: horizontal smear of the colour channels, luma untouched.
    if bleed > 0.0 {
        let factor = if tier == EffectQuality::Interactive {
            0.5
        } else {
            1.0
        };
        let radius = js_round(bleed * 12.0 * factor).max(1.0) as i64;
        for y in 0..hf {
            for x in 0..w as i64 {
                let o = ((y * wu as i64 + x) * 4) as usize;
                let mut r = 0.0f64;
                let mut b = 0.0f64;
                let mut n = 0.0f64;
                for dx in -radius..=radius {
                    let nx = x + dx;
                    if nx < 0 || nx >= w as i64 {
                        continue;
                    }
                    let no = ((y * wu as i64 + nx) * 4) as usize;
                    r += out[no] as f64;
                    b += out[no + 2] as f64;
                    n += 1.0;
                }
                if n > 0.0 {
                    let mix = bleed * 0.85;
                    out[o] = clamp_byte(out[o] as f64 + (r / n - out[o] as f64) * mix);
                    out[o + 2] = clamp_byte(out[o + 2] as f64 + (b / n - out[o + 2] as f64) * mix);
                }
            }
        }
    }

    // Signal blur: cheap 3x3 box blur blend.
    if signal_blur > 0.0 {
        let mut blurred = out.to_vec();
        box_blur3(&mut blurred, w, h, 1);
        let m = signal_blur * 0.6;
        for i in (0..out.len()).step_by(4) {
            out[i] = clamp_byte(out[i] as f64 + (blurred[i] as f64 - out[i] as f64) * m);
            out[i + 1] =
                clamp_byte(out[i + 1] as f64 + (blurred[i + 1] as f64 - out[i + 1] as f64) * m);
            out[i + 2] =
                clamp_byte(out[i + 2] as f64 + (blurred[i + 2] as f64 - out[i + 2] as f64) * m);
        }
    }
}
