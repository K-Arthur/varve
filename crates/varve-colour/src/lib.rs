//! `varve-colour` — Colour-science crate with WASM bindings.
//!
//! Provides colour conversion functions (naive RGB↔CMYK, analytical
//! ICC-aware RGB→CMYK with profile-specific GCR/TAC), ICC profile
//! loading and transforms via `tintbox`, and bundled ICC profiles for
//! deterministic cross-target colour math.
//!
//! ## Architecture
//!
//! ```text
//! varve-colour
//!   ├── conversions   Analytical colour-space math (no ICC needed)
//!   ├── profiles      PrintProfile enum, ICC header validation, bundled data
//!   ├── icc           tintbox-based ICC transform engine
//!   └── lib           Re-exports + wasm-bindgen exports
//! ```
//!
//! Cross-target: all colour science is deterministic across native (tintbox)
//! and WASM (`wasm-bindgen`) builds — the same profile bytes are embedded,
//! the same arithmetic applies, and the same tolerance guarantees hold.

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

pub mod conversions;
pub mod icc;
pub mod profiles;

pub use conversions::{
    apply_tac, cmyk_to_rgb, engine_color_rgba, linear_rgb_to_xyz, linear_to_srgb, profile_gcr,
    profile_tac, rgb_to_cmyk, rgb_to_cmyk_icc, srgb_to_linear, xyz_to_linear_rgb,
};
pub use icc::{BundledProfile, IccEngine};
pub use profiles::{
    bundled_cmyk, bundled_srgb, parse_icc_profile_info, tetrahedral_interpolate,
    validate_icc_profile, PrintProfile, ProfileInfo, RenderingIntent,
};

/// Return the crate version string.
///
/// Useful for diagnostics and cross-target consistency checks.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn colour_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── WASM-bindgen exports ────────────────────────────────────────────────
//
// These are only compiled when the `wasm` feature is enabled (default in
// wasm-pack builds). They provide a stable, typed JS API for colour ops.
//
// All conversions return Vec<u8> in CHANNELS_4 format: [c0,c1,c2,c3] where
// each channel is u8 in range 0..=255. Buffer conversions return the packed
// output bytes directly.

#[wasm_bindgen]
pub fn wasm_rgb_to_cmyk(r: u8, g: u8, b: u8) -> Vec<u8> {
    let (c, m, y, k) = conversions::rgb_to_cmyk(r, g, b);
    vec![c, m, y, k]
}

/// Inverse CMYK → RGB (naive formula).
#[wasm_bindgen]
pub fn wasm_cmyk_to_rgb(c: u8, m: u8, y: u8, k: u8) -> Vec<u8> {
    let (r, g, b, a) = conversions::cmyk_to_rgb(c, m, y, k);
    vec![r, g, b, a]
}

/// Analytical ICC-aware RGB → CMYK using the pure-arithmetic pipeline.
///
/// `profile_name` must be one of: "Fogra39", "Gracol2006", "SwopCoated".
/// `rendering_intent` must be one of: "perceptual", "relative", "absolute", "saturation".
///
/// Returns `[C, M, Y, K]` as a 4-byte array, or an error if parameters are invalid.
#[wasm_bindgen]
pub fn wasm_rgb_to_cmyk_icc(
    r: u8,
    g: u8,
    b: u8,
    profile_name: &str,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    let profile = profiles::PrintProfile::parse(profile_name).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown print profile: '{profile_name}'. Expected: Fogra39, Gracol2006, SwopCoated"
        ))
    })?;

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown rendering intent: '{rendering_intent}'. Expected: perceptual, relative, absolute, saturation"
        ))
    })?;

    let (c, m, y, k) =
        conversions::rgb_to_cmyk_icc(profile, r, g, b, intent, black_point_compensation);
    Ok(vec![c, m, y, k])
}

