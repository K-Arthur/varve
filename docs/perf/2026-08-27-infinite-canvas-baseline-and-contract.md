# Infinite/targeted canvas — baseline and performance contract

**Date:** 2026-08-27  
**Status:** active implementation record

## Scope and evidence

This record revalidates the current implementation before changing it. It does
not present inherited measurements as fresh benchmark results. The current
pipeline already has one shared, keyed latest-wins frame scheduler; one canvas
performance runtime; viewport and container culling; granular node/IR caches;
a worker path with synchronous admission guards; raster-pyramid LOD for raster
layers; adaptive residency; bounded diagnostics; and a Canvas2D fallback.

The retained Chromium production evidence is in
`docs/perf/2026-08-03-interaction-observability-report.md`: a 121-node drag
reported frame p50 2.5 ms and p95 5.1 ms. The raster reconstruction lower
bound and crossover evidence is in
`docs/perf/raster-pyramid-baseline-2026-08-09.md`. Those are useful baselines,
not a claim about this machine, current WebKitGTK, or this change.

## Interaction contract

At a display interval `T`, the renderer has three explicit work classes:

| Class | Budget | Required behaviour |
| --- | ---: | --- |
| Interaction | `0.5 × T` | Consume newest input, update overlays, and schedule/commit the latest camera state. Never synchronously decode, build a pyramid, or traverse irrelevant document data. |
| Authoritative viewport render | `0.9 × T` | Produce a current, device-resolution viewport frame. If it cannot complete during a gesture, retain a valid approximation only while a replacement is known to be pending. |
| Background/refinement | `0.25 × T` | Decode/refine/prefetch only after interaction work yields; all work is bounded, cancellable, and revision-guarded. |

At 60 Hz these are 8.33 ms, 15.00 ms, and 4.17 ms respectively. At higher
refresh rates they derive from the measured/display interval rather than a
hard-coded 16.67 ms. The acceptance target remains interaction frame p95 at or
below 16.67 ms on the agreed 60 Hz baseline; p99, dropped-frame rate, and
input-to-present must be reported alongside it.

## Revalidated hot path

```text
input -> mutable latest camera -> keyed frame scheduler -> redraw decision
      -> viewport/container cull -> IR/cache resolution -> replay/compositor
      -> present -> async viewport refinement
```

The scheduler keeps only the newest job per key and prevents background work
from running during an open interaction. The redraw coordinator distinguishes
skip, current-worker-present, and content frames before traversal. Worker
reprojection has a synchronous admission check and falls back to main-thread
authoritative replay if a fresh worker result cannot arrive. This preserves the
"never show pixels no fresh frame will replace" invariant.

## Current gaps selected for this implementation pass

| Finding | Evidence in current source | Effect | Planned repair |
| --- | --- | --- |
| Frame budget is represented as one undifferentiated rolling limit. | `canvas/frameBudget.ts` | Diagnostics and scheduling cannot distinguish interaction, authoritative, and background work. | Expose the three-class contract and percentile/drop metrics through the existing runtime. |
| General image-fill proxy choice uses one viewport/zoom cap for all visible images. | `canvas/renderPipeline.ts` → `render/adaptiveResidency.ts` | It is not based on an image's projected footprint and stays capped at 8K, so a settled high-zoom image can remain below source fidelity. | Make representation choice projection-aware, preserve a fast resident proxy during movement, then request a bounded authoritative refinement after settle. |
| The normal corpus did not supply equal-visible-complexity 1k/10k/100k documents, and extreme zoom omitted several product zooms. | `performance/workloadCorpus.ts` | A regression can hide document-size scaling or a zoom boundary failure. | Add opt-in camera-scaling stress fixtures and the exact 1%–6400% zoom corpus. |

## Performance invariants

1. Camera movement must not require work proportional to total document
   complexity when visible complexity is fixed.
2. A source raster's full dimensions must not determine per-frame camera cost
   for a small projected footprint.
3. Temporary camera approximations must converge to a current authoritative
   surface; a stale surface is never authoritative.
4. Interactive representations are derived data only. Export and print always
   request source-quality content.
5. Every cache and background queue has an explicit bound and stale revision
   work is discarded.

## Deterministic corpus

The default corpus remains quick enough for regular unit validation. The new
opt-in `viewport-1k`, `viewport-10k`, and `viewport-100k` fixtures contain 100
near-origin nodes and place all other nodes in far positive/negative clusters.
They are used to compare camera work at a fixed visible count without allocating
large raster pixels. `extreme-zoom` now covers 0.01, 0.02, 0.05, 0.1, 0.25,
0.5, 1, 2, 4, 8, 16, 32, and 64×, including far-world and rotated views.

## Implemented residency/refinement seam

Image-fill replay now selects a source bucket from the fill's transformed
device-space long edge (including rotation and skew), not from the whole
viewport. Interactive frames use a 1.25× margin and an 8K ceiling; settled
frames use a 1.5× margin and can promote to 16K only when the proportional
RGBA decode remains inside the active image-cache byte budget. Export and
print retain their explicit full-source path.

When a sharper bucket is not ready, `ImageCache` retains the closest live
proxy and starts the requested decode. A latest-wins 180 ms quiet-period timer
then requests a normal `asset-ready` canvas frame after the interaction closes;
the existing image-cache subscription requests another frame when that decode
finishes. The Canvas2D compositor fallback receives the same policy, so flat
and structural replay paths converge rather than using different quality rules.

The bounded decode path currently applies to inline/blob sources, which can be
resized safely through `createImageBitmap`; remote sources intentionally retain
the established full-image loader until a CORS-safe tiled decoder is added. The
raster-layer pyramid remains the tiled LOD path for raster-layer primitives.

## Implemented frame-work accounting

`frameBudget.ts` now retains a bounded timing window for each declared work
class rather than treating every frame as a single 100%-interval deadline.
Its `window.__varvePerf.frameBudget.summary()` report exposes the display
interval, class budgets, averages, p50/p95/p99, sample counts, and
class-relative overruns. The main canvas records active camera interactions as
`interaction`; settled and worker-presented frames are `authoritative`.
Background callers can report `background` explicitly, and the shared
latest-wins scheduler continues to defer that lane until interaction settles.

## Measurement protocol

For each cold and warm corpus run, collect the existing `?perf=1`
`window.__varvePerf` frame/trace diagnostics: frame p50/p95/p99, worst frame,
dropped-frame ratio, pointer/wheel input-to-present, node candidates/culled/
replayed, IR cache hit rate, worker path, and residency bytes. Compare the
optimized surface hash with `forceFullRedraw()` at the same camera. Browser
and desktop WebKitGTK results remain separate rows; rAF estimates are marked as
estimates when Event Timing presentation evidence is unavailable.
