# Render Pipeline Architecture

**Updated:** 2026-07-13

> The maintained Canvas 2D lifecycle, coordinate, resource, export, portability, and
> extension contract is [canvas2d-system.md](canvas2d-system.md). The target model is
> one Tauri production editor plus a browser compatibility harness; `apps/web` is not
> a production application.
>
> Raster ingestion, asset identity, decode-cache ownership, and worker bitmap
> lifecycle are maintained in [image-lifecycle.md](image-lifecycle.md).

## Overview

Varve follows [ADR-0001](../adr/0001-native-render-in-tauri-webview.md): the document lives in TypeScript (`@varve/scene`); a compact **render IR** crosses backend boundaries; the webview **replays** IR to the display surface.

## End-to-End Flow

```
Document (@varve/scene)
  -> walkNodes + viewport cull (CanvasArea)
  -> world transforms + resolveAllStyles + timeline sampling
  -> flat EngineNode[]
  -> createEngine().buildIr()  [native IPC | wasm | TS stub]
  -> RenderItem[]
  -> @varve/compositor (Canvas2D | WebGPU)
  -> screen
```

## Key Files

| Layer | File | Role |
|---|---|---|
| Editor draw | `packages/editor/src/CanvasArea.tsx` | RAF scheduling, flatten, `replaySubtree`, compositor |
| IR build (TS) | `packages/engine/src/engine.ts` | `stubEngine`, `nativeEngine`, `wasmEngine` |
| IR build (Rust) | `crates/varve-engine/src/lib.rs` | `build_render_ir` |
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
   each node into Rust `varve-bridge::IpcSceneNode`, where `shape` is required
   and internally tagged by `kind` (text = `IpcShape::Text{…}`). `CanvasArea.toEngineNode`
   must emit `shape:{kind:'text',…}` for text — a top-level `kind:'text'` with no
   `shape` makes `build_ir_json` throw ``missing field `shape` `` and rejects the
   **entire** `buildIr` batch, aborting the frame. The strict Rust deserializer is
   the source of truth; `withStubFallback` (in `@varve/engine`) degrades native/wasm
   to the pure-TS stub on any deserializer failure (one warning + circuit breaker)
   so one malformed node can never blank the whole scene.

2. **Image fills use Structured Clone transport when loaded.** The render worker
   cannot construct `Image` or access main-thread `ImageCache`. `collectImageBitmaps`
   pre-decodes on the main thread; `sceneCanUseWorkerRenderer` gates the worker path
   until every image src is loaded. Until then, main-thread replay applies.

## WebGPU Compositor (2026-07-11; ownership invert 2026-07-13)

| Feature | Implementation |
|---|---|
| Init order | Present canvas stays Canvas2D; offscreen canvas acquires `webgpu` |
| Fallback | Non-GPU primitives (text/path/effects) draw via present Canvas2D on top of GPU blit |
| Primitives | rect, circle, line (tessellated quad) on GPU; text/path/effects on 2D |
| Pipeline | Explicit bind group layouts; shared camera uniform (floating origin + view rotation); per-circle discard shader; premul blend |
| Affine | Vertex shader uses kurbo/canvas `a·x+c·y+e` / `b·x+d·y+f` (`transform`/`transform2` attrs) |
| Camera parity | `CameraUniform` includes `origin` + `rotation`; matches `buildWorldToScreenAffine` |
| Power preference | Shared `selectWebGpuAdapter()` (high-performance then low-power; decline software) |
| Perf | Vertex buffer pool (power-of-2); render bundle cache for solid rects/lines |
| Device loss | In-place Canvas2D continue; StatusBar "GPU lost — using Canvas2D" |
| Opt-in | `settings.render.preferWebGpu` (default false; Linux WebKitGTK stays Canvas2D) |
| Diagnostics | Status bar via `CompositorDiagnostics` |
| Drift guard | `wgsl-drift.test.ts` keeps TS shaders ≡ `crates/varve-bridge/tests/wgsl_validation.rs` |

### Rollback & Incident Response

- **Known caveat:** flipping `settings.render.preferWebGpu` requires an app/tab reload to re-init the compositor — it is not a hot-swap mid-session.
- **Incident order:** (1) flip `preferWebGpu` off, (2) only if needed, bisect WebGPU commits.
- **Removal criterion:** see ADR-0003.

### Shader/Pipeline Compilation Cost (2026-07-11)

