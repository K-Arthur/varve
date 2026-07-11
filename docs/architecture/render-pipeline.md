# Render Pipeline Architecture

**Updated:** 2026-07-10

## Overview

Strata follows [ADR-0001](../adr/0001-native-render-in-tauri-webview.md): the document lives in TypeScript (`@strata/scene`); a compact **render IR** crosses backend boundaries; the webview **replays** IR to the display surface.

## End-to-End Flow

```
Document (@strata/scene)
  -> walkNodes + viewport cull (CanvasArea)
  -> world transforms + resolveAllStyles + timeline sampling
  -> flat EngineNode[]
  -> createEngine().buildIr()  [native IPC | wasm | TS stub]
  -> RenderItem[]
  -> @strata/compositor (Canvas2D | WebGPU)
  -> screen
```

## Key Files

| Layer | File | Role |
|---|---|---|
| Editor draw | `packages/editor/src/CanvasArea.tsx` | RAF scheduling, flatten, `replaySubtree`, compositor |
| IR build (TS) | `packages/engine/src/engine.ts` | `stubEngine`, `nativeEngine`, `wasmEngine` |
| IR build (Rust) | `crates/strata-engine/src/lib.rs` | `build_render_ir` |
| IPC bridge | `apps/desktop/src-tauri/src/lib.rs` | `build_render_ir`, `hit_test` Tauri commands |
| Replay | `packages/engine/src/replay.ts` | Canvas2D immediate-mode paint |
| Blur | `packages/engine/src/blur.ts` | Separable Gaussian/box blur kernels, linear-light conversion, downsample-blur-upsample |
| Filter compositor | `packages/engine/src/filterCompositor.ts` | Offscreen compositing for non-CSS filters with per-filter opacity/blend |
| Halftone | `packages/engine/src/halftone.ts` | AM (clustered-dot) + FM (Floyd-Steinberg + Bayer) screening |
| Compositor | `packages/compositor/src/` | Backend router, tile cache, WebGPU scaffold |

## Hit Testing (Duplicate Paths)

The editor uses **TypeScript-only** hit testing:

- `context.hitTestNode()` in `packages/editor/src/context.tsx`
- Accelerated by `spatialIndex.ts` + `world.ts` geometry

Rust `hit_test` IPC exists but is **not called** from `CanvasArea`. Engine `hitTest()` is available for future worker offload.

## Frame Scheduling

1. State change triggers `drawContent` useCallback deps (zoom, pan, document, canvas mode).
2. `requestAnimationFrame` coalesces draws; prior RAF cancelled on unmount.
3. Dirty-rect partial redraw when mutation region is < 60% of viewport.
4. Optional render worker replays to `OffscreenCanvas` with `docVersion` stale guards.

## Backend Selection

| Runtime | IR source | Display |
|---|---|---|
| Tauri desktop | Native Rust IPC (preferred) or TS stub fallback | Compositor -> Canvas2D (Linux) or WebGPU (macOS 26+, Windows WebView2) |
| Browser dev | TS stub or wasm-pack | Same compositor router |
| Tests | TS stub | Mock `ReplayTarget` or OffscreenCanvas goldens |

## Render invariants (Session 45)

Two invariants are load-bearing; violating either blanks part or all of the scene.

1. **Every engine node must carry a valid `shape`.** Native + wasm deserialize
   each node into Rust `strata-bridge::IpcSceneNode`, where `shape` is required
   and internally tagged by `kind` (text = `IpcShape::Text{…}`). `CanvasArea.toEngineNode`
   must emit `shape:{kind:'text',…}` for text — a top-level `kind:'text'` with no
   `shape` makes `build_ir_json` throw ``missing field `shape` `` and rejects the
   **entire** `buildIr` batch, aborting the frame. The strict Rust deserializer is
   the source of truth; `withStubFallback` (in `@strata/engine`) degrades native/wasm
   to the pure-TS stub on any deserializer failure (one warning + circuit breaker)
   so one malformed node can never blank the whole scene.

