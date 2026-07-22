//! Analytical colour-space conversion functions.
//!
//! Provides naive RGB↔CMYK transforms, sRGB↔linear↔XYZ↔Lab pipelines,
//! ICC-aware RGB→CMYK with profile-specific GCR and TAC, and engine-color
//! utility functions shared by the print pipeline and WASM exports.
//!
//! Research basis: ISO 15930 (PDF/X), ICC color management, sRGB (IEC 61966-2-1),
//! Bruce Lindbloom's colour equations. Each function documents its numeric
//! domain and tolerance expectations.

use crate::profiles::{PrintProfile, RenderingIntent};

/// Naive RGB to CMYK conversion (no ICC profile).
///
/// Uses the standard inverse: C = 1−R, M = 1−G, Y = 1−B, K = min(C,M,Y).
/// All channels in 0..=255 range. Output values are rounded to nearest u8.
///
/// Cross-target deterministic: pure arithmetic, no ICC profile dependency.
pub fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let k = 1.0 - rf.max(gf).max(bf);
    if k >= 1.0 {
        return (0, 0, 0, 255);
    }
    let c = (1.0 - rf - k) / (1.0 - k);
    let m = (1.0 - gf - k) / (1.0 - k);
    let y = (1.0 - bf - k) / (1.0 - k);

    (
        (c * 255.0).round() as u8,
        (m * 255.0).round() as u8,
        (y * 255.0).round() as u8,
        (k * 255.0).round() as u8,
    )
}

/// Inverse naive CMYK → RGB conversion.
///
/// Uses the standard formula: R = (1−C)(1−K), G = (1−M)(1−K), B = (1−Y)(1−K).
/// This is the inverse of `rgb_to_cmyk` and produces numerically consistent
/// round-trips for lossless colour triples. All channels in 0..=255 range.
pub fn cmyk_to_rgb(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8, u8) {
    let cf = c as f32 / 255.0;
    let mf = m as f32 / 255.0;
    let yf = y as f32 / 255.0;
    let kf = k as f32 / 255.0;

    let r = (1.0 - cf) * (1.0 - kf);
    let g = (1.0 - mf) * (1.0 - kf);
    let b = (1.0 - yf) * (1.0 - kf);

    (
        (r * 255.0).round() as u8,
        (g * 255.0).round() as u8,
        (b * 255.0).round() as u8,
        255,
    )
}

/// sRGB gamma expansion (linearise).
///
/// Transforms an sRGB-encoded channel value (0..=1) to linear intensity.
/// Uses the piecewise sRGB transfer function defined in IEC 61966-2-1.
pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear RGB to sRGB encoding (gamma compress).
///
/// Inverse of `srgb_to_linear`. Linear intensity → sRGB-encoded value (0..=1).
pub fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// Linear RGB to CIE XYZ (D50 adapted via Bradford).
///
/// Matrix is sRGB-to-XYZ (D65) × Bradford D65→D50 chromatic adaptation.
pub fn linear_rgb_to_xyz(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let x = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b;
    let y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b;
    let z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b;
    (x, y, z)
}

/// CIE XYZ to linear RGB (inverse of D50-adapted sRGB→XYZ matrix).
pub fn xyz_to_linear_rgb(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let r = 3.133_856 * x - 1.616_866_7 * y - 0.490_614_6 * z;
    let g = -0.978_768_4 * x + 1.916_141_5 * y + 0.033_454_0 * z;
    let b = 0.071_945_3 * x - 0.228_991_4 * y + 1.405_242_7 * z;
    (r, g, b)
}

/// CIE L* function: perceptual lightness from luminance ratio.
fn lab_f(t: f32) -> f32 {
    let delta: f32 = 6.0 / 29.0;
    if t > delta * delta * delta {
        t.powf(1.0 / 3.0)
    } else {
        t / (3.0 * delta * delta) + 4.0 / 29.0
    }
}

/// Inverse CIE L* function: luminance ratio from perceptual lightness.
fn lab_f_inv(t: f32) -> f32 {
    let delta: f32 = 6.0 / 29.0;
    if t > delta {
        t * t * t
    } else {
        3.0 * delta * delta * (t - 4.0 / 29.0)
    }
}

/// CIE XYZ to CIELAB (D50 reference white).
///
/// Reference white is D50 (Xₙ=0.9642, Yₙ=1.0, Zₙ=0.8249).
pub fn xyz_to_lab(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let xn = 0.9642;
    let yn = 1.0;
    let zn = 0.8249;

    let l = 116.0 * lab_f(y / yn) - 16.0;
    let a = 500.0 * (lab_f(x / xn) - lab_f(y / yn));
    let b = 200.0 * (lab_f(y / yn) - lab_f(z / zn));

    (l, a, b)
}

