# ADR-0005: Offline model bundling policy

- **Status:** Accepted
- **Date:** 2026-07-06
- **Updated:** 2026-07-06 — Phase E: Option B native cache + dispatch policy

## Context

Background removal AI models were fetched from GitHub at runtime, breaking offline-first requirements.

## Decision

1. Ship `apps/desktop/public/models/manifest.json` with bundled paths and optional SHA-256.
2. `ModelLoader` tries `/models/{id}.onnx` before remote URL.
3. Remote download remains **explicit user action** (download in UI), not startup dependency.
4. Worker pool reuses ONNX sessions; `terminateWorkerPool()` on document close.

### Cross-platform model storage (Option B — Phase E)

**IndexedDB (webview) is the primary source of truth for AI model bytes on all shipped builds.**

- User-downloaded models are stored as blobs in IndexedDB (`modelStore.ts`) and resolved to object URLs at inference time (`modelLoader.ts`).
- Bundled assets ship under `apps/desktop/public/models/` and are served at `/models/{id}.onnx`.

**Native `~/.local/share/strata/models/` is an optional second cache** when the `ai` Cargo feature is enabled:

- Populated only via explicit user action (native download IPC or webview export bridge) — never automatic dual-storage on a single download.
- Native inference reads from this path only; it does not access IndexedDB directly.
- Without native bytes present, Tauri `remove_background` with `ai` feature falls back to heuristic (Worker ONNX in webview remains primary for AI).

### Dispatch order (unchanged — Worker-first)

All platforms, shipped builds:

1. **Worker ONNX** (`onnxruntime-web` in webview) — primary AI path
2. **Tauri native IPC** — heuristic by default; native ONNX when `ai` feature + model on disk
3. **Direct onnxruntime-web** (main thread) — last resort
4. **Heuristic** — final fallback

Native ONNX does **not** preempt Worker dispatch. It is an opt-in acceleration path for environments where Worker is unavailable or for perf experiments.

### Native Rust AI (`ai` Cargo feature)

- Opt-in only — **not enabled** in default CI/release workflows.
- `ort` pinned to `=2.0.0-rc.11` (rc.12 breaks Linux x86_64 build).
- Separate CI job: `cargo test -p varve-bgremove --features ai`
- `preview_max_dimension` default 2048 — parity with TS worker/direct paths
- Dynamic ONNX input/output names (no hardcoded `"input"`)
- Real confidence from output tensor mean distance from 0.5

### WebGPU execution provider (deferred)

Investigation (2026-07-06): `onnxruntime-web`'s WebGPU EP requires `navigator.gpu`. Linux Tauri (WebKitGTK 2.52) does not expose WebGPU. Worker uses **WebGL → WASM** fallback only. Revisit when WebKitGTK ships WebGPU.

## Verification

- `packages/engine/src/backgroundRemoval/workerPool.ts`
- `packages/engine/src/backgroundRemoval/__tests__/index.test.ts`
- `packages/engine/src/backgroundRemoval/__tests__/directPreviewDownscale.test.ts`
- `crates/varve-bgremove/src/model.rs` — metadata parity with manifest
- `crates/varve-bgremove/src/inference.rs` — native ONNX parity
- Manifest at `apps/desktop/public/models/manifest.json`
