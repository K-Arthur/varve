//! Palette Snap kernel — faithful port of
//! `packages/engine/src/liveEffects/paletteSnap.ts`.
//!
//! Nearest-colour matching can run in RGB, linear RGB, Lab, or OKLab, with an
//! optional dither pass (reusing the Dither kernel's primitives). Transparent
//! pixels stay transparent unless the palette itself has no alpha concept.

use crate::palette_core::{self, ColorMetric, PaletteLookup};
use crate::{clamp01, clamp_byte, CoordSpace, Params};

/// Apply palette snapping in place — port of `applyPaletteSnap`.
pub fn apply(out: &mut [u8], w: u32, h: u32, p: &Params) {
    if w == 0 || h == 0 {
        return;
    }

    let raw = p.rgb_list("colors");
    let colors_f64: Vec<[f64; 3]> =
        raw.iter().map(|c| [c[0] as f64, c[1] as f64, c[2] as f64]).collect();
    let colors = palette_core::sanitize_palette(&colors_f64);
    let amount = clamp01(p.f("amount", 1.0));
    let alpha_cutoff = clamp01(p.f("alphaCutoff", 0.0));
    if colors.is_empty() || amount <= 0.0 {
        return;
    }

    let metric = ColorMetric::parse(p.s("metric", "rgb"));
    let lookup = PaletteLookup::build(&colors, metric);

    let len = (w * h) as usize;
    for i in 0..len {
        let o = i * 4;
        let a = out[o + 3];
        if (a as f64) / 255.0 < alpha_cutoff || a == 0 {
            continue;
        }
        let c = lookup.find(out[o], out[o + 1], out[o + 2]);
        if amount >= 1.0 {
            out[o] = c[0];
            out[o + 1] = c[1];
            out[o + 2] = c[2];
        } else {
            out[o] = clamp_byte(out[o] as f64 + (c[0] as f64 - out[o] as f64) * amount);
            out[o + 1] =
                clamp_byte(out[o + 1] as f64 + (c[1] as f64 - out[o + 1] as f64) * amount);
            out[o + 2] =
                clamp_byte(out[o + 2] as f64 + (c[2] as f64 - out[o + 2] as f64) * amount);
        }
    }

    if p.b("dither", false) && p.f("ditherStrength", 0.0) > 0.0 {
        let deduped = palette_core::dedupe_palette(&colors);
        let dither_params = serde_json::json!({
            "algorithm": p.s("ditherAlgorithm", "floyd-steinberg"),
            "paletteMode": "custom",
            "levels": 4,
            "colors": deduped,
            "metric": p.s("metric", "rgb"),
            "serpentine": true,
            "strength": p.f("ditherStrength", 0.0),
            "bayerSize": 4,
            "cellSize": 1,
            "alphaCutoff": alpha_cutoff,
            "seed": p.f("seed", 0.0),
        });
        let dp = Params::new(&dither_params);
        // TS passes its `coordSpace` through, which paletteSnap callers leave
        // absent — the default (all-zero) CoordSpace anchors to the surface
        // grid exactly like `undefined` does in JS.
        crate::dither::apply(out, w, h, &dp, CoordSpace::default());
    }
}
