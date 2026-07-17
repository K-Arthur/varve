# Image Tracing Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Bezier parameters, add configurable contour/centerline tracing, color quantization, and contour hierarchy across TypeScript, WASM, and Rust backends.

**Architecture:** Extend `LiveTraceParams` contract → implement missing features in Rust `strata-trace` crate → expose via WASM + Tauri IPC → update TypeScript providers → update UI controls. The Rust crate becomes the primary implementation.

**Tech Stack:** Rust (strata-trace, strata-wasm, strata-bridge), TypeScript (rasterTrace.ts, traceBezierFit.ts, imageOperations.ts, scene/liveTrace.ts), Tauri 2, wasm-bindgen.

---

## Current State (2026-07-17 Audit)

| Gap | Evidence |
|-----|----------|
| Hardcoded Bezier params | `imageOperations.ts:145,211`: `{ maxError: 0.5, cornerAngle: 135 }` |
| `cornerAngle`/`maxError` not in `LiveTraceParams` | `scene/types.ts:753-763`: 9 fields, no bezier params |
| Rust only outputs polylines | `strata-trace/src/lib.rs`: `trace_contours()` → `Vec<Path>` where `Path.points: Vec<Point>` |
| Color quantization only in TS | `rasterTrace.ts:298-392`: `quantizePalette()` in TS only |
| WASM monochrome only | `strata-wasm/src/lib.rs:76-166`: no color, no holes, no bezier |
| Hole detection only in TS (basic) | `rasterTrace.ts:229-238`: signed area for outer/hole classification |
| No centerline tracing | Zero code found for Zhang-Suen / skeletonization |
| Two redundant Bezier fitters | `engine/traceBezierFit.ts` vs `editor/tools/fitting.ts` (different defaults) |
| Native trace only supports monochrome | `nativeTraceProvider.ts:15`: `(options.mode ?? 'monochrome') === 'monochrome'` |

---

## Milestone 1: Shared Trace Contract

### Task 1.1: Extend LiveTraceParams

**Files:**
- Modify: `packages/scene/src/types.ts` (LiveTraceParams interface + defaultLiveTraceParams)
- Modify: `packages/scene/src/liveTrace.ts` (version handling)
- Modify: `packages/scene/src/liveTrace.test.ts` (new field defaults)
- Modify: `packages/scene/src/version.ts` (version bump)

**Changes to LiveTraceParams:**
Add these new fields:
- `cornerAngle?: number` — interior angle threshold (degrees) for sharp corners. Default 135.
- `maxError?: number` — maximum Bezier fitting error in pixels. Default 1.0.
- `traceMode?: 'silhouette' | 'centerline'` — tracing mode. Default 'silhouette'.
- `centerlineWidth?: number` — target stroke width in pixels for centerline mode. Default 2.
- `centerlinePrune?: number` — minimum branch length to keep in centerline mode (px). Default 4.
- `traceVersion?: number` — schema version for migration. Current should be 2.

The `defaultLiveTraceParams()` function returns version 2 defaults. When `traceVersion` is undefined or 1, the migration fills in defaults for new fields and converts old field names.

Add to `LiveTraceParams`:
```typescript
export interface LiveTraceParams {
  // ... existing 9 fields ...
  /** Schema version. 1 = pre-overhaul (no bezier/centerline). 2 = current. */
  traceVersion?: number;
  /** Trace mode: silhouette (filled) or centerline (stroked). */
  traceMode?: 'silhouette' | 'centerline';
  /** Interior angle threshold for sharp corners (degrees, 90-180). Default 135. */
  cornerAngle?: number;
  /** Maximum Bezier fitting error (pixels, 0.1-10). Default 1.0. */
  maxError?: number;
  /** Target stroke width for centerline mode (pixels). Default 2. */
  centerlineWidth?: number;
  /** Minimum branch length to keep (pixels). Default 4. */
  centerlinePrune?: number;
}
```

### Task 1.2: Add version migration

**Files:**
- Modify: `packages/scene/src/version.ts` (schema migration)
- Create: `packages/scene/src/version.test.ts` (new migration tests)

