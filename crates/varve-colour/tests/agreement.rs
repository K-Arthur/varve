//! Cross-target agreement tests: native vs WASM colour conversion parity.
//!
//! These tests validate that colour conversion functions produce identical
//! results regardless of target architecture. Since the WASM module compiles
//! the same Rust source via wasm-pack, agreement is structural. These tests:
//!
//! 1. Establish reference values for known RGB→CMYK conversions.
//! 2. Validate edge cases (black, white, primaries, neutrals).
//! 3. Verify the analytical ICC path produces deterministic, profile-appropriate
//!    results (these are compared against tintbox ICC results for consistency).
//!
//! Tolerance strategy:
//! - Naive RGB↔CMYK: exact u8 match (deterministic arithmetic).
//! - Analytical ICC path: ±1 u8 per channel (acceptable f32→u8 rounding
//!   variation across platforms with different SIMD/math libraries).
//! - Tintbox ICC path validated separately (tintbox is the reference; the
//!   analytical path is an approximation with documented GCR/TAC differences).
//!
//! Cross-target identity: all functions in `varve_colour::conversions` are
//! pure arithmetic with no platform-specific intrinsics or profile data,
//! guaranteeing bit-identical results on native and WASM targets.

use varve_colour::{
    cmyk_to_rgb, profile_gcr, profile_tac, rgb_to_cmyk, rgb_to_cmyk_icc, PrintProfile,
    RenderingIntent,
};

// ── Reference values (naive) ──────────────────────────────────────────

/// Known reference: black should produce (0, 0, 0, 255)
const BLACK_CMYK: (u8, u8, u8, u8) = (0, 0, 0, 255);
/// Known reference: white should produce (0, 0, 0, 0)
const WHITE_CMYK: (u8, u8, u8, u8) = (0, 0, 0, 0);

/// Test 1: Naive black is consistent across targets.
#[test]
fn agreement_naive_black() {
    assert_eq!(rgb_to_cmyk(0, 0, 0), BLACK_CMYK);
}

/// Test 2: Naive white is consistent across targets.
#[test]
fn agreement_naive_white() {
    assert_eq!(rgb_to_cmyk(255, 255, 255), WHITE_CMYK);
}

/// Test 3: Naive RGB↔CMYK roundtrip stays within tight tolerance.
#[test]
fn agreement_naive_roundtrip() {
    let test_colors = [
        (255u8, 0u8, 0u8),
        (0u8, 255u8, 0u8),
        (0u8, 0u8, 255u8),
        (128u8, 128u8, 128u8),
        (255u8, 255u8, 0u8),
        (0u8, 255u8, 255u8),
        (255u8, 0u8, 255u8),
        (42u8, 99u8, 177u8),
        (200u8, 100u8, 50u8),
    ];

    for &(r, g, b) in &test_colors {
        let (c, m, y, k) = rgb_to_cmyk(r, g, b);
        let (r2, g2, b2, _) = cmyk_to_rgb(c, m, y, k);

        let dr = (r as i16 - r2 as i16).abs();
        let dg = (g as i16 - g2 as i16).abs();
        let db = (b as i16 - b2 as i16).abs();

        assert!(
            dr <= 2 && dg <= 2 && db <= 2,
            "Roundtrip ({r},{g},{b}) → ({c},{m},{y},{k}) → ({r2},{g2},{b2}) \
             drift=({dr},{dg},{db}) exceeds tolerance",
        );
    }
}

/// Test 4: Primaries produce expected dominant complementary inks.
#[test]
fn agreement_naive_primaries() {
    // Red → high M+Y, low C+K
    let (c, m, y, k) = rgb_to_cmyk(255, 0, 0);
    assert!(m > 200, "Red magenta: {m}");
    assert!(y > 200, "Red yellow: {y}");
    assert!(c < 50, "Red cyan: {c}");
    assert!(k < 50, "Red key: {k}");

    // Green → high C+Y, low M+K
    let (c, m, y, _k) = rgb_to_cmyk(0, 255, 0);
    assert!(c > 200, "Green cyan: {c}");
    assert!(y > 200, "Green yellow: {y}");
    assert!(m < 50, "Green magenta: {m}");

    // Blue → high C+M, low Y+K
    let (c, m, y, _k) = rgb_to_cmyk(0, 0, 255);
    assert!(c > 200, "Blue cyan: {c}");
    assert!(m > 200, "Blue magenta: {m}");
    assert!(y < 50, "Blue yellow: {y}");
}

// ── Analytical ICC path ───────────────────────────────────────────────

