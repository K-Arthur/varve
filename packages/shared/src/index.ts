/**
 * @strata/shared — framework-agnostic primitives shared across engine, scene,
 * and UI. Kept dependency-free so it can run in Rust-wasm bindings, web workers,
 * and React components alike.
 */

/** Semantic Strata package marker; real exports (geometry, fractional index)
 * land in task 0.6. */
export const PACKAGE = '@strata/shared' as const;