Add `migrateLiveTraceParams(params: LiveTraceParams, fromVersion: number): LiveTraceParams`:
- v1 → v2: add `traceMode: 'silhouette'`, `cornerAngle: 135`, `maxError: 1.0`, `centerlineWidth: 2`, `centerlinePrune: 4`

### Task 1.3: Move hardcoded Bezier params from imageOperations.ts

**Files:**
- Modify: `packages/editor/src/imageOperations.ts` (read from params instead of hardcoded)
- Modify: `packages/editor/src/imageOperations.test.ts` (update tests to pass new params)

In `insertTraceGroup` and `insertLiveTraceGroup`, remove:
```typescript
fitBezierToContour(scaled, closed, { maxError: 0.5, cornerAngle: 135 });
```
Replace with reading from `LiveTraceParams` that are passed through the call chain. The `insertTraceGroup` function needs to accept an optional params argument.

### Task 1.4: Wire params through trace call chain

**Files:**
- Modify: `packages/engine/src/rasterTrace.ts` (accept new params, pass to bezier fitting)
- Modify: `packages/engine/src/types.ts` (update RasterTraceOptions with new fields)

Add to `RasterTraceOptions`:
```typescript
cornerAngle?: number;
maxError?: number;
traceMode?: 'silhouette' | 'centerline';
centerlineWidth?: number;
centerlinePrune?: number;
```

The `traceRasterToPaths()` function passes these through.

### Task 1.5: Unify Bezier fitting call sites

**Files:**
- Modify: `packages/engine/src/traceBezierFit.ts` (export as canonical fitter)
- Modify: `packages/editor/src/tools/fitting.ts` (import from engine, remove redundant code)

The `traceBezierFit.ts` version uses Schneider least-squares. The `fitting.ts` version also uses Schneider but with different defaults and a tangent-based corner detection. Make `traceBezierFit.ts` the canonical implementation and have `fitting.ts` delegate to it.

Actually, `fitting.ts` has `fitPathToBeziers()` which does corner detection + segment fitting. `traceBezierFit.ts` has `fitBezierToContour()` which does corner-angle detection + recursive subdivision. They serve different purposes (Pencil tool vs contour tracing). Keep both but ensure they share the same Schneider solver.

Extract `fitCubicLeastSquares` and `fitSegmentRecursive` into a shared helper. The `fitting.ts` corner detection (tangent-based, 30°) and `traceBezierFit.ts` corner detection (interior angle, 135° default) serve different use cases and should remain configurable.

---

## Milestone 2: Bezier Fitting in Rust

### Task 2.1: Add Bezier types to strata-trace

