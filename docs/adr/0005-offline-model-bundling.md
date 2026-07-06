# ADR-0005: Offline model bundling policy

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Background removal AI models were fetched from GitHub at runtime, breaking offline-first requirements.

## Decision

1. Ship `apps/desktop/public/models/manifest.json` with bundled paths and optional SHA-256.
2. `ModelLoader` tries `/models/{id}.onnx` before remote URL.
3. Remote download remains **explicit user action** (download in UI), not startup dependency.
4. Worker pool reuses ONNX sessions; `terminateWorkerPool()` on document close.

## Verification

- `packages/engine/src/backgroundRemoval/workerPool.ts`
- Manifest at `apps/desktop/public/models/manifest.json`
