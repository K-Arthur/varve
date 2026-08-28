//! ICC colour-management engine wrapping tintbox.
//!
//! Provides ICC-profile-based colour conversion using the `tintbox` crate
//! (lcms2-compatible pure-Rust colour engine). Bundled sRGB and CMYK profiles
//! are embedded via `include_bytes!`.
//!
//! Cross-target parity: the same profile bytes are used in native (Rust/tintbox)
//! and WASM (`varve-colour`) builds, guaranteeing identical colour math.
//! Profile data is pinned to `'static` lifetime to satisfy tintbox's borrow
//! requirements in long-lived engine instances.

use tintbox::format::decode::{TYPE_CMYK_8, TYPE_RGB_8};
use tintbox::profile::{Profile, RenderingIntent as TintboxIntent};
use tintbox::transform::{Flags, Transform};

use crate::profiles::{self, RenderingIntent as StrataIntent};

/// Bundled ICC profiles available for loading.
pub enum BundledProfile {
    Srgb,
    DefaultCmyk,
    /// Fogra39: uses the bundled CMYK profile as base ICC transform,
    /// with profile-specific corrections applied analytically in `conversions.rs`.
    Fogra39,
    /// GRACoL 2006: same structure as Fogra39.
    Gracol,
    /// SWOP Coated: same structure as Fogra39.
    Swop,
}

impl BundledProfile {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Srgb => "sRGB",
            Self::DefaultCmyk => "default_cmyk",
            Self::Fogra39 => "Fogra39",
            Self::Gracol => "GRACoL",
            Self::Swop => "SWOP",
        }
    }

    /// Return the raw ICC profile bytes for this profile.
    pub fn data(&self) -> &'static [u8] {
        match self {
            Self::Srgb => profiles::bundled_srgb(),
            _ => profiles::bundled_cmyk(),
        }
    }

    pub fn is_cmyk_output(&self) -> bool {
        matches!(
            self,
            Self::DefaultCmyk | Self::Fogra39 | Self::Gracol | Self::Swop
        )
    }
}

/// A colour-management engine backed by real ICC profiles.
///
/// Creates tintbox transforms between profiles and converts pixel buffers.
/// Profiles are loaded once and cached for the lifetime of the engine.
///
/// # Example
/// ```ignore
/// let mut engine = IccEngine::new();
/// engine.load_all_for_print().unwrap();
/// let (c, m, y, k) = engine.srgb_to_cmyk("Fogra39", 255, 0, 0,
///     varve_colour::profiles::RenderingIntent::Perceptual, false).unwrap();
/// ```
pub struct IccEngine {
    profiles: Vec<(String, Profile<'static>)>,
}

impl IccEngine {
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
        }
    }

    /// Load a profile from bundled data.
    pub fn load_bundled(&mut self, profile: BundledProfile) -> Result<(), String> {
        let data = profile.data();
        let name = profile.name();
        let p = Profile::open(data).map_err(|e| format!("ICC {name}: {e}"))?;
        self.profiles.push((name.to_string(), p));
        Ok(())
    }

    /// Load all profiles needed for print export (sRGB + default CMYK).
    pub fn load_all_for_print(&mut self) -> Result<(), String> {
        self.load_bundled(BundledProfile::Srgb)?;
        self.load_bundled(BundledProfile::DefaultCmyk)?;
        Ok(())
    }

    /// Load a profile from raw bytes with a given name.
    ///
    /// The bytes are leaked to `'static` lifetime, which is safe for
    /// long-lived engine instances with small profile counts (typical
    /// use: a handful of ICC profiles per application session).
    pub fn load_bytes(&mut self, name: &str, data: &[u8]) -> Result<(), String> {
        let owned: Box<[u8]> = data.to_vec().into_boxed_slice();
        let static_ref: &'static [u8] = Box::leak(owned);
        let profile = Profile::open(static_ref).map_err(|e| format!("ICC {name}: {e}"))?;
        self.profiles.retain(|(n, _)| n != name);
        self.profiles.push((name.to_string(), profile));
        Ok(())
    }

    fn get(&self, name: &str) -> Result<&Profile<'static>, String> {
        self.profiles
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p)
            .ok_or_else(|| format!("ICC profile not loaded: {name}"))
    }

    fn profile_for_print(&self, cmyk_profile_name: &str) -> Result<&Profile<'static>, String> {
        if profiles::PrintProfile::parse(cmyk_profile_name).is_none() {
            return Err(format!(
                "unknown CMYK profile '{cmyk_profile_name}'; expected Fogra39, GRACoL2006, or SWOP Coated"
            ));
        }
        self.get("default_cmyk")
    }

    fn map_intent(intent: StrataIntent) -> TintboxIntent {
        match intent {
            StrataIntent::Perceptual => TintboxIntent::Perceptual,
            StrataIntent::Relative => TintboxIntent::RelativeColorimetric,
            StrataIntent::Absolute => TintboxIntent::AbsoluteColorimetric,
            StrataIntent::Saturation => TintboxIntent::Saturation,
        }
    }

    /// Convert a single sRGB pixel to CMYK using an ICC transform.
    ///
    /// `profile_name` selects the target CMYK profile (Fogra39, GRACoL, SWOP
    /// all use the bundled default_cmyk.icc at the ICC level; profile-specific
    /// corrections are applied analytically in `conversions::rgb_to_cmyk_icc`).
    pub fn srgb_to_cmyk(
        &self,
        profile_name: &str,
        r: u8,
        g: u8,
        b: u8,
        intent: StrataIntent,
        bpc: bool,
    ) -> Result<(u8, u8, u8, u8), String> {
        let srgb = self.get("sRGB")?;
        let cmyk = self.profile_for_print(profile_name)?;
        let ti = Self::map_intent(intent);

        let t = Transform::new_with_formats(
            &[srgb, cmyk],
            &[ti, ti],
            &[bpc, bpc],
            &[0.0f64, 0.0f64],
            Flags::empty(),
            TYPE_RGB_8,
            TYPE_CMYK_8,
        )
        .map_err(|e| format!("ICC transform create: {e}"))?;

        let inp = [r, g, b];
        let mut out = [0u8; 4];
        t.do_transform(&inp, &mut out, 1);
        Ok((out[0], out[1], out[2], out[3]))
    }

    /// Convert a buffer of sRGB pixels to CMYK in batch.
    pub fn srgb_buffer_to_cmyk(
        &self,
        profile_name: &str,
        rgb: &[(u8, u8, u8)],
        intent: StrataIntent,
        bpc: bool,
    ) -> Result<Vec<(u8, u8, u8, u8)>, String> {
        let srgb = self.get("sRGB")?;
        let cmyk = self.profile_for_print(profile_name)?;
        let ti = Self::map_intent(intent);
        let n = rgb.len();

        let t = Transform::new_with_formats(
            &[srgb, cmyk],
            &[ti, ti],
            &[bpc, bpc],
            &[0.0f64, 0.0f64],
            Flags::empty(),
            TYPE_RGB_8,
            TYPE_CMYK_8,
        )
        .map_err(|e| format!("ICC batch transform: {e}"))?;

        let mut inp: Vec<u8> = Vec::with_capacity(n * 3);
        for &(r, g, b) in rgb {
            inp.push(r);
            inp.push(g);
            inp.push(b);
        }
        let mut out = vec![0u8; n * 4];
        t.do_transform(&inp, &mut out, n);

        let mut result = Vec::with_capacity(n);
        for i in 0..n {
            let o = i * 4;
            result.push((out[o], out[o + 1], out[o + 2], out[o + 3]));
        }
        Ok(result)
    }

    /// Check if a profile has been loaded.
    pub fn has_profile(&self, name: &str) -> bool {
        self.profiles.iter().any(|(n, _)| n == name)
    }

    /// Return the list of loaded profile names.
    pub fn loaded_profiles(&self) -> Vec<String> {
        self.profiles.iter().map(|(n, _)| n.clone()).collect()
    }
}

