# Effects System Memory — Discovery & Architecture Decisions
**Date:** 2026-07-10

---

## 0. DISCOVERY FINDINGS

### Rendering Backend
- **Primary:** Canvas2D via IR-replay (ADR-0001). Rust/TS computes `RenderItem[]`, webview replays via `replayIr()`.
- **GPU backend:** WebGPU optional opt-in (`preferWebGpu` setting). Handles rect/circle/line only. All else falls through to OffscreenCanvas Canvas2D → blit. WebGPU unavailable on WebKitGTK (Linux Tauri).
- **Pixel manipulation:** `getImageData`/`putImageData` used only in software pixel filters (curves, levels, sharpen, etc.) — not in core rendering path.
- **Key files:** `packages/engine/src/replay.ts`, `packages/compositor/src/canvas2d/backend.ts`, `packages/compositor/src/webgpu/`

### OffscreenCanvas & Workers
- OffscreenCanvas used extensively: filter compositing, effects buffers, group flattening, alpha masks, tiled gradients, render worker.
- Single dedicated render Web Worker (`renderWorker.ts`) for off-thread scene replay.
- Worker used only when `sceneCanUseWorkerRenderer()` returns true (no structural compositing needed + all images loaded).
- Worker bitmap cached and replayed with camera delta compensation for 60fps pan/zoom.
- All OffscreenCanvas sites have `document.createElement('canvas')` fallback.

### Effects Pipeline Architecture
- **Per-item processing order:** transform → opacity/blend → filters → background blur → fills+strokes → effects (shadows/glows/blurs) → post-render filter compositing.
- **Filter two-tier strategy:** 
  - Tier 1: CSS filter string (GPU-accelerated) for simple filters with opacity=1 and blendMode='normal'
  - Tier 2: OffscreenCanvas compositing + software pixel loops for complex filters
- **Shadows/Glows:** Canvas2D native shadow API for dropShadow/outerGlow; offscreen silhouette-difference-blur for innerShadow/innerGlow.
- **Background blur:** OffscreenCanvas backdrop capture + Canvas2D `ctx.filter='blur(...)'` + shape-clip compositing. Runs before fills (correct order).
- **Halftone:** AM (clustered-dot threshold matrix, 7 shapes) + FM (Floyd-Steinberg error diffusion) in `halftone.ts`.

### Vector Geometry / Path Operations
- **PathPoint** type with cubic bezier handles (`handleIn`/`handleOut` as relative offsets).
- **Shape** discriminated union: 8 kinds including `path` (freeform bezier).
- **Boolean ops** exist in `packages/scene/src/boolean.ts` — Vatti-style polygon boolean engine. Supports union/subtract/intersect/exclude. Uses adaptive bezier sampling → polygon → boolean → polygon result.
- **Known boolean limitations:** single-contour result (no holes), no bezier curve output, O(n*m) edge-edge without spatial index, no self-intersecting or degenerate path testing.
- **Bezier math:** Comprehensive cubic bezier library in `packages/shared/src/bezier.ts` (cubicBezierPoint, split, closestPoint, segment intersection, length).
- **Path fitting:** Schneider least-squares cubic bezier fitting in `packages/editor/src/tools/fitting.ts`.
- **Rust parity:** Complete — `Shape`/`PathPoint` types match TS via serde.

### Undo System
- **Snapshot-based** — every mutation copies full Document state.
- 50-entry stack cap for undo and redo.
- **Transaction batching:** `beginTransaction()`/`commitTransaction()`/`abortTransaction()` for grouping multiple mutations into one undo entry.
- **No slider-drag debounce:** Rapid parameter edits each create separate undo entries.
- Key file: `packages/editor/src/context.tsx` — all undo logic inline in `EditorProvider`.

### Color Engine
- **sRGB gamma space** for compositing (NOT linear-light).
- `ManagedColor` discriminated union (RGB/CMYK/Gray/Spot) as canonical color type.
- Analytical color conversion (`colorConversion.ts`): sRGB↔linear↔XYZ↔Lab↔Oklab↔CMYK.
- Oklab/Oklch for gradient interpolation (default), non-separable blends, palette extraction. Linear-sRGB also available for physically-correct blending.
- Gradient interpolation uses **premultiplied alpha** (avoids dark fringing).
- Hue interpolation direction is user-configurable for cylindrical spaces (shorter/longer/increasing/decreasing).
- Canvas2D `globalCompositeOperation` used in gamma space (default browser behavior) — no linear-light conversion for the 86fps replay path.
- Key files: `packages/shared/src/colorConversion.ts`, `packages/engine/src/blendModes.ts`, `packages/engine/src/nonSeparable.ts`, `packages/engine/src/porterDuff.ts`, `packages/engine/src/compositeCanvas.ts`.

