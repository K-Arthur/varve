//! Native live-effects kernels — deterministic RGBA image filters.
//!
//! These kernels are faithful ports of the TypeScript reference
//! implementations in `packages/engine/src/liveEffects/`. The TS kernels are
//! the byte-level reference; this crate replicates their arithmetic exactly:
//!
//! - all math in `f64` (JS numbers),
//! - `js_round` replicates JS `Math.round` (floor(x + 0.5)),
//! - integer hashes (mulberry32, hash2, hash3) use `u32` wrapping
//!   multiplication, matching JS `Math.imul` bit patterns,
//! - sRGB transfer curves match the TS `srgbToLinear01` / `linearToSrgb01`.
//!
//! The unified entry point is [`apply_effect`]: raw RGBA bytes in, raw RGBA
//! bytes out, with an [`EffectRequest`] describing kind, quality, coordinate
//! space, and kind-specific parameters (camelCase keys, TS defaults).
//!
//! Deterministic by construction: no wall-clock state, no floats from
//! division of independent paths — same input, same bytes.

pub mod blur;
pub mod bloom;
pub mod caustics;
pub mod crt;
pub mod dither;
pub mod lens_flare;
pub mod light_leak;
pub mod light_shafts;
pub mod palette_core;
pub mod palette_snap;
pub mod prng;
pub mod quality;
pub mod rgb_split;
pub mod vhs;

use serde::{Deserialize, Serialize};

/// Live-effect kinds — mirrors `AdjustmentKind` for the live-effects family
/// in `packages/engine/src/filters.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectKind {
    Dither,
    PaletteSnap,
    Bloom,
    RgbSplit,
    Crt,
    Vhs,
    LightShafts,
    LensFlare,
    LightLeak,
    Caustics,
}

/// Render quality tier — mirrors `liveEffects/quality.ts` `EffectQuality`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EffectQuality {
    #[default]
    Normal,
    Interactive,
    Export,
}

/// Coordinate space used to anchor document-space parameters (dither cells,
/// split offsets, bloom radii) so effects do not change under pan/zoom.
/// Mirrors `CoordSpace` in `liveEffects/dither.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoordSpace {
    pub scale: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub region_x: f64,
    pub region_y: f64,
}

/// Wire request for [`apply_effect`]. `params` is a JSON object with the
/// camelCase keys of the matching TS kernel interface; missing keys fall back
/// to the TS defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRequest {
    pub effect: EffectKind,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub quality: EffectQuality,
    #[serde(default)]
    pub coord_space: Option<CoordSpace>,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// JS `Math.round`: floor(x + 0.5). Rust `round()` rounds halves away from
/// zero, which differs from JS for negative halves; all kernels use this.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Clamp + round to a byte, matching the TS `clampByte` convention
/// (max(0, min(255, round(v)))).
pub fn clamp_byte(v: f64) -> u8 {
    let r = js_round(v);
    if r <= 0.0 {
        0
    } else if r >= 255.0 {
        255
    } else {
        r as u8
    }
}

/// Clamp to [0, 1], matching the TS `clamp01` helper.
pub fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

/// Typed accessor over the `params` JSON object with TS-style defaults.
pub struct Params<'a> {
    value: &'a serde_json::Value,
}

impl<'a> Params<'a> {
    pub fn new(value: &'a serde_json::Value) -> Self {
        Self { value }
    }

    pub fn f(&self, key: &str, default: f64) -> f64 {
        self.value
            .get(key)
            .and_then(|v| v.as_f64())
            .unwrap_or(default)
    }

    pub fn b(&self, key: &str, default: bool) -> bool {
        self.value
            .get(key)
            .and_then(|v| v.as_bool())
            .unwrap_or(default)
    }

    pub fn u32(&self, key: &str, default: u32) -> u32 {
        self.value
            .get(key)
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(default)
    }

    pub fn i32(&self, key: &str, default: i32) -> i32 {
        self.value
            .get(key)
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(default)
    }

    /// String value (e.g. `composite`, `mode`, `seedMode`).
    pub fn s<'b>(&self, key: &str, default: &'b str) -> &'b str
    where
        'a: 'b,
    {
        self.value
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or(default)
    }

    /// Optional RGB triplet array `[r, g, b]` (0..255); None if absent.
    pub fn rgb(&self, key: &str) -> Option<[f64; 3]> {
        let arr = self.value.get(key)?.as_array()?;
        if arr.len() < 3 {
            return None;
        }
        Some([
            arr[0].as_f64()?,
            arr[1].as_f64()?,
            arr[2].as_f64()?,
        ])
    }

    /// Array of RGB triplets (palette), e.g. `palette: [[r,g,b], ...]`.
    pub fn rgb_list(&self, key: &str) -> Vec<[u8; 3]> {
        let mut out = Vec::new();
        if let Some(arr) = self.value.get(key).and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(triple) = item.as_array() {
                    if triple.len() >= 3 {
                        if let (Some(r), Some(g), Some(b)) = (
                            triple[0].as_f64(),
                            triple[1].as_f64(),
                            triple[2].as_f64(),
                        ) {
                            out.push([r as u8, g as u8, b as u8]);
                        }
                    }
                }
            }
        }
        out
    }
}

/// Length check helper for untrusted raster inputs: rejects overflow-prone
/// dimension products and empty surfaces.
pub fn validate_surface(width: u32, height: u32, rgba_len: usize) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Effect surface must be non-empty".into());
    }
    let expected = (u64::from(width) * u64::from(height))
        .checked_mul(4)
        .ok_or_else(|| "Effect surface dimensions overflow".to_string())?;
    if expected as usize != rgba_len {
        return Err(format!(
            "Effect surface byte length mismatch: expected {expected}, got {rgba_len}"
        ));
    }
    Ok(())
}

/// Apply a live effect to RGBA bytes in place, returning the result.
pub fn apply_effect(
    request: &EffectRequest,
    rgba: &[u8],
) -> Result<Vec<u8>, String> {
    validate_surface(request.width, request.height, rgba.len())?;
    let params = Params::new(&request.params);
    let coord = request.coord_space.unwrap_or_default();
    let mut out = rgba.to_vec();
    match request.effect {
        EffectKind::Dither => dither::apply(&mut out, request.width, request.height, &params, coord),
        EffectKind::PaletteSnap => palette_snap::apply(&mut out, request.width, request.height, &params),
        EffectKind::Bloom => bloom::apply(&mut out, request.width, request.height, &params, request.quality, coord)?,
        EffectKind::RgbSplit => rgb_split::apply(&mut out, request.width, request.height, &params, coord),
        EffectKind::Crt => crt::apply(&mut out, request.width, request.height, &params),
        EffectKind::Vhs => vhs::apply(&mut out, request.width, request.height, &params, request.quality),
        EffectKind::LightShafts => light_shafts::apply(&mut out, request.width, request.height, &params, request.quality),
        EffectKind::LensFlare => lens_flare::apply(&mut out, request.width, request.height, &params, request.quality),
        EffectKind::LightLeak => light_leak::apply(&mut out, request.width, request.height, &params),
        EffectKind::Caustics => caustics::apply(&mut out, request.width, request.height, &params, request.quality, coord)?,
    }
    Ok(out)
}
