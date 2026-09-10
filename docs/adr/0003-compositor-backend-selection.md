# ADR-0003: Compositor backend selection

- **Status:** Accepted
- **Date:** 2026-07-06
- **Related:** ADR-0001, `@varve/compositor`

## Context

Strata must render mixed raster + vector documents with acceptable performance on Linux Tauri (WebKitGTK, no WebGPU) while remaining ready for WebGPU on macOS 26+ and Windows WebView2.

## Decision

Introduce `@varve/compositor` with a **backend router**:

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

The compositor now plans ordered structural segments before execution. GPU-safe
runs and Canvas2D fallback islands may interleave in paint order. Until the
editor supplies richer structure metadata, the planner uses an unsupported
flat item as the smallest safe island; it never claims a parent boundary that
has already been discarded by flattening.

## Canvas ownership (amended 2026-07-13)

The present/content `<canvas>` **always** keeps a Canvas2D context. GPU work targets an offscreen canvas with a `webgpu` context; results are `drawImage`'d onto the 2D present surface. This was required because `CanvasArea.drawContent` needs `getContext('2d')` for board fill, camera, structural masks, and partial redraw — binding `webgpu` on the content canvas made `getContext('2d')` return null and blanked the editor when `preferWebGpu` was on.

**Device loss** is now recoverable in place: tear down GPU resources, keep painting via Canvas2D on the same element. StatusBar shows "GPU lost — using Canvas2D". Reload only to re-acquire the GPU.

## Minimum Supported Baseline (2026-07-11, consolidated 2026-07-12)

`WebGPUBackend.init()` (via `packages/engine/src/gpuAdapter.ts`'s `selectWebGpuAdapter`,
shared with `detectWebGPU` and `GpuAccelerator`) inspects every string field on the
adapter's `info` (`vendor`, `architecture`, `device`, `description`) before requesting a
`GPUDevice`. If any field contains `"swift"` (SwiftShader), `"fallback"`, `"software"`,
`"llvmpipe"`, or `"lavapipe"` (Mesa's software rasterizers — the ones actually reachable
on this project's Linux dev target, not just Chromium/ANGLE's SwiftShader), it declines
the adapter and uses Canvas2D instead, without ever calling `requestDevice()`. Before
2026-07-12 this policy existed only in `WebGPUBackend`; `GpuAccelerator` (background-removal
compute shaders) accepted any adapter including software ones — now consistent across both.

**Rationale:** a software-emulated "WebGPU" adapter is not a real GPU — it's a CPU
rasterizer behind the WebGPU API surface. The hand-tuned Canvas2D path
(`packages/compositor/src/canvas2d/`) is expected to outperform a software-rendered
WebGPU pipeline in practice, so accepting the software adapter would be strictly
worse than declining it, not just unproven.

`adapterIsFallback` in `CompositorDiagnostics` stays `true` even though the adapter
was declined (not used) — this distinguishes "software adapter detected and declined"
from "no WebGPU support at all" for diagnostics/status-bar purposes
(`packages/editor/src/StatusBar.tsx`).

This is a detection heuristic (a substring match on vendor-supplied strings), not a
guarantee — if a future software renderer doesn't self-identify with any of the above
markers, it will be accepted as if it were real hardware. Revisit if evidence emerges of
another software backend slipping through.

**Device loss is a separate failure mode from adapter selection.** After the
2026-07-13 ownership invert (2D present canvas + offscreen WebGPU), losing
`GPUDevice` mid-session drops to Canvas2D on the same element — no remount
required. `CompositorDiagnostics.deviceLost` still surfaces so the UI can warn
("GPU lost — using Canvas2D") and optionally prompt a reload to re-acquire GPU.

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
