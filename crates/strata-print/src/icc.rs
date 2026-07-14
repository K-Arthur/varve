//! Re-exports from `strata-colour` for backward compatibility.
//!
//! The ICC colour-management engine (wrapping `tintbox`) has moved to the
//! `strata-colour` crate to support deterministic cross-target (native + WASM)
//! colour processing. This module re-exports the public API for existing
//! strata-print consumers.

pub use strata_colour::icc::{BundledProfile, IccEngine};
