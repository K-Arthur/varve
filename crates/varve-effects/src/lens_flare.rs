//! Procedural lens flare generator — faithful port of
//! `packages/engine/src/liveEffects/lensFlare.ts`.
//!
//! Components: central halo, ghost circles along the flare axis, aperture
//! polygon (star with N blades), diffraction streaks, and radial chromatic
//! dispersion. A negative source position auto-tracks the brightest pixel in
//! the surface (computed once, deterministically).

use crate::prng::seeded01;
use crate::{clamp01, clamp_byte, js_round, EffectQuality, Params};

/// Add a uniform RGB glow. `channel_scale` multiplies all three channels
/// (port of `addGlow`, which routes channel = -1 through `addGlowChannel`).
#[allow(clippy::too_many_arguments)]
fn add_glow(
    acc: &mut [f64],
    cx: f64,
    cy: f64,
    radius: f64,
    intensity: f64,
    channel_scale: f64,
    ww: u32,
    hh: u32,
) {
    add_glow_channel(acc, cx, cy, radius, intensity, -1, ww, hh, channel_scale);
}

/// Port of `addGlowChannel` in lensFlare.ts. `channel` of -1 writes all three
/// channels (scaled), otherwise only `channel`.
#[allow(clippy::too_many_arguments)]
fn add_glow_channel(
    acc: &mut [f64],
    cx: f64,
    cy: f64,
    radius: f64,
    intensity: f64,
    channel: i32,
    ww: u32,
    hh: u32,
    channel_scale: f64,
) {
    let r2 = radius * radius;
    if r2 <= 0.0 {
        return;
    }
    let x0 = (cx - radius * 2.0).floor().max(0.0) as i64;
    let y0 = (cy - radius * 2.0).floor().max(0.0) as i64;
    let x1 = ((cx + radius * 2.0).ceil() as i64).min(ww as i64 - 1);
    let y1 = ((cy + radius * 2.0).ceil() as i64).min(hh as i64 - 1);
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let d2 = dx * dx + dy * dy;
            let v = (-d2 / (2.0 * r2)).exp() * intensity;
            if v < 0.004 {
                continue;
            }
            let o = ((y as u32 * ww + x as u32) * 3) as usize;
            if channel == -1 {
                acc[o] += v * channel_scale;
                acc[o + 1] += v * channel_scale;
                acc[o + 2] += v * channel_scale;
            } else {
                acc[o + channel as usize] += v;
            }
        }
    }
}

/// Port of `addStreak` in lensFlare.ts.
#[allow(clippy::too_many_arguments)]
fn add_streak(
    acc: &mut [f64],
    cx: f64,
    cy: f64,
    ux: f64,
    uy: f64,
    length: f64,
    width: f64,
    intensity: f64,
    ww: u32,
    hh: u32,
) {
    let a = uy.atan2(ux);
    let cos_a = a.cos();
    let sin_a = a.sin();
    let half_len = length;
    let w2 = (width * width).max(0.6);
    let x0 = (cx - cos_a.abs() * half_len - width).floor().max(0.0) as i64;
    let y0 = (cy - sin_a.abs() * half_len - width).floor().max(0.0) as i64;
    let x1 = ((cx + cos_a.abs() * half_len + width).ceil() as i64).min(ww as i64 - 1);
    let y1 = ((cy + sin_a.abs() * half_len + width).ceil() as i64).min(hh as i64 - 1);
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let along = dx * cos_a + dy * sin_a;
            let perp = -dx * sin_a + dy * cos_a;
            let len_falloff = (-(along * along) / (2.0 * (half_len * half_len))).exp();
            let perp_falloff = (-(perp * perp) / (2.0 * w2)).exp();
            let v = len_falloff * perp_falloff * intensity;
            if v < 0.004 {
                continue;
            }
            let o = ((y as u32 * ww + x as u32) * 3) as usize;
            acc[o] += v;
            acc[o + 1] += v;
            acc[o + 2] += v;
        }
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Port of `addAperture` in lensFlare.ts.
#[allow(clippy::too_many_arguments)]
fn add_aperture(
    acc: &mut [f64],
    cx: f64,
    cy: f64,
    blades: i64,
    rotation: f64,
    radius: f64,
    intensity: f64,
    ww: u32,
    hh: u32,
) {
    let outer = radius;
    let inner = radius * 0.82;
    let x0 = (cx - outer).floor().max(0.0) as i64;
    let y0 = (cy - outer).floor().max(0.0) as i64;
    let x1 = ((cx + outer).ceil() as i64).min(ww as i64 - 1);
    let y1 = ((cy + outer).ceil() as i64).min(hh as i64 - 1);
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist > outer {
                continue;
            }
            let ang = dy.atan2(dx) + rotation;
            let sector = (ang / std::f64::consts::PI) * blades as f64;
            let f = (sector - js_round(sector)).abs();
            let rad_at_angle = lerp(inner, outer, 1.0 - f);
            let inside = if dist <= rad_at_angle {
                1.0
            } else {
                let d = dist - rad_at_angle;
                (-(d * d) / (2.0 * 0.8)).exp()
            };
            let v = inside * intensity * 0.6;
            if v < 0.004 {
                continue;
            }
            let o = ((y as u32 * ww + x as u32) * 3) as usize;
            acc[o] += v;
            acc[o + 1] += v;
            acc[o + 2] += v;
        }
    }
}

