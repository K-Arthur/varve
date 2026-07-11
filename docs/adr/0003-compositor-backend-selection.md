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

- `packages/compositor/src/compositor.test.ts` — Canvas2D camera/clear/cache regression
- `packages/compositor/src/webgpu/golden.test.ts` — WebGPU vs Canvas2D tolerance diff (skips without `navigator.gpu`); also covers the software-adapter-decline test below
- `packages/editor/src/CanvasArea.render.test.tsx` — single compositor frame pass per draw
- Golden replay hashes in `packages/engine/src/__goldens__/`

WebGPUBackend acquires a real `GPUDevice` when `navigator.gpu` is available; unsupported primitives and device loss fall back to the embedded Canvas2D backend.

## Minimum Supported Baseline (2026-07-11)

`WebGPUBackend.init()` inspects the adapter's `info.device` string before requesting
a `GPUDevice`. If it identifies a software rasterizer (currently: contains `"swift"`,
matching SwiftShader — the software implementation most CI/headless Chromium
environments fall back to when no real GPU is present), it declines the adapter and
uses Canvas2D instead, without ever calling `requestDevice()`.

**Rationale:** a software-emulated "WebGPU" adapter is not a real GPU — it's a CPU
rasterizer behind the WebGPU API surface. The hand-tuned Canvas2D path
(`packages/compositor/src/canvas2d/`) is expected to outperform a software-rendered
WebGPU pipeline in practice, so accepting the software adapter would be strictly
worse than declining it, not just unproven.

`adapterIsFallback` in `CompositorDiagnostics` stays `true` even though the adapter
was declined (not used) — this distinguishes "software adapter detected and declined"
from "no WebGPU support at all" for diagnostics/status-bar purposes
(`packages/editor/src/StatusBar.tsx`).

This is a detection heuristic (a substring match on a vendor-supplied string), not a
guarantee — if a future software renderer doesn't self-identify with "swift", it will
be accepted as if it were real hardware. Revisit if evidence emerges of another
software backend slipping through.

## Fallback Removal Criterion

`preferWebGpu` defaults to `false` and Canvas2D remains the universal fallback. This
dual-implementation is intentional while WebGPU is unproven, but it is not meant to be
permanent — maintaining golden-diff parity between two rendering backends indefinitely
is its own maintenance cost.

**Remove the Canvas2D-parity requirement (i.e., make WebGPU the sole path, or drop the
opt-in gate and enable by default) once:**
1. WebGPU has shipped as the default for at least one full release cycle with no
   rollback triggered, **and**
2. it has been validated on the cross-platform matrix this project targets (Linux
   WebKitGTK stays Canvas2D regardless per the table above; macOS 26+ and Windows
   WebView2 are the relevant WebGPU targets), **and**
3. a real-GPU verification pass (not just CI, which cannot exercise the GPU path —
   see the CI GPU-testing note in `docs/architecture/render-pipeline.md`) has signed
   off on at least one release.

Until all three hold, keep both backends and the golden-diff test alive.

## CI GPU-Testing Decision (2026-07-11)

Resolved the open infra/cost question from the manual-verification checklist: neither
a GitHub-hosted GPU runner nor a self-hosted GPU runner was adopted here.

**Why not:** GPU-specific GitHub-hosted runners aren't confirmed to exist as a
selectable SKU today, and "larger runners" in general require a paid Team/Enterprise
Cloud plan — an account/billing upgrade, not a code change. Self-hosted runners now
carry their own (currently-paused-but-live) per-minute platform charge on top of the
real hardware they'd require someone to provision and maintain. Both are genuine
spend/infrastructure decisions for a human to make, not something to commit to
silently in a PR.

**What was done instead:** `publish.yml`'s release job already creates every release
as a **draft** with a note to smoke-test before publishing — a human checkpoint already
existed. Extended that same note to link the
[manual verification checklist](../architecture/webgpu-manual-verification.md), so the
reminder lands exactly where a human is already pausing to decide whether to publish,
at zero infrastructure cost. If GPU-backed CI is adopted later (either option above),
this note can be removed once CI itself proves the path on real hardware.