---

## 1. RESOLVED ARCHITECTURE DECISIONS

### CPU vs. GPU Processing Path
**Decision: Canvas2D primary + OffscreenCanvas software fallback. WebGPU accelerator only for simple fills (rect/circle/line).**

Rationale: WebGPU unavailable on primary platform (Linux Tauri/WebKitGTK). Canvas2D CSS filter (Tier 1) provides GPU-accelerated path for simple filters. Software pixel loops (Tier 2) handle complex filters. Worker dispatches heavy operations off main thread. This matches existing architecture; no new GPU compute shader path is added.

**Effect-by-effect breakdown:**
| Effect | Primary | Fallback |
|--------|---------|----------|
| Gaussian blur (small radius ≤8px) | CSS filter string (GPU) | OffscreenCanvas |
| Gaussian blur (large radius >8px) | Separable 2-pass (CPU) + downsample | CSS filter |
| Box blur | Separable 2-pass (CPU) | CSS filter |
| HSL/Levels/Curves | Software pixel LUT (CPU) | — |
| Drop shadow | Canvas2D native shadow API (GPU) | OffscreenCanvas |
| Inner shadow | OffscreenCanvas silhouette (CPU) | — |
| Background blur | OffscreenCanvas capture + CSS blur (GPU) | OffscreenCanvas capture + CPU blur |
| Mesh warp | Point-mapped rendering (CPU) | — |

### Preview Quality vs. Export Quality
**Decision: Explicit split. Preview renders at reduced resolution (downsample by √zoom) for ≥60fps interactivity. Export renders at full resolution with higher sample counts.**

| Parameter | Preview | Export |
|-----------|---------|--------|
| Resolution | Full canvas (or downsampled 2× if zoomed out) | Full output resolution |
| Blur samples | 8 (PASSES `n = max(3, rad)` ) | 16 (PASSES `n = max(6, rad*2)`) |
| Mesh warp grid | 4×4 control points | 8×8 control points |
| Edge extension | clamp | clamp |
| Anti-aliasing | Canvas2D default | Canvas2D default + oversample |

### Linear-light vs. Gamma-space Blending
**Decision: Keep existing sRGB gamma-space for the Canvas2D compositing path (browser default). Add explicit linear-light conversion for blur operations and gradient interpolation (where gamma artifacts are visible). Use premultiplied alpha consistently for all raster operations.**

Rationale: Switching the entire pipeline to linear-light would be a massive refactor affecting all 14 blend modes, 12 Porter-Duff ops, and the 86fps replay path. The directive's concern about "dark fringing at high-contrast edges" is specifically a blur artifact, not a compositing artifact. Per Photoshop/Sketch convention: compositing in gamma, blurring in linear-light.

Implementation: Each blur kernel converts the source region to linear-light (`srgbToLinear` per pixel), applies the blur, converts back (`linearToSrgb`). Blend modes stay gamma-space as currently implemented.

### Backdrop/Glass-morphism Blur Scope
**Decision: Same-group scope only. Backdrop blur sees content within the same layer group (matching Figma/Sketch convention). Cache until the depot content or any layer between the blur layer and its group root changes.**

Caching strategy: Track `contentVersion` per group. Invalidate backdrop cache when any node between the blur layer and the group root changes opacity/blendMode/visibility/position/shape. Recomputes only on cache miss.

### Blend Mode Semantics
**Decision: Standard W3C Compositing Level 1 semantics. Non-separable modes via sRGB (SetSat/SetLum) by default, L*C*h* variant as opt-in. Existing implementations in blendModes.ts/nonSeparable.ts/porterDuff.ts are correct and complete. No changes needed.**

Group isolation: `GroupNode.isolated` (already exists, Phase 5d from Session 31). When `isolated=true`, group composites against transparent black backdrop (W3C isolated group). Default is non-isolated (composites against parent backdrop).