/// Convert an sRGB pixel buffer to CMYK using a real ICC transform.
///
/// `profile_data` must be the raw bytes of a valid ICC CMYK profile.
/// `rendering_intent` can be "perceptual" (default), "relative", "absolute", or "saturation".
///
/// On success, returns a Uint8Array of length `(data.len() / 3) * 4` containing
/// packed CMYK pixels (C, M, Y, K per pixel).
#[wasm_bindgen]
pub fn wasm_convert_srgb_buffer_to_cmyk(
    data: Vec<u8>,
    profile_data: Vec<u8>,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    if data.len() % 3 != 0 {
        return Err(JsValue::from_str(&format!(
            "Input data length {} is not a multiple of 3 (RGB)",
            data.len()
        )));
    }

    let n_pixels = data.len() / 3;
    if n_pixels == 0 {
        return Ok(Vec::new());
    }

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent)
        .unwrap_or(profiles::RenderingIntent::Perceptual);

    // Build a temporary ICC engine with the provided profile
    let mut engine = crate::icc::IccEngine::new();
    engine
        .load_all_for_print()
        .map_err(|e| JsValue::from_str(&e))?;
    engine
        .load_bytes("user_cmyk", &profile_data)
        .map_err(|e| JsValue::from_str(&e))?;

    // Convert the flat buffer to &[(u8,u8,u8)]
    let rgb_pixels: Vec<(u8, u8, u8)> = data
        .chunks_exact(3)
        .map(|chunk| (chunk[0], chunk[1], chunk[2]))
        .collect();

    let result = engine
        .srgb_buffer_to_cmyk("user_cmyk", &rgb_pixels, intent, black_point_compensation)
        .map_err(|e| JsValue::from_str(&e))?;

    // Flatten back to Vec<u8>
    let mut out = Vec::with_capacity(result.len() * 4);
    for (c, m, y, k) in result {
        out.push(c);
        out.push(m);
        out.push(y);
        out.push(k);
    }
    Ok(out)
}

/// Validate that a byte slice is a structurally valid ICC profile.
///
/// Checks the 128-byte header for correct magic, profile class, colour space,
/// and PCS signature fields. Returns `true` if the profile passes structural
/// validation.
#[wasm_bindgen]
pub fn wasm_validate_colour_profile(data: Vec<u8>) -> bool {
    profiles::validate_icc_profile(&data).is_ok()
}

/// Read ICC profile header metadata.
///
/// Returns a JSON object with fields: size, version, device_class, color_space,
/// pcs, rendering_intent, manufacturer, model, flags, creator.
/// Returns an error if the data is too short for ICC header parsing.
#[wasm_bindgen]
pub fn wasm_colour_profile_info(data: Vec<u8>) -> Result<String, JsValue> {
    let info = profiles::parse_icc_profile_info(&data).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&info).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Batch convert multiple sRGB pixels to CMYK using the analytical pipeline.