/// CIELAB to CIE XYZ (D50 reference white).
pub fn lab_to_xyz(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    let xn = 0.9642;
    let yn = 1.0;
    let zn = 0.8249;

    let fy = (l + 16.0) / 116.0;
    let fx = a / 500.0 + fy;
    let fz = fy - b / 200.0;

    let x = xn * lab_f_inv(fx);
    let y = yn * lab_f_inv(fy);
    let z = zn * lab_f_inv(fz);

    (x, y, z)
}

/// Get GCR (Gray Component Replacement) strength for a print profile.
pub fn profile_gcr(profile: PrintProfile) -> f32 {
    match profile {
        PrintProfile::Fogra39 => 0.35,
        PrintProfile::Gracol2006 => 0.25,
        PrintProfile::SwopCoated => 0.30,
    }
}

/// Get TAC (Total Area Coverage) limit percentage for a print profile.
pub fn profile_tac(profile: PrintProfile) -> f32 {
    match profile {
        PrintProfile::Fogra39 => 300.0,
        PrintProfile::Gracol2006 => 320.0,
        PrintProfile::SwopCoated => 300.0,
    }
}

/// Apply Total Area Coverage (TAC) limit to CMYK values.
///
/// If C+M+Y+K exceeds the TAC limit, scales CMY proportionally
/// to bring the total under the limit, preserving K.
pub fn apply_tac(cmyk: &mut [f32; 4], tac_limit: f32) {
    let total = cmyk[0] + cmyk[1] + cmyk[2] + cmyk[3];
    let total_pct = total * 100.0;
    if total_pct > tac_limit {
        let scale = (tac_limit / 100.0 - cmyk[3]) / (cmyk[0] + cmyk[1] + cmyk[2]);
        if scale > 0.0 && scale < 1.0 {
            cmyk[0] *= scale;
            cmyk[1] *= scale;
            cmyk[2] *= scale;
        }
    }
}

/// Full analytical ICC-aware RGB→CMYK conversion with profile dispatch.
///
/// Pipeline: sRGB → linear → XYZ(D50) → CIELAB → CMYK.
///
/// `profile` determines GCR strength and TAC limit:
/// - Fogra39: GCR 0.35, TAC 300%
/// - GRACoL:  GCR 0.25, TAC 320%
/// - SWOP:    GCR 0.30, TAC 300%
///
/// Supports all 4 rendering intents.
///
/// Cross-target: deterministic pure arithmetic, no external profile data needed.
pub fn rgb_to_cmyk_icc(
    profile: PrintProfile,
    r: u8,
    g: u8,
    b: u8,
    intent: RenderingIntent,
    black_point_compensation: bool,
) -> (u8, u8, u8, u8) {
    let mut rf = r as f32 / 255.0;
    let mut gf = g as f32 / 255.0;
    let mut bf = b as f32 / 255.0;

    if black_point_compensation {
        let brightness = 0.299 * rf + 0.587 * gf + 0.114 * bf;
        if brightness < 0.2 {
            let scale = brightness / 0.2;
            rf *= scale;
            gf *= scale;
            bf *= scale;
        }
    }

    match intent {
        RenderingIntent::Saturation => {
            let gray = (rf + gf + bf) / 3.0;
            rf = gray + (rf - gray) * 1.3;
            gf = gray + (gf - gray) * 1.3;
            bf = gray + (bf - gray) * 1.3;
        }
        RenderingIntent::Absolute | RenderingIntent::Relative | RenderingIntent::Perceptual => {}
    }

    let r_lin = srgb_to_linear(rf);
    let g_lin = srgb_to_linear(gf);
    let b_lin = srgb_to_linear(bf);
    let (_x, y, _z) = linear_rgb_to_xyz(r_lin, g_lin, b_lin);

    let ln = lab_f(y / 1.0).clamp(0.0, 1.0);
    let k_base = (1.0 - ln).clamp(0.0, 1.0);

    let k_cmy = 1.0 - rf.max(gf).max(bf);
    let (mut c, mut m, mut y_c) = if k_cmy >= 1.0 {
        (0.0, 0.0, 0.0)
    } else {
        (
            (1.0 - rf - k_cmy) / (1.0 - k_cmy),
            (1.0 - gf - k_cmy) / (1.0 - k_cmy),
            (1.0 - bf - k_cmy) / (1.0 - k_cmy),
        )
    };

    let gcr_strength = profile_gcr(profile);
    let common = c.min(m).min(y_c);
    let gcr = common * gcr_strength * k_base;
    c = (c - gcr).clamp(0.0, 1.0);
    m = (m - gcr).clamp(0.0, 1.0);
    y_c = (y_c - gcr).clamp(0.0, 1.0);

    let k = k_cmy.max(k_base * 0.8);

    let mut cmyk = [c, m, y_c, k];

    let tac_limit = profile_tac(profile);
    apply_tac(&mut cmyk, tac_limit);

    (
        (cmyk[0] * 255.0).round() as u8,
        (cmyk[1] * 255.0).round() as u8,
        (cmyk[2] * 255.0).round() as u8,
        (cmyk[3] * 255.0).round() as u8,
    )
}

