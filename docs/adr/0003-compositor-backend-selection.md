# ADR-0003: Compositor backend selection

- **Status:** Accepted
- **Date:** 2026-07-06
- **Related:** ADR-0001, `@strata/compositor`

## Context

Strata must render mixed raster + vector documents with acceptable performance on Linux Tauri (WebKitGTK, no WebGPU) while remaining ready for WebGPU on macOS 26+ and Windows WebView2.

## Decision

Introduce `@strata/compositor` with a **backend router**:

1. **Canvas2D** — always available; default on all platforms.
2. **WebGPU** — opt-in when `detectWebGPU()` succeeds; device-loss falls back to Canvas2D.
3. **Native wgpu overlay** — deferred; evaluate only if WebGPU compositor cannot meet filter latency on desktop.

IR-replay remains the stable seam; compositor consumes `RenderItem[]`.

## Consequences

- Positive: Single integration point in `CanvasArea`; tile cache reduces redundant replay.
- Negative: WebKitGTK Linux users stay on Canvas2D until WebKit ships WebGPU.

## Verification

- `packages/compositor/src/compositor.test.ts`
- Golden replay hashes in `packages/engine/src/__goldens__/`