**Files:**
- Modify: `crates/strata-trace/src/lib.rs` (add BezierPath, BezierPoint types)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BezierPoint {
    pub x: f64,
    pub y: f64,
    pub handle_in: Option<(f64, f64)>,
    pub handle_out: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BezierPath {
    pub points: Vec<BezierPoint>,
    pub closed: bool,
    pub fill: Option<RgbColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}
```

### Task 2.2: Implement Bezier fitting in Rust

**Files:**
- Create: `crates/strata-trace/src/bezier_fit.rs`

Implement the Schneider algorithm (matching `traceBezierFit.ts`):
- `fit_path_to_beziers(polyline: &[Point], closed: bool, corner_angle: f64, max_error: f64) -> Vec<BezierPoint>`

This should be a direct port of the TypeScript `fitBezierToContour()` from `traceBezierFit.ts`:
- Corner detection by interior angle
- Chord-length parameterization
- Least-squares cubic Bezier fitting
- Recursive subdivision when error exceeds threshold
- Handle generation from fitted Bezier coefficients
- Deduplication of coincident endpoints for closed paths

### Task 2.3: Add Bezier fitting tests in Rust

**Files:**
- Modify: `crates/strata-trace/src/bezier_fit.rs` (`#[cfg(test)] mod tests`)

Tests matching the TypeScript `traceBezierFit.test.ts`:
- Straight line → minimal handles
- Curved contour → generated handles
- Right-angle corner → preserved
- Square → 4 corner points
- Smooth circle → reduced anchors
- Deterministic output
- Closed contour endpoint dedup

### Task 2.4: Integrate Bezier fitting into trace pipeline

**Files:**
- Modify: `crates/strata-trace/src/lib.rs` (add `trace_to_beziers` function)

Add a `trace_to_beziers(pixels, width, height, opts) -> Vec<BezierPath>` function that:
1. Calls `trace_contours()` to get polylines
2. Calls `fit_path_to_beziers()` on each path
3. Returns fitted Bezier paths

### Task 2.5: Add Bezier fitting to TraceOptions

**Files:**
- Modify: `crates/strata-trace/src/lib.rs`

Add to `TraceOptions`:
```rust
pub corner_angle: f64,    // degrees, default 135.0
pub max_error: f64,        // pixels, default 1.0
```

---

## Milestone 3: Color Quantization in Rust

### Task 3.1: Implement median-cut quantization

**Files:**
- Create: `crates/strata-trace/src/quantize.rs`

Implement Oklab-based median-cut quantization matching `rasterTrace.ts:298-392`:
- Convert RGBA pixels to Oklab
- Skip alpha < threshold
- Recursive median-cut splitting along the widest Oklab axis
- Output: sorted palette with pixel counts

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantizedColor {
    pub r: u8, pub g: u8, pub b: u8, pub a: u8,
    pub count: usize,
}

pub fn quantize_palette(pixels: &[u8], width: u32, height: u32, max_colors: u8, alpha_threshold: u8) -> Vec<QuantizedColor>
```

### Task 3.2: Implement per-color mask tracing

**Files:**
- Modify: `crates/strata-trace/src/lib.rs`

Add multi-color tracing:
1. Quantize palette
2. For each color, create binary mask of assigned pixels
3. Trace each mask independently
4. Assign fill color to each traced path
5. Filter near-white background buckets (>40% image area)
6. Apply min_pixels and max_paths per color

```rust
pub fn trace_color(pixels: &[u8], width: u32, height: u32, opts: &TraceOptions) -> Vec<ColoredPath>
```

### Task 3.3: Add quantize tests

**Files:**
- Modify: `crates/strata-trace/src/quantize.rs` (tests)

Tests:
- Quantize 2-color image → 2 colors (+ white if present)
- Quantize grayscale → 1-4 grays
- Alpha < threshold → skipped
- Deterministic across runs
- Empty/transparent → empty palette

---

## Milestone 4: Contour Hierarchy

### Task 4.1: Implement hole pairing in Rust

**Files:**
- Create: `crates/strata-trace/src/hierarchy.rs`

Implement proper contour nesting using point-in-polygon containment:
- For each multi-pixel component, collect all contours (outers + holes)
- Classify each loop by signed area (positive = outer CW, negative = hole CCW)
- Sort outers by area descending
- For each hole, find the smallest outer that contains any hole point
- Attach holes to their outer as `holes: Vec<Vec<Point>>`
- Unmatched holes become `omitted_holes`

```rust
pub struct CompoundPath {
    pub outer: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
    pub fill: Option<RgbColor>,
}

pub fn pair_holes(outers: Vec<Vec<Point>>, hole_loops: Vec<Vec<Point>>) -> (Vec<CompoundPath>, usize)
```

Use winding number for point-in-polygon, with epsilon tolerance for anti-aliased boundaries.

### Task 4.2: Add hierarchy tests

**Files:**
- Modify: `crates/strata-trace/src/hierarchy.rs` (tests)

Tests:
- Donut (square with square hole) → 1 compound path with 1 hole
- Multiple holes in one shape → all holes attached to same outer
- Nested islands (hole inside hole, with island) → correct nesting
- Two separate shapes → 2 independent paths
- No holes → all paths are outers

---

## Milestone 5: Centerline Tracing

### Task 5.1: Implement Zhang-Suen thinning

**Files:**
- Create: `crates/strata-trace/src/centerline.rs`

Implement Zhang-Suen parallel thinning algorithm for skeletonization:
- Input: binary image
- Output: thinned binary image (1-pixel-wide skeletons)

```rust
pub fn thin_image(binary: &[bool], width: u32, height: u32) -> Vec<bool>
```

### Task 5.2: Implement skeleton graph extraction

**Files:**
- Modify: `crates/strata-trace/src/centerline.rs`

Convert thinned image to graph:
- Find all foreground pixels
- Classify each pixel: endpoint (1 neighbor), junction (3+ neighbors), path (2 neighbors)
- Build adjacency graph
- Extract paths between endpoints/junctions

```rust
pub struct SkeletonGraph {
    pub branches: Vec<Vec<Point>>,
    pub junctions: Vec<Point>,
}

pub fn extract_skeleton_graph(skeleton: &[bool], width: u32, height: u32) -> SkeletonGraph
```

### Task 5.3: Implement branch pruning and path extraction

**Files:**
- Modify: `crates/strata-trace/src/centerline.rs`

- Prune branches shorter than `min_branch_length`
- Smooth each branch with Bezier fitting
- Classify each branch as open or closed (loop detection)
- Assign stroke width

```rust
pub struct CenterlinePath {
    pub points: Vec<BezierPoint>,
    pub closed: bool,
    pub width: f64,
}

pub fn extract_centerlines(
    skeleton: &[bool],
    width: u32, height: u32,
    min_branch: f64,
    corner_angle: f64,
    max_error: f64,
) -> Vec<CenterlinePath>
```

### Task 5.4: Add centerline tests

**Files:**
- Modify: `crates/strata-trace/src/centerline.rs` (tests)

Tests:
- Single straight line → 1 path
- Cross with 4 branches → 4 paths (after pruning)
- Circle (loop) → 1 closed path
- Very short branch → pruned
- Bezier fitting on curved skeleton branch

---

## Milestone 6: Backend Wiring

### Task 6.1: Update Rust TraceOptions

**Files:**
- Modify: `crates/strata-trace/src/lib.rs` (expanded TraceOptions)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceOptions {
    pub threshold: u8,
    pub min_pixels: usize,
    pub max_colors: u8,
    pub foreground: Foreground,
    // NEW:
    pub corner_angle: f64,
    pub max_error: f64,
    pub trace_mode: TraceMode,
    pub centerline_width: f64,
    pub centerline_prune: f64,
    pub max_paths: usize,
    pub compound_holes: bool,
    pub alpha_threshold: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceMode {
    Silhouette,
    Centerline,
}
```

Update `trace_contours()` to accept and use new options:
- If `max_colors > 0` and `mode != color`: use quantize+trace loop
- If `trace_mode == centerline`: use thinning + skeleton extraction
- If `corner_angle` or `max_error` is set: apply Bezier fitting

### Task 6.2: Update WASM bindings

**Files:**
- Modify: `crates/strata-wasm/src/lib.rs`

Update `trace_contours_json` to accept new options via a JSON string parameter:
```rust
pub fn trace_contours_json(
    pixels: &[u8],
    width: u32,
    height: u32,
    opts_json: &str,  // NEW: pass all options as JSON
) -> Result<String, JsValue>
```

Parse `opts_json` as JSON-serialized trace options. Keep the old flat-parameter overload for backward compat.

### Task 6.3: Update Tauri trace_image command

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

Update `TraceImageOptions` to include all new fields. Update `trace_image()` to:
- Support color mode (quantize + trace per color)
- Support centerline mode
- Return Bezier paths instead of raw polylines
- Support hole pairing

### Task 6.4: Update nativeTraceProvider

**Files:**
- Modify: `packages/engine/src/upscaleProviders/nativeTraceProvider.ts`

Remove the monochrome-only restriction. Pass all new options as JSON.

### Task 6.5: Update wasmTraceProvider

**Files:**
- Modify: `packages/engine/src/upscaleProviders/wasmTraceProvider.ts`
- Modify: `packages/engine/src/wasmLoader.ts`

Update WASM trace loader to match new function signature. Pass options as JSON string.

### Task 6.6: Update TypeScript rasterTrace.ts

**Files:**
- Modify: `packages/engine/src/rasterTrace.ts`

Add `traceMode: 'centerline'` support to the TypeScript fallback path:
- For centerline mode, implement a basic skeletonization in TS
- For color mode, pass `cornerAngle` and `maxError` through to bezier fitting

### Task 6.7: Update traceDispatch provider chain

**Files:**
- Modify: `packages/engine/src/upscaleProviders/traceDispatch.ts`

Update capability detection in each provider's `isAvailable()`:
- Native provider: always available on Tauri
- WASM: always available when module loads
- Worker: always available
- Direct: always available (last resort)

Update fallback chain to try all providers and report which features each supports.

---

## Milestone 7: UI Integration

### Task 7.1: Add trace mode selector

**Files:**
- Create/Modify: Trace UI panel (find existing trace controls)

Add radio/segmented control for silhouette vs centerline mode.

### Task 7.2: Add Bezier controls

Add NumberInput for:
- Corner angle (90-180, default 135)
- Max error (0.1-10, default 1.0)

### Task 7.3: Add centerline controls

Add NumberInput for:
- Stroke width (1-20, default 2)
- Branch pruning (1-50, default 4)

### Task 7.4: Add presets

Add preset dropdown for common configurations:
- Logo: monochrome, silhouette, cornerAngle=150, maxError=1.0
- Photo: color, maxColors=8, silhouette, cornerAngle=135
- Line Art: monochrome, centerline, width=2, prune=4
- Sketch: grayscale, centerline, width=1, prune=2
- Monochrome Icon: monochrome, silhouette, cornerAngle=90, maxError=0.5

### Task 7.5: Wire through canvas preview

Ensure param changes trigger debounced re-trace with AbortController cancellation.

---

## Milestone 8: Fixtures and Tests

### Task 8.1: Create PNG fixture set

Create `tests/fixtures/trace/` directory with:
- `bw-logo.png` — 100x100 black-and-white logo shape
- `anti-aliased-icon.png` — 64x64 icon with AA edges
- `line-drawing.png` — 200x200 line art
- `handwriting-sample.png` — handwritten text
- `tech-diagram.png` — 300x200 diagram with arrows/lines
- `flat-color-illustration.png` — 200x150 4-color flat illustration
- `nested-holes.png` — 50x50 donut shape
- `transparent-bg.png` — 100x100 semi-transparent shape
- `noisy-scan.png` — 200x200 low-quality scan
- `simple-gradient.png` — 100x100 gradient (hard case)

Generate programmatically using canvas, not from external images.

### Task 8.2: Add Rust fitter parity tests

**Files:**
- Create: `packages/engine/src/traceContractRust.test.ts`

Test that Rust and TypeScript Bezier fitting produce compatible results:
- Same input contour → same number of points
- Within epsilon for coordinate values

### Task 8.3: Add backend parity tests

**Files:**
- Create: `packages/engine/src/traceBackendParity.test.ts`

For each fixture, verify that all available backends produce:
- Same path count
- Same topology (holes match)
- Same fill colors
- Within bounds tolerance

### Task 8.4: Add centerline output tests

**Files:**
- Test that centerline mode produces stroked paths
- Test that centerline mode preserves topology
- Test that pruning removes short branches

### Task 8.5: Add E2E trace tests

**Files:**
- Create: `tests/e2e/canvas/trace.spec.ts`

Playwright tests:
- Import PNG → trace → verify layer count
- Change params → verify preview updates
- Flatten trace → verify editable paths
- Undo/redo trace operations

### Task 8.6: Run all verification gates

```bash
pnpm typecheck && pnpm lint && pnpm test && just gate
```

---

## Execution Order

1. **M1 Tasks 1.1-1.5** — Contract changes (no behavior change, just schema)
2. **M2 Tasks 2.1-2.5** — Rust Bezier fitting (new capability, tested)
3. **M3 Tasks 3.1-3.3** — Rust color quantization
4. **M4 Tasks 4.1-4.2** — Rust contour hierarchy
5. **M5 Tasks 5.1-5.4** — Rust centerline tracing
6. **M6 Tasks 6.1-6.7** — Backend wiring
7. **M7 Tasks 7.1-7.5** — UI integration
8. **M8 Tasks 8.1-8.6** — Tests + verification

Each milestone produces working, tested, commit-able code.

## Verification Checklist

After each milestone:
- [ ] `cargo test --workspace` passes
- [ ] `pnpm typecheck` passes (17/17 packages)
- [ ] `pnpm lint` passes (0 new errors)
- [ ] `pnpm audit:tokens` passes
- [ ] `pnpm audit:emoji` passes
- [ ] `pnpm test` passes