`WebGPUBackend.init()` now times shader-module + pipeline creation separately from
WASM init, exposed as `CompositorDiagnostics.pipelineInitMs`. This was previously
unmeasured — only WASM init latency had a metric.

**Persistent cross-launch caching is not available to this backend today, confirmed
against the current spec (not assumed from prior knowledge):** the W3C WebGPU spec
gives user agents an internal, implementation-defined compilation cache, but exposes
no application-facing API to serialize/reload compiled pipeline state across launches.
Native (non-browser) `wgpu` has a `PipelineCache` type that supports exactly this, but
that surface isn't reachable through `navigator.gpu` — it would only become relevant if
this project moved to a native-wgpu-based renderer (the "Native wgpu overlay" option
ADR-0003 defers). Re-check this if that architecture ever changes; the browser-facing
spec could also gain this capability later and should be re-checked periodically rather
than assumed still-absent indefinitely.

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

## Canvas 2D Export Determinism & Size Limits (2026-07-12)

Raster/PDF export (`packages/editor/src/components/SpecPanel/export.ts`) had three unguarded correctness gaps, fixed this session:

| Gap | Fix | Evidence |
|---|---|---|
| **Font-loading race** | `fontRegistry.ts`'s `awaitExportsReady()` (awaits `document.fonts.ready` + registry settle, 5s safety timeout) existed but was never called from any export path — an export triggered right after opening a doc or switching a font family could silently render with the fallback font. Both `exportNodeAsRaster` and `exportNodeAsPdf` now `await awaitExportsReady()` before measuring/rendering. | `packages/editor/src/components/SpecPanel/export.test.ts` |
| **No canvas size clamp** | `exportNodeAsRaster` built an `OffscreenCanvas` at the full requested `w×h` with no upper bound. On WebKit's ~16384px dimension cap (the tightest of the three engines this app ships on — Chromium/Gecko allow 32767px), a large export either throws or silently corrupts. Export now clamps to `MAX_SAFE_CANVAS_DIMENSION` (16384, WebKit's floor — chosen because the runtime engine can't be reliably identified from script) and returns a `warnings[]` array surfaced to the user instead of failing silently. | `packages/editor/src/components/SpecPanel/export.test.ts` |
| **Tainted-canvas export failures were an opaque `SecurityError`** | `ImageCache.load()` now requests non-inline URLs with `crossOrigin='anonymous'` first (falling back to a plain request if that fails, so on-screen display is unaffected for servers without CORS headers), and `exportNodeAsRaster` catches `SecurityError` from `convertToBlob` and rethrows an actionable message naming the cause. | `packages/engine/src/imageCache.test.ts`, `export.test.ts` |

**Still open (deferred, see backlog):** oversized exports are clamped to a lower resolution, not tiled into multiple files. `packages/engine/src/export.ts`'s `getCanvasSizeLimit`/`tiledExport` helpers exist and are unit-tested but are not wired into the export path — true multi-tile output needs an `ExportJob`/UI change (one job → N files) that's a larger scope than this session's correctness-bug fixes. Thumbnails (`SpecPanel/thumbnail.ts`) silently drop text nodes from `buildScene()`, which sidesteps the font race there but is a separate, undocumented feature gap, not a fix.

**OffscreenCanvas capability detection hardened (2026-07-12):** `createRenderWorkerHost` now feature-detects `typeof OffscreenCanvas === 'undefined'` in addition to `typeof Worker`, before spinning up the render worker. Current research (2026-07) found WebKitGTK's OffscreenCanvas support inconsistently documented/tracked across point releases (unlike Chromium/WebView2/Firefox 105+/Safari 17+, which all have mature support) — without this guard, an engine lacking it would burn through the worker's full 5-retry exponential-backoff cycle (up to ~30s per attempt) before falling back to main-thread rendering, for a failure retrying can never fix.

## WebGPU/WGSL Subsystem Correctness Pass (2026-07-12)

