# WASM Backend Architecture

**Updated:** 2026-07-08

## Purpose

Share Rust scene computation (`varve-core`, `varve-engine`, `varve-layout`, `varve-trace`) with the web target via wasm-pack, behind the same `@varve/engine` facade as Tauri native IPC.

Desktop keeps the **native wedge** (ADR-0001): document state in unbounded native memory; WASM is for browser deployment and optional worker acceleration.

## Crate Matrix

| Crate | WASM build | Notes |
|---|---|---|
| `varve-core` | Yes | Geometry, scene, hit_test |
| `varve-engine` | Yes | `build_render_ir` |
| `varve-layout` | Yes | Flex/grid layout parity |
| `varve-trace` | Yes | Auto-trace (Potrace-class) |
| `varve-wasm` | Yes | wasm-bindgen glue crate |
| `varve-sync` | No | SQLite |
| `varve-bgremove` | No | Native ORT; browser uses onnxruntime-web |

## Feature Variants

| Artifact | Flags | Use when |
|---|---|---|
| `varve_wasm_simd_bg.wasm` | `+simd128`, wasm-opt -O3 | **Preferred** — SIMD-capable browsers |
| `varve_wasm_bg.wasm` | baseline, wasm-opt -O3 | Fallback when SIMD artifact absent |
| `varve_engine_threads.wasm` | `+atomics,+bulk-memory` | Web with COOP/COEP only (deferred) |

**Threading reality check (2026-07-11):** nothing in this repo uses `SharedArrayBuffer`,
`rayon`, or `wasm-bindgen-rayon` today — the `simd128` variant above is single-threaded
lane parallelism and needs neither shared memory nor cross-origin isolation. Tauri's
`apps/desktop/src-tauri/tauri.conf.json` currently sets `"csp": null` (no COOP/COEP
equivalent configured), which is fine while nothing requests threading — but whoever
picks up `varve_engine_threads.wasm` needs to verify Tauri's webview shell actually
satisfies `SharedArrayBuffer` availability before relying on it; the COOP/COEP mental
model is browser-tab-shaped and doesn't necessarily map 1:1 onto a Tauri webview.

Runtime selection: `loadWasmEngineModule()` tries SIMD variant first (HEAD probe),
then baseline. `prewarmWasmEngine()` instantiates during idle via `requestIdleCallback`.

## API Boundary

Coarse scene-level calls only (avoid per-node WASM transitions):

- `build_ir(nodes_json: string) -> Uint8Array`
- `hit_test(nodes_json: string, x: f64, y: f64) -> i32`

## Offline Asset Policy

- WASM modules ship in app bundle (`apps/desktop/public/wasm/`). `ci.yml` runs `just wasm-build-all` (base + SIMD) and passes artifacts to E2E. **`build.yml`** (the actual release-packaging workflow) previously built no WASM at all — the gitignored output directory was simply empty on a clean checkout, so every packaged release silently shipped with the JS-only engine. Fixed 2026-07-11: `build.yml` now has a `build-wasm` job (`wasm-build-all`, once on Linux) whose artifact every OS's release job downloads before `pnpm build`.
- ONNX models use `manifest.json` with SHA-256 verification via `ModelLoader`. No `.onnx` binaries are committed yet (`bundled: false`); users download explicitly from settings (ADR-0005).
- `varve-layout` / `varve-trace` WASM bindings remain deferred stubs.

## Build

```bash
just wasm-build          # baseline + preferred SIMD engine artifact
cargo test --target wasm32-unknown-unknown --workspace
```

## Failure Handling

| Failure | Fallback |
|---|---|
| Module load error | TS `stubEngine()` |
| Version mismatch | Refuse load; prompt re-install |
| OOM / memory growth cap | Reduce scene; stub engine |
| Worker init failure | Main-thread stub |
