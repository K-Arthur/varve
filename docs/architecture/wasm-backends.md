# WASM Backend Architecture

**Updated:** 2026-07-06

## Purpose

Share Rust scene computation (`strata-core`, `strata-engine`, `strata-layout`, `strata-trace`) with the web target via wasm-pack, behind the same `@strata/engine` facade as Tauri native IPC.

Desktop keeps the **native wedge** (ADR-0001): document state in unbounded native memory; WASM is for browser deployment and optional worker acceleration.

## Crate Matrix

| Crate | WASM build | Notes |
|---|---|---|
| `strata-core` | Yes | Geometry, scene, hit_test |
| `strata-engine` | Yes | `build_render_ir` |
| `strata-layout` | Yes | Flex/grid layout parity |
| `strata-trace` | Yes | Auto-trace (Potrace-class) |
| `strata-wasm` | Yes | wasm-bindgen glue crate |
| `strata-sync` | No | SQLite |
| `strata-bgremove` | No | Native ORT; browser uses onnxruntime-web |

## Feature Variants

| Artifact | Flags | Use when |
|---|---|---|
| `strata_engine_bg.wasm` | baseline | Tauri, constrained environments |
| `strata_engine_simd.wasm` | `+simd128` | SIMD-capable browsers |
| `strata_engine_threads.wasm` | `+atomics,+bulk-memory` | Web with COOP/COEP only |

Runtime selection via `wasm-feature-detect` (or manual probes): load the best supported variant.

## API Boundary

Coarse scene-level calls only (avoid per-node WASM transitions):

- `build_ir(nodes_json: string) -> Uint8Array`
- `hit_test(nodes_json: string, x: f64, y: f64) -> i32`

## Offline Asset Policy

- WASM modules ship in app bundle (`apps/desktop/public/wasm/`). CI runs `just wasm-build` and passes artifacts to E2E.
- ONNX models use `manifest.json` with SHA-256 verification via `ModelLoader`. No `.onnx` binaries are committed yet (`bundled: false`); users download explicitly from settings (ADR-0005).
- `strata-layout` / `strata-trace` WASM bindings remain deferred stubs.

## Build

```bash
just wasm-build          # wasm-pack all targets
cargo test --target wasm32-unknown-unknown --workspace
```

## Failure Handling

| Failure | Fallback |
|---|---|
| Module load error | TS `stubEngine()` |
| Version mismatch | Refuse load; prompt re-install |
| OOM / memory growth cap | Reduce scene; stub engine |
| Worker init failure | Main-thread stub |
