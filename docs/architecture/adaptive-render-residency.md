# Adaptive Render Residency and Fidelity

**Status:** Phase 1 implemented
**Updated:** 2026-08-15

## Scope

Varve has several useful resource policies already: `ImageCache` is byte
bounded, worker image transfer is admitted by bytes and source count, the
worker uses power-of-two image caps, and raster-layer tiles have a bounded
residency store. This document records the coordination layer and the
remaining work. It does not replace those owners with a second cache.

The policy is split into five decisions:

1. **Visibility:** whether a node is considered for the current frame. The
   existing page, container, viewport, and dirty-region culling remains the
   source of truth.
2. **Residency:** which derived resources are retained. The first shared
   ledger is `AdaptiveResidencyManager`; backend caches still own disposal.
3. **Representation:** which source-resolution bucket is requested. Interactive
   buckets are power-of-two values from 512 to 8192 pixels on the long edge.
4. **Fidelity:** interactive replay may use a viewport-sized image proxy. The
   document asset remains authoritative and is never replaced by the proxy.
5. **Intent:** export and print omit the interactive policy and therefore use
   the authoritative full-resolution path.

The planned representation vocabulary is intentionally independent from
residency: `full`, `cached`, `proxy`, `simplified`, `outline`, and
`suspended`. Phase 1 activates `full` and `proxy` for image fills. Cached
subtrees, simplified effects, outline mode, and suspended offscreen resources
remain explicit follow-up policies rather than undocumented boolean quality
flags.

## Current Architecture Findings

Measured or directly verified in the implementation:

- Images are shape fills backed by embedded document assets. The same asset
  source can be referenced by multiple fills.
- Main-thread replay previously resolved the full cached image even when the
  projected object was small. The worker path already used `loadAtSize` for
  large inline sources.
- The image resource handle registry stores encoded data URLs and had no
  production document-close cleanup boundary. It remains a follow-up item;
  `resetImageResourceRegistry` is currently test-facing only.
- `ImageCache` estimates decoded bytes as `width * height * 4`. Browser decoder
  storage, encoded source strings, and native/WebView backing storage are
  estimates outside that number.
- Structural frame replay is a main-thread path. A frame clip is a stateful
  Canvas2D clip and must not depend on a compositor backend that may render a
  leaf on another surface.
- Existing tile residency is for raster-layer tiles, not ordinary image fills.

These are implementation findings, not claims about resident operating-system
RSS. Browser and WebView allocations remain partly opaque.

## Phase 1 Policy

`packages/editor/src/render/adaptiveResidency.ts` provides:

- `selectRasterRepresentation` for projected-size buckets;
- `shouldChangeRasterBucket` with promotion and demotion hysteresis;
- `AdaptiveResidencyManager` for byte estimates, priorities, pins, pressure,
  cost-aware eviction, promotion/demotion counters, and document ownership;
- a pull-based diagnostic snapshot through `window.__strataPerf.residency()`
  when performance diagnostics are enabled.

The render pipeline records the visible image working set into the ledger. The
ledger is deliberately an accounting and policy layer. ImageCache, worker
bitmap ownership, WebGPU resources, and tile stores remain responsible for
actually releasing their own objects until adapter integration is complete.

## Image Representation Lifecycle

For interactive main-thread replay:

```text
embedded encoded source
  -> at-size ImageBitmap proxy (power-of-two cap)
  -> full cached source only when required or while the proxy is being built
```

The proxy is loaded asynchronously. Until it is available, an already-loaded
full image remains usable, so a representation promotion cannot blank the
canvas. Once the proxy is ready, the cache notification schedules a redraw.
The source dimensions stored in the fill remain authoritative; sample
coordinates are scaled to the proxy dimensions so crop and fit semantics do
not change.

This path is only enabled for inline `data:` and `blob:` sources because the
browser resize decode contract is reliable there. Remote sources retain the
existing full-image fallback.

## Structural Frame Correctness

When a visible frame has `clipContent !== false`, the child subtree is replayed
inside an active Canvas2D clip. Structural leaf items now use direct `replayIr`
instead of `CompositorBackend.drawVectorItems`. This preserves the clip across
Canvas2D and WebGPU-capable runtimes. The compositor remains used for the flat,
non-structural path.

## Validation Plan

The required visual regression is not a generic canvas non-blank check. It must:

1. import a photo and wait for a non-background interior region;
2. create or select a frame using the real pointer workflow;
3. parent the existing image into the frame;
4. assert the image row is nested and `clipContent` is enabled;
5. compare a known frame-interior pixel region before and after parenting;
6. move the image partly outside and assert only the frame intersection remains;
7. force the full-redraw oracle at the same camera and compare hashes;
8. repeat with clipping disabled to prove the image is not hidden by a stale
   cache or missing asset handle;
9. run with worker, Canvas2D fallback, and WebGPU-capable Chromium when the
   runtime exposes those paths.

Unit coverage must also cover proxy sample-coordinate scaling, export intent,
bucket hysteresis, byte accounting, pinning, eviction, stale async results,
and document release. Use unique Playwright ports and output directories.

## Follow-up Phases

1. Add explicit document-close cleanup for encoded handle registries and all
   worker/source maps.
2. Add backend adapters for Canvas2D cached canvases and WebGPU textures so the
   ledger can trigger real demotion and destruction.
3. Track actual per-source ImageCache bytes and in-flight decode ownership.
4. Add pressure callbacks for OS/native Tauri memory signals where available.
5. Add a residency overlay showing source dimensions, selected bucket, reason,
   and estimated bytes.
6. Benchmark 4 GB, 8 GB, and 16+ GB profiles with high-resolution image and
   effects-heavy corpora before changing budget defaults.

The acceptance gates for those phases are:

- **Frame governor:** frame-time, decode, worker, and memory pressure are
  smoothed before changing policy; promotion and demotion have hysteresis.
- **Interaction fidelity:** camera motion may use a bounded proxy or reduced
  effects, but selected objects, text editing, hit testing, overlays, and final
  settled frames remain accurate.
- **Reprojection:** a cached frame has a maximum age, scale ratio, and
  consecutive-frame limit; no repeatedly resampled proxy becomes a permanent
  frame.
- **Subtree caching:** cache keys include document/subtree revision, scale,
  DPR, backend, effects, and mask versions. Any edit inside a subtree
  invalidates it.
- **Effects and dirty regions:** effect bounds and intermediate surfaces are
  measured; adaptive effect reduction never changes export/print output.
- **Cross-backend ownership:** Canvas2D, worker, and WebGPU adapters report
  estimated bytes and release resources exactly once across context loss,
  worker restart, backend switch, and document close.
- **Large imagery:** native/tiled decode is added only after the benchmark
  corpus demonstrates that browser full-image decode remains a dominant cost.
