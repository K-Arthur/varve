# ADR-0004: WASM crate boundary and feature variants

- **Status:** Accepted
- **Date:** 2026-07-06
- **Related:** ADR-0001, `crates/strata-wasm`, `crates/strata-bridge`

## Context

The web target needs Rust parity for `build_render_ir` and `hit_test` without duplicating logic in TypeScript. Desktop retains native IPC (native memory wedge).

## Decision

1. **`strata-bridge`** — shared TS wire-format → `SceneNode` conversion (fills, filters, cornerRadius, ManagedColor fill).
2. **`strata-wasm`** — wasm-bindgen exports: `build_ir_json`, `hit_test_json`.
3. **Variants:** baseline wasm32 build first; SIMD/threaded builds as separate artifacts with runtime feature detection.
4. **`createEngine('wasm')`** loads bundled module from `/wasm/` with stub fallback.

Excluded from WASM: `strata-sync` (SQLite), `strata-bgremove` (native ORT).

## Consequences

- Positive: One Rust IR implementation for web and desktop IPC.
- Negative: wasm-pack CI and bundle size; COOP/COEP required for threaded variant on web only.

## Verification

- `crates/strata-bridge` tests
- `packages/engine/src/wasmLoader.test.ts`
- `just wasm-check`
