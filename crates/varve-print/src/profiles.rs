//! Re-exports from `varve-colour` for backward compatibility.
//!
//! All ICC colour-science logic (profile types, validation, interpolation,
//! bundled profile data) has moved to the `varve-colour` crate to support
//! deterministic cross-target (native + WASM) colour processing.
//! This module re-exports the public API for existing varve-print consumers.

pub use varve_colour::{
    bundled_cmyk, bundled_srgb, parse_icc_profile_info, tetrahedral_interpolate,
    validate_icc_profile, PrintProfile, ProfileInfo, RenderingIntent,
};
