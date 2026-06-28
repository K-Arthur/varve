/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3).
 *
 * `createEngine(backend)` returns one surface used by all feature code:
 *   - 'native' → Tauri IPC into the natively-compiled Rust crates (desktop).
 *   - 'wasm'   → wasm-pack build of the same crates (web fallback).
 * Filled in task 0.7, gated by the render-spike ADR (0.2).
 */

export const PACKAGE = '@strata/engine' as const;