2. **Image fills use Structured Clone transport when loaded.** The render worker
   cannot construct `Image` or access main-thread `ImageCache`. `collectImageBitmaps`
   pre-decodes on the main thread; `sceneCanUseWorkerRenderer` gates the worker path
   until every image src is loaded. Until then, main-thread replay applies.

## WebGPU Compositor (2026-07-08)

| Feature | Implementation |
|---|---|
| Init order | WebGPU context acquired before any 2D context on main canvas |
| Fallback | OffscreenCanvas 2D for non-GPU primitives; alpha-blitted onto WebGPU surface |
| Primitives | rect, circle, line (tessellated quad) on GPU; text/path/effects on 2D overlay |
| Pipeline | Explicit bind group layouts; shared camera uniform; per-circle discard shader |
| Perf | Vertex buffer pool (power-of-2); render bundle cache for static solid geometry |
| Device loss | `watchDeviceLost` clears pools; router swaps to Canvas2DBackend |
| Opt-in | `settings.render.preferWebGpu` (default false; Linux WebKitGTK stays Canvas2D) |
| Diagnostics | Status bar via `CompositorDiagnostics` (backend id, pool/bundle counts) |

## Blur Architecture (Session 47)

Blur effects use a **hybrid CSS/software strategy** with a dedicated separable convolution module at `packages/engine/src/blur.ts`.

### Kernel functions

| Function | Space | Used by |
|---|---|---|
| `gaussianBlurSeparable(data, radius)` | sRGB gamma, premultiplied alpha | Layer blur path in `replay.ts` |
| `gaussianBlurLinearLight(data, radius)` | Linear-light (sRGB→linear→blur→sRGB), premultiplied alpha | `CompositeCanvas.applyBlur` for compositing operations |
| `boxBlurSeparable(data, radius)` | sRGB gamma, premultiplied alpha, O(n) sliding-window | Optimized uniform blur variant |

### Premultiplied alpha

All separable kernels convert to premultiplied alpha before convolution and convert back after (`premultiply()`/`unpremultiply()`). This eliminates dark-fringing artifacts at transparent edges that occur when blurring straight-alpha pixels.

### Downsample-blur-upsample (radius > 100px)

For radii > 100px, the image is downsampled by up to 4×, blurred at the reduced radius (`radius/factor`), then upsampled back via `ctx.drawImage` (bilinear). This avoids O(r) convolution cost at extreme radii where the blur is wide enough that a lower-resolution kernel is visually indistinguishable.

### Hybrid dispatch in `CompositeCanvas.applyBlur()`

| Radius | Strategy | Hardware |
|---|---|---|
| ≤ 32px | CSS `filter: blur(radius)px` | GPU (CSS filter, single-pass, full 2D convolution) |
| > 32px | Software `gaussianBlurLinearLight` | CPU (separable 2-pass, lower asymptotic cost at large radii) |

The layer-blur path in `replay.ts` follows the same hybrid strategy: radius > 32px routes to `gaussianBlurSeparable` software path, ≤ 32px uses the CSS filter path.

### Backdrop blur LRU cache (Phase G)

A module-level `backdropCache` Map in `replay.ts` caches blurred backdrop captures:

- **Max entries:** 20 (`BACKDROP_CACHE_MAX`)
- **TTL:** 500ms (`BACKDROP_CACHE_TTL`)
- **Cache key:** `{lx,ly,lw,lh}` (world bounds) + canvas transform JSON + item transform JSON + blur radius
- **Sweep:** Called at the start of each `replayIr()` via `sweepBackdropCache()`
- **Eviction:** LRU (oldest-access entry evicted when full)
- **Testability:** Exported `__clearBackdropCache()` and `__getBackdropCacheSize()`

Only backdrop blur is cached. Drop shadow, inner shadow, layer blur, outer glow, and inner glow recompute every frame.

## Performance Optimizations (Session 43)

