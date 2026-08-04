//! Re-exports from `varve-colour` for backward compatibility.
//!
//! The ICC colour-management engine (wrapping `tintbox`) has moved to the
//! `varve-colour` crate to support deterministic cross-target (native + WASM)
//! colour processing. This module re-exports the public API for existing
//! varve-print consumers.

pub use varve_colour::icc::{BundledProfile, IccEngine};
