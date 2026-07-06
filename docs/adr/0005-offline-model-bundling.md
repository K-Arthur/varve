# ADR-0005: Offline model bundling policy

- **Status:** Accepted
- **Date:** 2026-07-06
- **Updated:** 2026-07-06 — cross-platform storage + native AI deferral

## Context

Background removal AI models were fetched from GitHub at runtime, breaking offline-first requirements.

## Decision

1. Ship `apps/desktop/public/models/manifest.json` with bundled paths and optional SHA-256.
2. `ModelLoader` tries `/models/{id}.onnx` before remote URL.
3. Remote download remains **explicit user action** (download in UI), not startup dependency.
4. Worker pool reuses ONNX sessions; `terminateWorkerPool()` on document close.

### Cross-platform model storage

**IndexedDB (webview) is the single source of truth for AI model bytes on all platforms** — desktop Tauri and browser alike.

- User-downloaded models are stored as blobs in IndexedDB (`modelStore.ts`) and resolved to object URLs at inference time (`modelLoader.ts`).
- Bundled assets ship under `apps/desktop/public/models/` and are served at `/models/{id}.onnx`; `ModelLoader` HEAD-checks availability before falling back to remote download.
- Rust's `~/.local/share/strata/models/` path (`crates/strata-bgremove/src/model.rs`) is **read-only scaffolding** with no download/write implementation. It is formally deferred until/unless native `ai` inference ships.

### Native Rust AI deferral (Option A)

Worker ONNX (`onnxruntime-web` in the Tauri webview) is the **sole desktop AI path** for shipped builds:

- The `ai` Cargo feature on `strata-bgremove` is opt-in and **not enabled** in CI or release workflows.
- Without `ai`, Tauri `remove_background` IPC unconditionally routes to the heuristic engine (`Quick` only).
- `ort` is pinned to `=2.0.0-rc.11` due to an upstream Linux-breaking regression in rc.12.
- Enabling native AI later requires a three-piece project: Rust download/write, Tauri model IPC, and opt-in release feature — not flipping one Cargo flag.

Dispatch order (all platforms): Worker ONNX → Tauri heuristic IPC → direct onnxruntime-web → heuristic fallback.

### WebGPU execution provider (deferred)

Investigation (2026-07-06): `onnxruntime-web`'s WebGPU EP requires a browser with `navigator.gpu` (WebGPU). Linux Tauri builds use WebKitGTK 2.52, which **does not expose WebGPU** in the embedded webview today. The worker therefore uses **WebGL → WASM** fallback only (`worker.ts` `getSession`). Do not scaffold WebGPU EP until WebKitGTK ships WebGPU on Linux or the project adds an explicit Chromium-based webview option.

## Verification

- `packages/engine/src/backgroundRemoval/workerPool.ts`
- `packages/engine/src/backgroundRemoval/__tests__/index.test.ts` — Worker-first + Tauri method coercion regression tests
- Manifest at `apps/desktop/public/models/manifest.json`
