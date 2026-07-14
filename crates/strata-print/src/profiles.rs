//! Re-exports from `strata-colour` for backward compatibility.
//!
//! All ICC colour-science logic (profile types, validation, interpolation,
//! bundled profile data) has moved to the `strata-colour` crate to support
//! deterministic cross-target (native + WASM) colour processing.
//! This module re-exports the public API for existing strata-print consumers.

pub use strata_colour::{
    bundled_cmyk, bundled_srgb, parse_icc_profile_info, tetrahedral_interpolate,
    validate_icc_profile, PrintProfile, ProfileInfo, RenderingIntent,
};