///
/// `data` is a flat Uint8Array of RGB bytes (length must be multiple of 3).
/// Returns a flat Uint8Array of CMYK bytes (length = data.length / 3 * 4).
///
/// This uses the analytical pipeline (`rgb_to_cmyk_icc`) — no ICC profile data needed.
#[wasm_bindgen]
pub fn wasm_batch_rgb_to_cmyk_icc(
    data: Vec<u8>,
    profile_name: &str,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    if data.len() % 3 != 0 {
        return Err(JsValue::from_str(&format!(
            "Input data length {} is not a multiple of 3 (RGB)",
            data.len()
        )));
    }

    let profile = profiles::PrintProfile::parse(profile_name).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown print profile: '{profile_name}'. Expected: Fogra39, Gracol2006, SwopCoated"
        ))
    })?;

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent).ok_or_else(|| {
        JsValue::from_str(&format!("Unknown rendering intent: '{rendering_intent}'"))
    })?;

    let n_pixels = data.len() / 3;
    let mut out = Vec::with_capacity(n_pixels * 4);

    for chunk in data.chunks_exact(3) {
        let (c, m, y, k) = conversions::rgb_to_cmyk_icc(
            profile,
            chunk[0],
            chunk[1],
            chunk[2],
            intent,
            black_point_compensation,
        );
        out.push(c);
        out.push(m);
        out.push(y);
        out.push(k);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_version_non_empty() {
        let v = colour_version();
        assert!(!v.is_empty(), "version should not be empty");
    }

    #[test]
    fn rgb_to_cmyk_via_pub_re_export() {
        let (c, m, y, k) = conversions::rgb_to_cmyk(0, 0, 0);
        assert_eq!((c, m, y, k), (0, 0, 0, 255));
    }

    #[test]
    fn cmyk_to_rgb_via_pub_re_export() {
        let (r, g, b, _a) = conversions::cmyk_to_rgb(0, 0, 0, 0);
        assert_eq!((r, g, b), (255, 255, 255));
    }

    #[test]
    fn bundled_profiles_accessible() {
        let srgb = profiles::bundled_srgb();
        assert!(srgb.len() > 128);
        let cmyk = profiles::bundled_cmyk();
        assert!(cmyk.len() > 128);
    }

    #[test]
    fn validate_bundled_profiles() {
        assert!(profiles::validate_icc_profile(profiles::bundled_srgb()).is_ok());
        assert!(profiles::validate_icc_profile(profiles::bundled_cmyk()).is_ok());
    }

    #[test]
    fn parse_bundled_profile_info() {
        let info = profiles::parse_icc_profile_info(profiles::bundled_srgb()).unwrap();
        assert_eq!(info.color_space, "RGB");
        assert_eq!(info.device_class, "mntr");

        let info = profiles::parse_icc_profile_info(profiles::bundled_cmyk()).unwrap();
        assert_eq!(info.color_space, "CMYK");
        assert_eq!(info.device_class, "prtr");
    }

    #[test]
    fn engine_color_rgba_rgb() {
        let color = varve_core::EngineColor::Rgb {
            r: 57.0,
            g: 208.0,
            b: 198.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
        let (r, g, b, a) = engine_color_rgba(&color);
        assert_eq!((r, g, b, a), (57, 208, 198, 255));
    }

    #[test]
    fn engine_color_rgba_cmyk() {
        let color = varve_core::EngineColor::Cmyk {
            c: 0.0,
            m: 255.0,
            y: 255.0,
            k: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
        let (r, _g, b, _a) = engine_color_rgba(&color);
        assert_eq!(r, 255);
        assert_eq!(b, 0);
    }

    #[test]
    fn tetrahedral_interpolate_re_exported() {
        let table = vec![0.0f32; 2 * 2 * 2 * 4];
        let result = tetrahedral_interpolate([0.5, 0.5, 0.5], 2, &table);
        assert_eq!(result, [0.0; 4]);
    }

    // ── Cross-target agreement helper test ───────────────────────────
    //
    // This test verifies that the naive RGB→CMYK function produces identical
    // results regardless of the container. The ICC path (via tintbox) is
    // inherently deterministic because tintbox itself is deterministic, but
    // can only be tested natively. WASM-side tests validate the same functions
    // via wasm-bindgen-test or a Node.js test runner (see CI config).

    #[test]
    fn naive_cmyk_deterministic() {
        // Run 5 times, all must produce identical results
        let input = (128u8, 64u8, 192u8);
        let expected = rgb_to_cmyk(input.0, input.1, input.2);
        for _ in 0..10 {
            assert_eq!(rgb_to_cmyk(input.0, input.1, input.2), expected);
        }
    }

    #[test]
    fn icc_analytical_cmyk_deterministic() {
        let input = (128u8, 64u8, 192u8);
        let expected = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            input.0,
            input.1,
            input.2,
            RenderingIntent::Perceptual,
            false,
        );
        for _ in 0..10 {
            assert_eq!(
                rgb_to_cmyk_icc(
                    PrintProfile::Fogra39,
                    input.0,
                    input.1,
                    input.2,
                    RenderingIntent::Perceptual,
                    false,
                ),
                expected
            );
        }
    }
}