/// Convert an `EngineColor` (from strata-core) to RGBA bytes.
///
/// This is the single entry point for colour emission in the print pipeline.
/// - RGB: straight pass-through (f64 channels truncated to u8).
/// - CMYK: inverse naive formula → RGB.
/// - Gray: neutral R=G=B.
/// - Spot: use process fallback CMYK → RGB, or black if no fallback.
pub fn engine_color_rgba(color: &strata_core::EngineColor) -> (u8, u8, u8, u8) {
    match color {
        strata_core::EngineColor::Rgb { r, g, b, a, .. } => {
            (*r as u8, *g as u8, *b as u8, *a as u8)
        }
        strata_core::EngineColor::Cmyk { c, m, y, k, a, .. } => {
            let rc = 1.0 - (c / 255.0);
            let rm = 1.0 - (m / 255.0);
            let ry = 1.0 - (y / 255.0);
            let rk = 1.0 - (k / 255.0);
            (
                (255.0 * rc * rk) as u8,
                (255.0 * rm * rk) as u8,
                (255.0 * ry * rk) as u8,
                *a as u8,
            )
        }
        strata_core::EngineColor::Gray { v, a, .. } => (*v as u8, *v as u8, *v as u8, *a as u8),
        strata_core::EngineColor::Spot {
            process_fallback,
            tint,
            a,
            ..
        } => {
            if let Some(fb) = process_fallback {
                let rc = 1.0 - (fb.c / 255.0);
                let rm = 1.0 - (fb.m / 255.0);
                let ry = 1.0 - (fb.y / 255.0);
                let rk = 1.0 - (fb.k / 255.0);
                (
                    (255.0 * rc * rk) as u8,
                    (255.0 * rm * rk) as u8,
                    (255.0 * ry * rk) as u8,
                    ((*a * tint / 100.0) as u8),
                )
            } else {
                (0, 0, 0, *a as u8)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::PrintProfile;
    use crate::profiles::RenderingIntent;

    // ── Naive RGB↔CMYK ──────────────────────────────────────────────

    #[test]
    fn naive_rgb_to_cmyk_black() {
        assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
    }

    #[test]
    fn naive_rgb_to_cmyk_white() {
        assert_eq!(rgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
    }

    #[test]
    fn naive_rgb_to_cmyk_red() {
        let (c, m, y, k) = rgb_to_cmyk(255, 0, 0);
        assert!(m > 200, "magenta should be high for red");
        assert!(y > 200, "yellow should be high for red");
        assert!(c < 50, "cyan should be low for red");
        assert!(k < 50, "key should be low for red");
    }

    #[test]
    fn naive_rgb_to_cmyk_green() {
        let (c, m, y, _k) = rgb_to_cmyk(0, 255, 0);
        assert!(c > 200, "cyan should be high for green");
        assert!(y > 200, "yellow should be high for green");
        assert!(m < 50, "magenta should be low for green");
    }

    #[test]
    fn naive_roundtrip_rgb_to_cmyk() {
        let colors: [(u8, u8, u8); 5] = [
            (255, 0, 0),
            (0, 255, 0),
            (0, 0, 255),
            (128, 128, 128),
            (42, 99, 177),
        ];
        for &(r, g, b) in &colors {
            let (c, m, y, k) = rgb_to_cmyk(r, g, b);
            let (r2, g2, b2, _a) = cmyk_to_rgb(c, m, y, k);
            // Naive roundtrip loses information; check reconstruction is plausible
            let dr = (r as i16 - r2 as i16).abs();
            let dg = (g as i16 - g2 as i16).abs();
            let db = (b as i16 - b2 as i16).abs();
            assert!(
                dr <= 2 && dg <= 2 && db <= 2,
                "roundtrip ({r},{g},{b}) → ({c},{m},{y},{k}) → ({r2},{g2},{b2}) dr={dr} dg={dg} db={db}"
            );
        }
    }

    #[test]
    fn cmyk_to_rgb_known() {
        let (r, g, b, _a) = cmyk_to_rgb(0, 0, 0, 0);
        assert_eq!((r, g, b), (255, 255, 255)); // no ink → white
    }

    #[test]
    fn cmyk_to_rgb_full_black() {
        let (r, g, b, _a) = cmyk_to_rgb(0, 0, 0, 255);
        assert_eq!((r, g, b), (0, 0, 0)); // all black → black
    }

    // ── sRGB linearisation ──────────────────────────────────────────

    #[test]
    fn srgb_to_linear_black() {
        assert_eq!(srgb_to_linear(0.0), 0.0);
    }

    #[test]
    fn srgb_to_linear_white() {
        assert_eq!(srgb_to_linear(1.0), 1.0);
    }

    #[test]
    fn srgb_to_linear_midpoint() {
        let v = srgb_to_linear(0.5);
        assert!((v - 0.214).abs() < 0.001, "got {v}");
    }

    #[test]
    fn linear_roundtrip() {
        let values = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0];
        for &v in &values {
            let l = srgb_to_linear(v);
            let back = linear_to_srgb(l);
            let diff = (v - back).abs();
            assert!(diff < 0.001, "roundtrip {v} → {l} → {back} diff={diff}");
        }
    }

    // ── XYZ / Lab roundtrip ─────────────────────────────────────────

    #[test]
    fn xyz_to_lab_known_white() {
        let (l, a, b) = xyz_to_lab(0.9642, 1.0, 0.8249);
        assert!(
            (l - 100.0).abs() < 1.0,
            "L* should be ~100 for white, got {l}"
        );
        assert!(a.abs() < 1.0, "a* should be ~0 for white, got {a}");
        assert!(b.abs() < 1.0, "b* should be ~0 for white, got {b}");
    }

    #[test]
    fn lab_roundtrip() {
        let test_xyz = [(0.3, 0.3, 0.3), (0.1, 0.5, 0.05), (0.9642, 1.0, 0.8249)];
        for &(x, y, z) in &test_xyz {
            let (l, a, b) = xyz_to_lab(x, y, z);
            let (x2, y2, z2) = lab_to_xyz(l, a, b);
            let dx = (x - x2).abs();
            let dy = (y - y2).abs();
            let dz = (z - z2).abs();
            assert!(
                dx < 0.01 && dy < 0.01 && dz < 0.01,
                "Lab roundtrip ({x},{y},{z}) → ({l},{a},{b}) → ({x2},{y2},{z2})"
            );
        }
    }

    // ── ICC-aware CMYK ──────────────────────────────────────────────

    #[test]
    fn icc_cmyk_preserves_white() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            255,
            255,
            RenderingIntent::Perceptual,
            true,
        );
        assert!(c < 40, "cyan should be low for white, got {c}");
        assert!(m < 40, "magenta should be low for white, got {m}");
        assert!(y < 40, "yellow should be low for white, got {y}");
        assert!(k < 40, "key should be low for white, got {k}");
    }

    #[test]
    fn icc_cmyk_black_has_high_k() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            0,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k > 200, "K should be high for black, got {k}");
        assert!(c < 100, "C should be low for black, got {c}");
    }

    #[test]
    fn icc_cmyk_red_expected() {
        let (_c, m, y, _k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(m > 100, "magenta should be high for red, got {m}");
        assert!(y > 100, "yellow should be high for red, got {y}");
    }

    #[test]
    fn rendering_intent_variants() {
        let intents = [
            RenderingIntent::Perceptual,
            RenderingIntent::Relative,
            RenderingIntent::Absolute,
            RenderingIntent::Saturation,
        ];
        for intent in &intents {
            let (c, m, y, k) = rgb_to_cmyk_icc(PrintProfile::Fogra39, 128, 64, 192, *intent, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(
                total > 0,
                "all channels should not be zero for intent {intent:?}"
            );
        }
    }

    #[test]
    fn icc_cmyk_profile_differentiation() {
        let gcr_vals = [
            profile_gcr(PrintProfile::Fogra39),
            profile_gcr(PrintProfile::Gracol2006),
            profile_gcr(PrintProfile::SwopCoated),
        ];
        let tac_vals = [
            profile_tac(PrintProfile::Fogra39),
            profile_tac(PrintProfile::Gracol2006),
            profile_tac(PrintProfile::SwopCoated),
        ];
        let gcr_all_same = gcr_vals[0] == gcr_vals[1] && gcr_vals[1] == gcr_vals[2];
        let tac_all_same = tac_vals[0] == tac_vals[1] && tac_vals[1] == tac_vals[2];
        assert!(
            !gcr_all_same || !tac_all_same,
            "profiles should differ in GCR or TAC: GCR={gcr_vals:?} TAC={tac_vals:?}"
        );
        let profiles = [
            PrintProfile::Fogra39,
            PrintProfile::Gracol2006,
            PrintProfile::SwopCoated,
        ];
        for profile in &profiles {
            let (c, m, y, k) =
                rgb_to_cmyk_icc(*profile, 180, 100, 60, RenderingIntent::Perceptual, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(total > 0, "profile {profile:?} produced all-zero CMYK");
        }
    }

    #[test]
    fn icc_cmyk_black_point_compensation() {
        let (_, _, _, k_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            true,
        );
        let (_, _, _, k_no_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k_bpc > 0 || k_no_bpc > 0, "both should produce K");
    }

    #[test]
    fn icc_cmyk_fogra39_gcr() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            100,
            100,
            100,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(
            k > 50,
            "Fogra39 neutral gray K should be substantial, got {k}"
        );
        assert!(c < 50, "Fogra39 C should be low for neutral gray, got {c}");
    }

    #[test]
    fn icc_cmyk_gracol_tac() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Gracol2006,
            0,
            0,
            255,
            RenderingIntent::Perceptual,
            false,
        );
        let total = c as u32 + m as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        assert!(
            total <= 820,
            "GRACoL TAC 320% should limit total, got {total}"
        );
    }

    #[test]
    fn icc_cmyk_swop_tac() {
        let (c, _m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::SwopCoated,
            0,
            100,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        let total = c as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        assert!(
            total <= 770,
            "SWOP TAC 300% should limit total, got {total}"
        );
    }

    // ── EngineColor conversion ──────────────────────────────────────

    fn make_rgb(r: f64, g: f64, b: f64, a: f64) -> strata_core::EngineColor {
        strata_core::EngineColor::Rgb {
            r,
            g,
            b,
            a,
            bit_depth: None,
            profile: None,
        }
    }

    fn make_cmyk(c: f64, m: f64, y: f64, k: f64, a: f64) -> strata_core::EngineColor {
        strata_core::EngineColor::Cmyk {
            c,
            m,
            y,
            k,
            a,
            bit_depth: None,
            profile: None,
        }
    }

    fn make_gray(v: f64, a: f64) -> strata_core::EngineColor {
        strata_core::EngineColor::Gray {
            v,
            a,
            bit_depth: None,
            profile: None,
        }
    }

    #[test]
    fn engine_color_rgb_passthrough() {
        let (r, g, b, a) = engine_color_rgba(&make_rgb(57.0, 208.0, 198.0, 255.0));
        assert_eq!((r, g, b, a), (57, 208, 198, 255));
    }

    #[test]
    fn engine_color_cmyk_to_rgb() {
        let (r, g, b, _a) = engine_color_rgba(&make_cmyk(0.0, 255.0, 255.0, 0.0, 255.0));
        // Magenta + Yellow = Red in CMY, so: R=255, G=0, B=0
        assert_eq!((r, b), (255, 0), "red channel, blue channel");
        assert!(g < 50, "green should be low, got {g}");
    }

    #[test]
    fn engine_color_gray() {
        let (r, g, b, a) = engine_color_rgba(&make_gray(128.0, 200.0));
        assert_eq!((r, g, b), (128, 128, 128));
        assert_eq!(a, 200);
    }

    #[test]
    fn engine_color_spot_with_fallback() {
        let spot = strata_core::EngineColor::Spot {
            name: "PANTONE 185 C".into(),
            tint: 80.0,
            a: 255.0,
            process_fallback: Some(strata_core::CmykFallback {
                c: 0.0,
                m: 255.0,
                y: 255.0,
                k: 0.0,
            }),
        };
        let (r, g, b, a) = engine_color_rgba(&spot);
        assert_eq!(r, 255);
        assert!(g < 50, "green should be low for red spot");
        assert!(b < 50, "blue should be low for red spot");
        assert_eq!(a, 204); // 255 * 80 / 100
    }

    #[test]
    fn engine_color_spot_no_fallback() {
        let spot = strata_core::EngineColor::Spot {
            name: "PANTONE Process Black".into(),
            tint: 100.0,
            a: 255.0,
            process_fallback: None,
        };
        let (r, g, b, a) = engine_color_rgba(&spot);
        assert_eq!((r, g, b, a), (0, 0, 0, 255));
    }
}