/// Brightest-pixel scan (deterministic) — port of `findBrightest`.
fn find_brightest(data: &[u8], w: u32, h: u32) -> (u32, u32) {
    let mut best: i64 = -1;
    let mut best_lum = -1.0f64;
    for i in 0..(w * h) as usize {
        let o = i * 4;
        let lum =
            0.2126 * data[o] as f64 + 0.7152 * data[o + 1] as f64 + 0.0722 * data[o + 2] as f64;
        if lum > best_lum {
            best_lum = lum;
            best = i as i64;
        }
    }
    let best = best as usize;
    (best as u32 % w, best as u32 / w)
}

/// Apply the lens flare in place — port of `applyLensFlare`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params, quality: EffectQuality) {
    if w == 0 || h == 0 {
        return;
    }
    let brightness = p.f("brightness", 1.0).max(0.0);
    if brightness <= 0.0 {
        return;
    }
    let seed = js_round(p.f("seed", 0.0)) as i64 as u32;
    let scale = p.f("scale", 1.0).max(0.05);
    let base_radius = (w.min(h) as f64) * 0.09 * scale;
    let ghost_count = js_round(p.f("ghostCount", 4.0)).clamp(0.0, 8.0) as i64;
    let ghost_spacing = p.f("ghostSpacing", 0.8).max(0.0);
    let halo = clamp01(p.f("halo", 0.4));
    let blades = js_round(p.f("apertureBlades", 0.0)) as i64;
    let aperture_rotation = (p.f("apertureRotation", 0.0) * std::f64::consts::PI) / 180.0;
    let streak = clamp01(p.f("streakIntensity", 0.0));
    let anamorphic = clamp01(p.f("anamorphicRatio", 0.0));
    let dispersion = clamp01(p.f("chromaticDispersion", 0.0));
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => quality,
    };

    // Source position: explicit or brightest pixel.
    let mut sx = p.f("sourceX", -1.0);
    let mut sy = p.f("sourceY", -1.0);
    if sx < 0.0 || sy < 0.0 || sx > 1.0 || sy > 1.0 {
        let (bx, by) = find_brightest(out, w, h);
        sx = bx as f64 / w as f64;
        sy = by as f64 / h as f64;
    }
    let lx = w as f64 * clamp01(sx);
    let ly = h as f64 * clamp01(sy);

    let ax = w as f64 / 2.0 - lx;
    let ay = h as f64 / 2.0 - ly;
    let axis_len = (ax * ax + ay * ay).sqrt();
    let axis_len = if axis_len == 0.0 { 1.0 } else { axis_len };
    let ux = ax / axis_len;
    let uy = ay / axis_len;

    let n = (w * h) as usize;
    let mut acc = vec![0.0f64; n * 3];
    let brightness_factor = brightness
        * if tier == EffectQuality::Interactive {
            0.85
        } else {
            1.0
        };

    // Central halo.
    if halo > 0.0 {
        let hr = base_radius * 2.2;
        add_glow(
            &mut acc,
            lx,
            ly,
            hr,
            halo * 0.5 * brightness_factor,
            1.0,
            w,
            h,
        );
    }

    // Ghosts along the axis opposite the source.
    for i in 1..=ghost_count {
        let g = seeded01(seed.wrapping_add((i as u32).wrapping_mul(7919)));
        let dir = -1.0;
        let gx = lx + ux * dir * i as f64 * ghost_spacing * base_radius * 1.6;
        let gy = ly + uy * dir * i as f64 * ghost_spacing * base_radius * 1.6;
        let gr = base_radius * (0.55 - i as f64 * 0.04) * (0.7 + g * 0.6);
        let intensity = brightness_factor * (1.0 - i as f64 / (ghost_count + 1) as f64) * 0.8;
        if dispersion > 0.0 {
            let off = gr * dispersion;
            add_glow_channel(
                &mut acc,
                gx + off * ux,
                gy + off * uy,
                gr,
                intensity,
                0,
                w,
                h,
                1.0,
            );
            add_glow_channel(
                &mut acc,
                gx - off * ux,
                gy - off * uy,
                gr,
                intensity,
                2,
                w,
                h,
                1.0,
            );
            add_glow_channel(&mut acc, gx, gy, gr, intensity * 0.7, 1, w, h, 1.0);
        } else {
            add_glow(&mut acc, gx, gy, gr, intensity, 1.0, w, h);
        }
    }

    // Diffraction streaks (anamorphic-weighted cross).
    if streak > 0.0 {
        let sr = base_radius * (4.0 + anamorphic * 6.0);
        let sw = (base_radius * 0.045 * (1.0 - anamorphic * 0.6)).max(1.0);
        add_streak(
            &mut acc,
            lx,
            ly,
            ux,
            uy,
            sr,
            sw,
            streak * 0.9 * brightness_factor,
            w,
            h,
        );
        add_streak(
            &mut acc,
            lx,
            ly,
            -uy,
            ux,
            sr * (1.0 + anamorphic),
            sw * (1.0 + anamorphic),
            streak * 0.5 * brightness_factor,
            w,
            h,
        );
    }

    // Aperture polygon star.
    if blades >= 3 {
        let ar = base_radius * 1.5;
        add_aperture(
            &mut acc,
            lx,
            ly,
            blades,
            aperture_rotation,
            ar,
            brightness_factor * 0.55,
            w,
            h,
        );
    }

    // Composite additively.
    for i in 0..n {
        let o = i * 4;
        out[o] = clamp_byte(out[o] as f64 + acc[i * 3]);
        out[o + 1] = clamp_byte(out[o + 1] as f64 + acc[i * 3 + 1]);
        out[o + 2] = clamp_byte(out[o + 2] as f64 + acc[i * 3 + 2]);
    }
}
