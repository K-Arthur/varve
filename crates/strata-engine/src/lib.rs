//! Strata engine: GPU vector renderer.
//!
//! Two backends behind one facade: native (wgpu + lyon + cosmic-text) for the
//! Tauri desktop build, and wasm32 for the web fallback. A tiny-skia CPU path
//! covers headless CI and low-end GPUs. Filled in task 0.6, gated by the
//! render-spike ADR from task 0.2.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