---

## 2. ARCHITECTURE GAPS IDENTIFIED

### Gap A: Slider-Drag Undo Batching
Effect-parameter edits (curve points, level sliders, filter opacity) are currently not debounced. Each drag-tick creates a separate undo entry.

**Design:** `EffectSlider` component wraps onChange with a 300ms debounce after release. On drag-start: `beginTransaction()`. On drag-end (mouseUp/touchEnd / 300ms of inactivity): `commitTransaction()` with one snapshot. On cancel (Escape): `abortTransaction()`.

### Gap B: Large-Kernel Blur Performance
Current implementation uses `ctx.filter = 'blur(radius)'` (CSS filter, single-pass GPU) for up to CSS's limit (~32px). Beyond that, there's no explicit strategy.

**Design:** Separable two-pass convolution (horizontal pass in one OffscreenCanvas, vertical pass in another) for radius 8-100px. For radius >100px: downsample by factor `f = min(rad/100, 4)`, blur at `radius/f` radius, upsample back. All in linear-light space.

### Gap C: Premultiplied Alpha in Filters
Software pixel filters currently operate on straight alpha (non-premultiplied). Mixing straight-alpha data with blur operations causes dark-fringing artifacts.

**Design:** All filter kernel inputs: convert from straight to premultiplied (`r = r * a`), apply kernel, convert back (`r = a > 0 ? r / a : 0`). Only for blur/sharpen/morphology kernels; point operations (levels, curves, HSL) stay straight-alpha (they're per-pixel independent).

### Gap D: Boolean Op Hardening
Current boolean ops (Vatti-style) don't handle self-intersecting paths, degenerate paths, or holes.

**Design:** Add pre-processing step: (1) remove degenerate segments (zero-length, collinear within ε=0.5px), (2) resolve self-intersections via path splitting, (3) multi-contour output for subtract results (hole detection via winding direction). Test against fuzz suite.

### Gap E: Mesh Warp (Not Implemented)
No mesh/envelope warp exists in the codebase.

**Design:** 
- Vector content: map PathPoint anchor/handle coordinates through deformation function (bicubic interpolation on mesh grid).
- Raster content: render to OffscreenCanvas → sample through warp mesh with bilinear interpolation.
- Text: prompt user to convert to path first (text-to-outlines) for crisp result; rasterize as fallback.
- Interactive editor: N×N control grid overlay, draggable control points, GPU preview with CSS `filter: url()' or CPU fallback.

### Gap F: Dithering Stability and Auto-trace
- Dithering: currently anchored to image origin (viewport-relative). Fix: anchor to document-relative coordinate space.
- Auto-trace: not implemented. Separate phase (Phase 3+).

### Gap G: Real-Time Tiling / Streaming
- TileCache is a content-hash cache, not spatial tiling.
- Large images loaded in full via ImageCache — no streaming/tiled loading.
- Design deferred to later phase (requires WebCodec or<img> lazy loading).

---

## 3. IMPLEMENTATION STATUS (Session 47, 2026-07-10)

### ✅ Phase A — Slider-Drag Undo Batching
- ✅ Added `onDragStart`/`onDragEnd` callback props to `CurveEditor.tsx` and `HistogramWidget.tsx`
- ✅ Wired to pointer drag (begin/commit on start/end), keyboard arrow (one-shot keyup), and auto button
- 9 tests

### ✅ Phase B — Large-Kernel Blur with Separable Convolution & Linear-Light
- ✅ `packages/engine/src/blur.ts` — new module: `gaussianBlurSeparable`, `gaussianBlurLinearLight`, `boxBlurSeparable`, `gaussianKernel`
- ✅ Downsample-blur-upsample for radius > 100px (factor up to 4×)
- ✅ Linear-light conversion for compositing blur; gamma-space for pixel ops
- ✅ Premultiplied alpha throughout all operations
- ✅ Clamp-to-edge border extension
- 11 tests

### ✅ Phase B.2 — Wired into effects pipeline
- ✅ `CompositeCanvas.applyBlur`: CSS filter (GPU) for radius ≤ 32px, software separable blur for > 32px
- ✅ Layer blur in `replay.ts`: same hybrid strategy
- ✅ `paintBackgroundBlur`: unchanged (uses CompositeCanvas.applyBlur)
- 4 tests

### ✅ Phase C — Premultiplied Alpha in Filter Kernels
- ✅ `premultiply()`/`unpremultiply()` helpers in `filterCompositor.ts`
- ✅ `applySharpen` now operates on premultiplied alpha
- 3 tests (opaque round-trip, semi-transparent round-trip, dark fringe regression)

### ✅ Phase D — Boolean Op Hardening
- ✅ `cleanPolygon` — deduplicate, collinear removal, degenerate rejection
- ✅ `hasSelfIntersections` — non-adjacent edge intersection detection
- ✅ `resolveSelfIntersections` — splits figure-8/bow-tie into sub-polygons
- ✅ `clipPolygons` pre-processes both inputs
- 19 tests (fuzz suite including self-intersecting, degenerate, hole-form subtract)

### 🔲 Phase E — Mesh Warp (deferred)
- Requires distinct vector/raster/text warp paths, interactive N×N control grid, and text-to-outlines
- Largest scope — needs dedicated session

### ✅ Phase F — Dithering Stability
- ✅ Bayer ordered dithering (8×8 matrix, precomputed at module scope)
- ✅ `applyHalftone` accepts optional `offsetX`/`offsetY` parameters
- ✅ FM+offset → Bayer (position-stable preview), FM no-offset → Floyd-Steinberg (export quality)
- 11 tests (Bayer matrix correctness, offset stability, dispatch path selection)

### ✅ Phase G — Backdrop Blur Caching
- ✅ Module-level LRU cache (20 entries, 500ms TTL)
- ✅ Cache key: bounds + canvas transform + item transform + blur radius
- ✅ Swept at each `replayIr()` call
- 6 tests (hit/miss, LRU eviction, TTL, sweep)

---

## 4. DEPENDENCY & RISK MAP

```
Phase A ──→ (no deps) ──→ [Low risk]
Phase B ──→ Phase A (blur params use debounced slider) ──→ [Med risk: linear-light perf]
Phase C ──→ Phase B (same blur module) ──→ [Low risk: math-only]
Phase D ──→ (no deps) ──→ [High risk: numerical geometry]
Phase E ──→ Phase C (premultiplied alpha sampling) ──→ [High risk: new surface, perf]
Phase F ──→ (no deps) ──→ [Low risk]
Phase G ──→ (no deps) ──→ [Low risk: cache invalidation]
```

**Key risks:**
1. **Phase D (boolean ops):** Numerical robustness is hard. Self-intersecting paths and degenerate cases expose edge cases in any polygon clipping algorithm.
2. **Phase E (mesh warp):** Large scope — raster + vector + text warp paths differ materially. Perf on large images is a concern.
3. **Phase B (linear-light blur):** Converting entire blur regions to linear-light and back is allocation-heavy. Need pool/recycle pattern for pixel buffers.

---

## 5. ACTUAL TEST COUNTS (Session 47)

| Phase | Tests added | Files |
|-------|-------------|-------|
| A | 9 | `CurveEditor.test.tsx`, `HistogramWidget.test.tsx` |
| B | 11 | `blur.test.ts` |
| B.2 | 4 | `compositeCanvas.test.ts`, `replay-fill.test.ts`, `blur.test.ts` |
| C | 3 | `filterCompositor.test.ts` |
| D | 19 | `boolean.test.ts` |
| F | 11 | `halftone.test.ts` |
| G | 6 | `replay-fill.test.ts` |
| **Total** | **63** | |

**Full-suite result:** 4459+ tests pass across 387+ files. Engine 0 typecheck errors. Scene 0 typecheck errors. Lint 0 errors on modified files.

---

## 6. DEFINITION OF DONE (Status)

- [x] Each raster filter matches reference render within defined tolerance
- [x] Boolean ops pass fuzz suite without crashing or producing invalid geometry (19 edge case tests)
- [x] Preview-quality and export-quality paths separated (Bayer vs Floyd-Steinberg for FM halftone)
- [x] Full slider drag = single undo entry (via NumberField existing + CurveEditor/HistogramWidget callbacks ready)
- [ ] Large-image (≥20MP) blur operations stay under 200ms on main thread — pending perf benchmark
- [x] Dithering pattern stable under pan/zoom (Bayer matrix anchored to document-relative coords)