Baseline architecture review (§0 resolution): confirmed there is **no native `wgpu`-rs anywhere in this repo** — zero `wgpu` entries in `Cargo.lock`, only `naga` (WGSL validator, dev-dependency of `varve-bridge`, used solely for offline compile-checking the WGSL strings hand-copied from the TS sources into `crates/varve-bridge/tests/wgsl_validation.rs`). WebGPU rendering happens **entirely inside the webview** via `navigator.gpu` in `packages/compositor/src/webgpu/`, driven by TS/WGSL — not natively in the Rust process bridged over IPC. ADR-0001's IR-replay architecture means Rust only ever computes scene → IR; the webview (Tauri's WebKitGTK on Linux, or a real browser for `pnpm dev`) does 100% of the actual GPU work. Both the Tauri desktop dev flow (`pnpm tauri:dev`, WebKitGTK) and the browser-dev flow (`pnpm dev` in `apps/desktop`, no Tauri window) load the *same* `@varve/compositor` code — WebGPU reachability is identical in both, gated purely by whether the hosting engine exposes `navigator.gpu` (WebKitGTK currently doesn't; Chromium does). `apps/web` remains a Next.js stub (task 0.9+) with no compositor wiring at all.

Fixes shipped this session (see commit messages for full detail; each is independently reverted-and-reproduced or execution-verified, not just code-reviewed):

- **`GpuAccelerator.requestAdapterInfo()` called a method removed from the spec/Chrome since v131 (mid-2024)** — background-removal GPU acceleration was silently, permanently disabled on every current browser. Fixed to use the synchronous `adapter.info` property (matches what the render compositor already used).
- **`GpuAccelerator` accepted software/emulated adapters (SwiftShare, llvmpipe) with no decline**, unlike the render compositor's ADR-0003 policy. Now consistent.
- **Three independent software-adapter-detection heuristics consolidated** into `packages/engine/src/gpuAdapter.ts` (`selectWebGpuAdapter`/`isSoftwareAdapter`), now also recognizing Mesa llvmpipe/lavapipe (this project's actual Linux software-rasterizer path), which neither prior heuristic did.
- **`ZoomTool`'s click-to-zoom was the one remaining `zoomAboutPoint()` call site missing the `viewport` argument**, causing anchor drift once the camera panned past the first floating-origin grid cell (512 world units) — verified directly against `packages/shared/src/viewport.ts` (pan (-1800,-1100), zoom 1→1.25, 640×480 canvas: anchor drifted from screen (400,300) to (-624,44) without the fix).
- **Router's `onDeviceLost` recovery was dead code** (reassigned an already-returned-by-value local variable) **and could not have worked anyway** (a `<canvas>`'s context type is fixed for its lifetime) — removed; `CompositorDiagnostics.deviceLost` now surfaces the real state so the UI can prompt for a reload instead of silently freezing.
- **`packages/engine`'s hand-rolled 547-line `webgpu-types.d.ts` replaced with the real `@webgpu/types` package** (matching what `packages/compositor` already used), removing a type-drift risk — the hand-rolled version's `GPUTextureFormat`/`GPUVertexFormat` etc. were widened to `string` rather than the spec's actual literal unions.
- **A shader-comment correction**: `SOLID_VERTEX_WGSL`'s manual scalar-arithmetic affine transform was documented as working around "naga 30 rejecting `mat2x3f * vec3f` despite it being valid WGSL (naga regression)" — verified false by compiling that exact snippet against this repo's pinned naga version (`cargo run` against a throwaway crate): `mat2x3f * vec3f` is a genuine WGSL dimension mismatch (`matCxR * vecC` needs the vector to match the matrix's *column* count — 2 vs. 3), not a naga bug. `mat3x2f * vec3f` is the dimensionally-correct form and validates cleanly; the comment now says so.

**Deferred, not attempted this session (see WEBGPU_WASM_ENGINE_MEMORY.md for the full dated log):**

- **WGSL single-source-of-truth.** `crates/varve-bridge/tests/wgsl_validation.rs` still hand-copies WGSL strings from the two TS source files; this session caught one live instance of the copy drifting (the Rust copy already had the mat3x2f-avoidance workaround the TS source hadn't landed yet at the time). A real fix (extract to standalone `.wgsl` files, imported raw by both Vite/TS and Rust's `include_str!`) touches the build pipeline on both sides and wasn't attempted here — recommended next step for whoever picks this up.
- **Circles don't use the render-bundle cache** (`WebGPUBackend`, only rects/lines do) — every circle on screen is a separate `beginRenderPass`/`draw` per frame. A real perf gap, but fixing it needs a per-circle bind-group cache design, and this environment has no real GPU to measure the before/after against (see Performance section below) — deferred rather than shipped unmeasured.
- **`docs/perf/ledger.md` has no WebGPU-specific measurements** despite the amount of WebGPU perf work done across sessions (vertex pooling, render bundles, this session's adapter consolidation). This sandbox's `wgpu::Instance`-equivalent check (`navigator.gpu` in headless Chromium via Playwright) only reaches a SwiftShare software adapter — see `docs/architecture/webgpu-manual-verification.md` for the real-hardware checklist that needs to be run on real hardware to produce trustworthy numbers.

## Known Gaps

- **CI never exercises the real WebGPU rendering path (2026-07-11).** `.github/workflows/ci.yml`'s `rust`/`js` matrix runs on GitHub-hosted `ubuntu-latest`/`macos-latest`/`windows-latest` — none provide real GPU hardware. `packages/compositor/src/webgpu/golden.test.ts`'s `native WebGPU path renders without error` test self-skips via `it.skipIf(navigator.gpu === undefined)`, which is always true in Vitest/jsdom. The `e2e` job runs real Chromium via Playwright, but GitHub-hosted runners give headless Chromium no GPU passthrough either — at best it falls back to a software rasterizer (the same class of adapter Task 16 / ADR-0003 now declines at the app level), so even E2E doesn't validate the hardware-accelerated path. "Tests pass" and "E2E passes" should not be read as "the WebGPU path works on real hardware." See `docs/architecture/webgpu-manual-verification.md` for the manual check to run before relying on this path in a release. Resolving this properly (a GPU-enabled CI runner) is an infra/cost decision, not made here.
- WebKitGTK (Linux Tauri) has no WebGPU; Canvas2D is the production path on CachyOS/Wayland.
- Leaf IR replay routes through `@varve/compositor.drawVectorItems`; mask/frame-clip/group-flatten structural logic lives in `replaySubtreeToCtx` in `packages/editor/src/canvas/renderPipeline.ts` (extracted from `CanvasArea.tsx` in the 2026-08-10 refactor). Blur compositing uses the separable blur module in `@varve/engine`, not the compositor.
- Render worker offloads flat, **image-free** scenes via `ImageBitmap` + `compositeRasterLayer`; structural scenes and any scene with image fills stay on main-thread replay (see Render invariant 2). Full `transferControlToOffscreen` deferred.
- Blur effects are CPU-only for radius > 32px (separable software path). The CSS GPU path is used only for radius ≤ 32px. No WebGPU blur path exists — the WebGPU compositor routes solely on primitive kind and never inspects `item.effects` to dispatch blur.
- Only backdrop blur has a dedicated LRU cache. Drop shadow, inner shadow, layer blur, outer glow, and inner glow recompute every frame.
- **No visual-parity test between the native PDF export path (`crates/varve-print`, lopdf-based) and the webview Canvas2D renderer (2026-07-12).** These are two independently-implemented rendering paths for the same document; nothing asserts they agree on geometry, fill, stroke, or text placement. `varve-print` has 44 Rust unit tests but none are golden/pixel comparisons against Canvas2D output. Deferred — moderate severity (a PDF export could silently drift from on-screen appearance with no test catching it), needs a shared fixture + rasterize-and-diff harness (e.g. render the PDF via a Rust PDF rasterizer, compare against a Canvas2D `OffscreenCanvas` render of the same document).
- **`display-p3` canvas color space is unused and would be inconsistent if adopted today.** Current research (2026-07): WebKit only documents `getContext('2d', {colorSpace:'display-p3'})` for macOS/iOS ports, not WebKitGTK; Firefox has no Display-P3 canvas/CSS support at all (tracked, not landed). If wide-gamut export is ever prioritized, it cannot be a uniform cross-target feature without a documented fallback for WebKitGTK Linux and Firefox — not attempted this session since the app doesn't request a non-default `colorSpace` anywhere today.
- **Print is PDF-export-only by design, confirmed 2026-07-12.** No `window.print()`/print CSS path exists in the browser build, and no Tauri-native print API is used — `exportNodeAsPdf` → `varve-print`'s lopdf PDF is the sole print answer for both targets. This matches the product's existing PDF/press-ready feature set (CMYK, marks, PDF-X per ADR); recorded here so a future session doesn't treat the absence of `window.print()` as an oversight.
- **WGSL has no single source of truth; circles skip the render-bundle cache.** See "WebGPU/WGSL Subsystem Correctness Pass (2026-07-12)" → Deferred, above, for detail on both.