### Camera-only fast path
When the worker has a cached bitmap whose `docVersion` matches the current document, pan/zoom applies a compensation transform to the cached bitmap instead of rebuilding the full scene. This gives smooth 60fps camera movement at "last rendered quality."

The compensation transform accounts for:
- Pan delta (panned + floating-origin shift)
- Zoom ratio (`zoomNew / zoomOld`)
- DPR scaling

The worker asynchronously delivers a fresh render; once available, the next frame replaces the compensated bitmap.

### sceneCompositing cache
`sceneNeedsStructuralCompositing()` caches its result per document reference. Without caching, it scans every node on every frame to decide worker vs. main-thread path.

### measureTextAdvance canvas reuse
The per-character letter-spacing measurement now uses a module-level cached `CanvasRenderingContext2D` instead of allocating a new `<canvas>` per character.

### Worker floating-origin parity
The OffscreenCanvas render worker now applies `computeFloatingOrigin()` in its camera transform, matching the main thread's `applyCameraTransform()`.

## Frame Capture-on-Draw (World-Space AABB)

When a frame tool creates a new frame, sibling nodes fully contained within it are auto-reparented into the new frame. This is done during `createShapeAt` in the editor context.

**Fix (2026-07-11):** Previously, the containment check used `{ x: world.x, y: world.y, w: frameNode.w, h: frameNode.h }` — the world-space click position paired with local dimensions. For frames inside rotated or scaled parents, the local w/h differs from the actual world-space AABB, causing false-negatives (siblings were not captured) or false-positives.

The fix computes the true world-space AABB via `nodeWorldTransform(id) * transformRect({0,0,w,h})`. The frame's local rect is transformed through its full world transform (composition of all ancestor transforms + rotation), producing a correct axis-aligned bounding box for the containment check.

## Hierarchy Performance Targets

Concrete budgets for hierarchy operations, measured at 10K-node scale:

| Operation | Scale | Target (p95) | Source |
|---|---|---|---|
| `flattenTree` | 10K nodes | < 100 ms | `layers10k.bench` |
| `flattenTree` + filter + search | 10K nodes | < 150 ms | `layers10k.bench` |
| `buildParentIndexMap` | 10K nodes | < 10 ms | O(n) scan |
| `getParentFast` (1K lookups) | 10K nodes | < 10 ms | O(1) via index |
| `validateDocument` full invariant | 10K nodes | < 200 ms | 6-pass O(n), dev-only |
| `reparentNode` (1 node) | any | < 2 ms | O(1) filter + splice |
| `reparentNode` (50 nodes) | 10K | < 10 ms | batch within transaction |
| Spatial index rebuild | 10K | < 300 ms | `layers10k.bench` |
| `buildIr` + `replayIr` (1K rects) | 1080p | < 16 ms | 60fps budget |
| Input-to-pixel latency (drag) | any | < 50 ms | Interaction SLO |

## Known Gaps

- WebKitGTK (Linux Tauri) has no WebGPU; Canvas2D is the production path on CachyOS/Wayland.
- Leaf IR replay routes through `@strata/compositor.drawVectorItems`; mask/frame-clip/group-flatten structural logic remains in `CanvasArea.replaySubtreeToCtx`. Blur compositing uses the separable blur module in `@strata/engine`, not the compositor.
- Render worker offloads flat, **image-free** scenes via `ImageBitmap` + `compositeRasterLayer`; structural scenes and any scene with image fills stay on main-thread replay (see Render invariant 2). Full `transferControlToOffscreen` deferred.
- Blur effects are CPU-only for radius > 32px (separable software path). The CSS GPU path is used only for radius ≤ 32px. No WebGPU blur path exists — the WebGPU compositor routes solely on primitive kind and never inspects `item.effects` to dispatch blur.
- Only backdrop blur has a dedicated LRU cache. Drop shadow, inner shadow, layer blur, outer glow, and inner glow recompute every frame.