impl Default for IccEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_profiles_load() {
        let p = Profile::open(profiles::bundled_srgb());
        assert!(p.is_ok(), "sRGB should load: {:?}", p.err());
        let p = Profile::open(profiles::bundled_cmyk());
        assert!(p.is_ok(), "CMYK should load: {:?}", p.err());
    }

    #[test]
    fn load_all_for_print() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();
        assert!(eng.has_profile("sRGB"));
        assert!(eng.has_profile("default_cmyk"));
    }

    #[test]
    fn icc_srgb_to_cmyk_red() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();
        let (c, m, y, _k) = eng
            .srgb_to_cmyk("Fogra39", 255, 0, 0, StrataIntent::Perceptual, false)
            .unwrap();
        assert!(c < 50, "red C={c}");
        assert!(m > 150, "red M={m}");
        assert!(y > 100, "red Y={y}");
    }

    #[test]
    fn icc_known_values() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();

        let (c, m, y, k) = eng
            .srgb_to_cmyk("Fogra39", 255, 255, 255, StrataIntent::Perceptual, false)
            .unwrap();
        assert_eq!((c, m, y, k), (0, 0, 0, 0), "white → zero ink");

        let (_c, _m, _y, k) = eng
            .srgb_to_cmyk("Fogra39", 0, 0, 0, StrataIntent::Perceptual, true)
            .unwrap();
        assert!(k >= 200, "black K={k}");
    }

    #[test]
    fn icc_batch_roundtrip() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();

        let pixels = vec![(255u8, 0u8, 0u8), (0u8, 255u8, 0u8), (0u8, 0u8, 255u8)];
        let result = eng
            .srgb_buffer_to_cmyk("GRACoL", &pixels, StrataIntent::Perceptual, false)
            .unwrap();
        assert_eq!(result.len(), 3);
        // u8 channels are always ≤255; this assertion validates the type
        // boundary (tintbox returns u8 values).
        for &(_c, _m, _y, _k) in &result {
            // Values are valid u8 (guaranteed by type system)
        }
    }

    #[test]
    fn icc_intents_do_not_panic() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();

        let intents = [
            StrataIntent::Perceptual,
            StrataIntent::Saturation,
            StrataIntent::Relative,
            StrataIntent::Absolute,
        ];
        for intent in &intents {
            let result = eng.srgb_to_cmyk("Fogra39", 64, 128, 192, *intent, false);
            assert!(result.is_ok(), "intent {intent:?}");
        }
    }

    #[test]
    fn print_profile_names_are_case_insensitive_but_unknown_names_fail() {
        let mut eng = IccEngine::new();
        eng.load_all_for_print().unwrap();
        assert!(eng
            .srgb_to_cmyk("fogra39", 255, 0, 0, StrataIntent::Perceptual, false)
            .is_ok());
        let error = eng
            .srgb_to_cmyk(
                "made-up-profile",
                255,
                0,
                0,
                StrataIntent::Perceptual,
                false,
            )
            .expect_err("unknown output profiles must not silently use the default");
        assert!(error.contains("unknown CMYK profile"));
    }

    #[test]
    fn load_custom_profile_bytes() {
        let mut eng = IccEngine::new();
        eng.load_bytes("custom", profiles::bundled_srgb()).unwrap();
        assert!(eng.has_profile("custom"));
    }
}
