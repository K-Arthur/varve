# Render Pipeline Architecture

**Updated:** 2026-07-06

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

2. **Image fills require the main-thread renderer.** The OffscreenCanvas render
   worker replays IR with `replayIr`→`paintImageFill`→`new Image()`, which does not
   exist in a Web Worker global scope, against the main-thread `ImageCache` it also
   cannot see — so a worker-rendered frame silently drops every image (the failure
   is swallowed by `cache.load().catch()`). `sceneHasImageFills(doc)` (in
   `render/sceneCompositing.ts`) keeps any image-bearing scene on the main-thread
   `drawVectorItems` path. The worker path only runs for non-structural scenes, so
   image bugs looked intermittent (structural scenes render on the main thread).

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

## Known Gaps

- WebKitGTK (Linux Tauri) has no WebGPU; Canvas2D is the production path on CachyOS/Wayland.
- Leaf IR replay routes through `@strata/compositor.drawVectorItems`; mask/frame-clip/group-flatten structural logic remains in `CanvasArea.replaySubtreeToCtx`.
- Render worker offloads flat, **image-free** scenes via `ImageBitmap` + `compositeRasterLayer`; structural scenes and any scene with image fills stay on main-thread replay (see Render invariant 2). Full `transferControlToOffscreen` deferred.