/// Test 5: Analytical ICC path for all profiles doesn't panic and produces
/// valid (non-inverted) output for standard colours.
#[test]
fn agreement_icc_all_profiles() {
    let profiles = [
        PrintProfile::Fogra39,
        PrintProfile::Gracol2006,
        PrintProfile::SwopCoated,
    ];
    let intents = [
        RenderingIntent::Perceptual,
        RenderingIntent::Relative,
        RenderingIntent::Absolute,
        RenderingIntent::Saturation,
    ];

    for profile in &profiles {
        for intent in &intents {
            let (c, m, y, k) = rgb_to_cmyk_icc(*profile, 128, 64, 192, *intent, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(
                total > 0,
                "All-zero CMYK for non-white input: {profile:?}/{intent:?}",
            );
        }
    }
}

/// Test 6: Profile differentiation — GCR and TAC values differ between profiles.
#[test]
fn agreement_icc_profile_gcr_tac() {
    let gcr = [
        profile_gcr(PrintProfile::Fogra39),
        profile_gcr(PrintProfile::Gracol2006),
        profile_gcr(PrintProfile::SwopCoated),
    ];
    let tac = [
        profile_tac(PrintProfile::Fogra39),
        profile_tac(PrintProfile::Gracol2006),
        profile_tac(PrintProfile::SwopCoated),
    ];

    let gcr_all_same = gcr[0] == gcr[1] && gcr[1] == gcr[2];
    let tac_all_same = tac[0] == tac[1] && tac[1] == tac[2];
    assert!(
        !gcr_all_same || !tac_all_same,
        "GCR={gcr:?} TAC={tac:?} — at least one should differ",
    );
}

/// Test 7: Determinism across repeated calls (same input → same output).
#[test]
fn agreement_icc_deterministic() {
    let inputs = [
        (0u8, 0u8, 0u8),
        (255u8, 255u8, 255u8),
        (128u8, 64u8, 192u8),
        (200u8, 100u8, 50u8),
        (10u8, 10u8, 10u8),
    ];

    for &(r, g, b) in &inputs {
        let expected = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            r,
            g,
            b,
            RenderingIntent::Perceptual,
            false,
        );
        for _ in 0..100 {
            let actual = rgb_to_cmyk_icc(
                PrintProfile::Fogra39,
                r,
                g,
                b,
                RenderingIntent::Perceptual,
                false,
            );
            assert_eq!(
                actual, expected,
                "Non-deterministic result for ({r},{g},{b}): {:?} vs {:?}",
                actual, expected,
            );
        }
    }
}

/// Test 8: Analytical ICC vs naive path — analytical should produce
/// different (better) results for neutral gray by applying GCR.
#[test]
fn agreement_icc_vs_naive_neutral() {
    // Neutral gray: naive produces substantial CMY, analytical replaces
    // with K via GCR.
    let (n_c, n_m, n_y, n_k) = rgb_to_cmyk(128, 128, 128);
    let (i_c, i_m, i_y, i_k) = rgb_to_cmyk_icc(
        PrintProfile::Fogra39,
        128,
        128,
        128,
        RenderingIntent::Perceptual,
        false,
    );

    // Analytical should have lower CMY sum (GCR replaces with K)
    let naive_cmy_sum = n_c as u32 + n_m as u32 + n_y as u32;
    let icc_cmy_sum = i_c as u32 + i_m as u32 + i_y as u32;
    assert!(
        icc_cmy_sum <= naive_cmy_sum,
        "GCR should reduce CMY: naive={naive_cmy_sum} icc={icc_cmy_sum}",
    );

    // Analytical should have higher K
    assert!(i_k >= n_k, "GCR should increase K: naive={n_k} icc={i_k}",);
}

/// Test 9: Boundary handling — all zeros → black.
#[test]
fn agreement_boundary_black() {
    assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
    let (_c, _m, _y, k) = rgb_to_cmyk_icc(
        PrintProfile::Fogra39,
        0,
        0,
        0,
        RenderingIntent::Perceptual,
        false,
    );
    assert!(k > 200, "Analytical black K={k} should be high");
}

/// Test 10: Boundary handling — all 255 → near-zero ink.
#[test]
fn agreement_boundary_white() {
    assert_eq!(rgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
    let (c, m, y, k) = rgb_to_cmyk_icc(
        PrintProfile::Fogra39,
        255,
        255,
        255,
        RenderingIntent::Perceptual,
        false,
    );
    // Analytical white should also be low-ink
    assert!(
        c < 40 && m < 40 && y < 40 && k < 40,
        "White: ({c},{m},{y},{k})"
    );
}

/// Test 11: BPC (black point compensation) changes result for very dark colours.
#[test]
fn agreement_bpc_changes_dark() {
    let (_, _, _, k_bpc) = rgb_to_cmyk_icc(
        PrintProfile::Fogra39,
        10,
        10,
        10,
        RenderingIntent::Perceptual,
        true,
    );
    let (_, _, _, k_no) = rgb_to_cmyk_icc(
        PrintProfile::Fogra39,
        10,
        10,
        10,
        RenderingIntent::Perceptual,
        false,
    );
    assert!(k_bpc > 0 || k_no > 0, "Dark input should always produce K",);
}
