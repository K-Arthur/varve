# WASM Trace, Effect Replay & PDF Pattern Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve three architectural limitations — WASM sequential tracing, duplicated effect replay logic, and PDF pattern placeholders — with tested, cross-platform implementations.

**Architecture:** (1) Chunked cooperative WASM tracing with capability-aware fallback hierarchy. (2) Extracted canonical effect-pipeline module consumed by both flat-IR replay and structural group replay. (3) Resource-manifest architecture passing decoded image bytes to Rust for genuine PDF tiling patterns.

**Tech Stack:** Rust (strata-trace, strata-print, strata-wasm), TypeScript (replay.ts, CanvasArea.tsx, compositeCanvas.ts), Web Workers, wasm-bindgen, lopdf, offscreen canvas.

---

## Milestone A: Audit, Tests & Benchmark Scaffolding

### Task A1: WASM trace agreement tests

**Files:**
- Create: `crates/strata-trace/src/trace_agreement.rs`
- Create: `crates/strata-trace/src/chunked.rs`

- [ ] **Step 1: Write failing agreement test**

```rust
// crates/strata-trace/src/trace_agreement.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{trace_contours, TraceOptions};

    fn make_bitmap(w: u32, h: u32) -> Vec<u8> {
        let mut px = vec![0u8; (w * h) as usize];
        // Draw a 10x10 white square in the center
        for y in 10..20 {
            for x in 10..20 {
                px[(y * w + x) as usize] = 255;
            }
        }
        px
    }

    #[test]
    fn chunked_agrees_with_single_chunk() {
        let px = make_bitmap(32, 32);
        let opts = TraceOptions::default();
        let single = trace_contours(&px, 32, 32, &opts);
        let chunked = crate::chunked::trace_contours_chunked(&px, 32, 32, &opts, 4);
        assert_eq!(single.len(), chunked.len(),
            "chunked should produce same number of paths as single-chunk");
        for (a, b) in single.iter().zip(chunked.iter()) {
            assert_eq!(a.points.len(), b.points.len());
            for (pa, pb) in a.points.iter().zip(b.points.iter()) {
                assert!((pa.x - pb.x).abs() < 0.01 && (pa.y - pb.y).abs() < 0.01,
                    "point mismatch: {:?} vs {:?}", pa, pb);
            }
        }
    }

    #[test]
    fn chunked_empty_bitmap() {
        let px = vec![0u8; 1024];
        let opts = TraceOptions::default();
        let paths = crate::chunked::trace_contours_chunked(&px, 32, 32, &opts, 4);
        assert!(paths.is_empty());
    }

    #[test]
    fn chunked_large_bitmap() {
        let mut px = vec![0u8; 256 * 256];
        // Draw a large filled circle-ish shape
        for y in 0..256 {
            for x in 0..256 {
                let dx = x as f64 - 128.0;
                let dy = y as f64 - 128.0;
                if dx * dx + dy * dy < 80.0 * 80.0 {
                    px[y * 256 + x] = 200;
                }
            }
        }
        let opts = TraceOptions::default();
        let single = trace_contours(&px, 256, 256, &opts);
        let chunked = crate::chunked::trace_contours_chunked(&px, 256, 256, &opts, 8);
        assert_eq!(single.len(), chunked.len());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/karthur/CodingProjects/Strata && cargo test --manifest-path crates/strata-trace/Cargo.toml -- chunked_agrees
```

Expected: FAIL (module `chunked` not found)

- [ ] **Step 3: Implement chunked tracing**

Create `crates/strata-trace/src/chunked.rs` with a `trace_contours_chunked` function that manually partitions seeds into N chunks and processes each sequentially, storing a shared `visited` bitmap per chunk. The key insight: the sequential `trace_chunk` already works on a subset of seeds. We just need to split seeds and call `trace_chunk` per partition.

Create `crates/strata-trace/src/trace_agreement.rs` as a test-only module.

- [ ] **Step 4: Run test to verify it passes**

```bash
cargo test --manifest-path crates/strata-trace/Cargo.toml -- chunked
```

Expected: PASS

- [ ] **Step 5: Commit**

### Task A2: Effect replay extraction tests

**Files:**
- Create: `packages/engine/src/effectPipeline.ts`
- Create: `packages/engine/src/effectPipeline.test.ts`

- [ ] **Step 1: Write failing tests for extracted pipeline**

```typescript
// effectPipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyGlassMaterialBackdrop,
  applyBackgroundBlurBackdrop,
  computeScreenBounds,
} from './effectPipeline';

describe('effectPipeline', () => {
  describe('computeScreenBounds', () => {
    it('maps world rect to screen rect via affine transform', () => {
      const m = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
      const result = computeScreenBounds(m, 10, 20, 50, 30);
      expect(result.x).toBe(120); // 2*10 + 0*20 + 100
      expect(result.y).toBe(90);  // 0*10 + 2*20 + 50
      expect(result.w).toBe(100); // 2*50
      expect(result.h).toBe(60);  // 2*30
    });

    it('handles rotation (non-axis-aligned)', () => {
      const angle = Math.PI / 4; // 45 degrees
      const m = {
        a: Math.cos(angle), b: Math.sin(angle),
        c: -Math.sin(angle), d: Math.cos(angle),
        e: 0, f: 0,
      };
      const bounds = computeScreenBounds(m, 0, 0, 10, 10);
      // Rotated 10x10 square has ~14.14 extent
      expect(bounds.w).toBeGreaterThan(14);
      expect(bounds.h).toBeGreaterThan(14);
    });
  });

  describe('applyGlassMaterialBackdrop', () => {
    it('applies tint, saturation, brightness, noise to canvas', () => {
      // Create a small test canvas with known pixels
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgb(128, 128, 128)';
      ctx.fillRect(0, 0, 4, 4);

      applyGlassMaterialBackdrop(canvas, {
        blur: 0,
        tint: { space: 'rgb', r: 255, g: 0, b: 0, a: 1 },
        tintOpacity: 0.5,
        saturation: 1.5,
        brightness: 1.2,
        noise: 0,
        opacity: 1,
        visible: true,
        type: 'glassMaterial',
        blendMode: 'normal',
      });

      const data = ctx.getImageData(0, 0, 4, 4).data;
      // Tint at 50% red on gray → should shift toward red
      expect(data[0]).toBeGreaterThan(128); // R shifted up
      expect(data[1]).toBeLessThan(128);   // G shifted down
    });

    it('applies deterministic noise', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgb(128, 128, 128)';
      ctx.fillRect(0, 0, 2, 2);

      applyGlassMaterialBackdrop(canvas, {
        blur: 0,
        tint: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
        tintOpacity: 0,
        saturation: 1,
        brightness: 1,
        noise: 0.5,
        opacity: 1,
        visible: true,
        type: 'glassMaterial',
        blendMode: 'normal',
      });

      const data = ctx.getImageData(0, 0, 2, 2).data;
      // Noise should produce different values at different pixels
      const differences = [
        Math.abs(data[0] - data[4]),
        Math.abs(data[1] - data[5]),
      ];
      expect(differences.some(d => d > 0)).toBe(true);
    });
  });

  describe('applyBackgroundBlurBackdrop', () => {
    it('blurs the canvas content', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d')!;
      // Draw a sharp edge
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 4, 8);
      ctx.fillStyle = 'white';
      ctx.fillRect(4, 0, 4, 8);

      applyBackgroundBlurBackdrop(canvas, 2);

      const data = ctx.getImageData(0, 0, 8, 8).data;
      // After blur, the sharp edge at x=4 should be softened
      // Check that pixel at (3,4) and (4,4) are closer together than before
      const edgeDiff = Math.abs(data[3 * 4 + 3 * 4] - data[3 * 4 + 4 * 4]);
      // A non-blurred edge would have |0-255| = 255
      // A blurred edge should be less
      expect(edgeDiff).toBeLessThan(255);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @varve/engine test -- effectPipeline
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement the extracted pipeline**

Create `packages/engine/src/effectPipeline.ts` with:
- `computeScreenBounds(transform, x, y, w, h)` — world→screen bounds mapping
- `applyGlassMaterialBackdrop(canvas, effect)` — tint/saturation/brightness/noise pixel pipeline
- `applyBackgroundBlurBackdrop(canvas, radius)` — blur application

These are extracted from the identical code in `replay.ts:338-451` and `CanvasArea.tsx:1691-1831`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @varve/engine test -- effectPipeline
```

Expected: PASS

- [ ] **Step 5: Commit**

### Task A3: PDF resource manifest types

**Files:**
- Create: `crates/strata-print/src/resources.rs`
- Create: `crates/strata-print/src/resources.rs` (types only, no impl yet)
- Modify: `crates/strata-print/src/lib.rs` (add `mod resources;`)

- [ ] **Step 1: Write failing type tests**

```rust
// In resources.rs or a test in lib.rs
#[cfg(test)]
mod resource_tests {
    use super::resources::*;

    #[test]
    fn resource_manifest_roundtrip() {
        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "img_0".into(),
                mime_type: "image/png".into(),
                width: 100,
                height: 80,
                data: vec![0u8; 100 * 80 * 4],
                color_space: ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat_0".into(),
                tile_image_id: "img_0".into(),
                spacing: 10.0,
                rotation: 0.0,
                tile_width: 32.0,
                tile_height: 32.0,
            }],
        };
        let json = serde_json::to_string(&manifest).unwrap();
        let parsed: ExportManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.images.len(), 1);
        assert_eq!(parsed.images[0].id, "img_0");
        assert_eq!(parsed.patterns.len(), 1);
        assert_eq!(parsed.patterns[0].tile_image_id, "img_0");
    }

    #[test]
    fn image_resource_validates_dimensions() {
        let img = ImageResource {
            id: "test".into(),
            mime_type: "image/png".into(),
            width: 0,
            height: 0,
            data: vec![],
            color_space: ColorSpace::Rgb,
        };
        assert!(!img.is_valid(), "zero-dimension image should be invalid");
    }

    #[test]
    fn missing_resource_produces_structured_error() {
        let manifest = ExportManifest {
            images: vec![],
            patterns: vec![],
        };
        let err = manifest.resolve_image("nonexistent");
        assert!(err.is_err());
        let err_msg = err.unwrap_err();
        assert!(err_msg.contains("nonexistent"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test --manifest-path crates/strata-print/Cargo.toml -- resource
```

Expected: FAIL (module `resources` not found)

- [ ] **Step 3: Implement resource types**

Create `crates/strata-print/src/resources.rs` with `ExportManifest`, `ImageResource`, `PatternResource`, `ColorSpace`, validation, and resolution methods.

- [ ] **Step 4: Run test to verify it passes**

```bash
cargo test --manifest-path crates/strata-print/Cargo.toml -- resource
```

Expected: PASS

- [ ] **Step 5: Commit**

---

## Milestone B: WASM Trace Execution Strategy

### Task B1: Chunked cooperative tracing in strata-wasm

**Files:**
- Modify: `crates/strata-trace/src/chunked.rs` (already created in A1)
- Modify: `crates/strata-wasm/src/lib.rs` (wire chunked path)

- [ ] **Step 1: Wire chunked tracing into WASM exports**

The existing `trace_contours_json` in `strata-wasm/src/lib.rs` calls `strata_trace::trace_contours` which is sequential. The chunked path (`trace_contours_chunked`) manually partitions seeds and runs `trace_chunk` per partition — no rayon needed, just manual chunking that processes seeds in groups.

For WASM, the chunked path provides:
- No SharedArrayBuffer requirement
- No COOP/COEP requirement
- Same results as sequential (deterministic)
- Enables future worker partitioning

```rust
// In strata-wasm/src/lib.rs, change:
// OLD: strata_trace::trace_contours(&gray, width, height, &opts)
// NEW:
let chunk_count = (js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>()
    .navigator().hardware_concurrency().max(1) as usize).min(4);
strata_trace::chunked::trace_contours_chunked(&gray, width, height, &opts, chunk_count)
```

- [ ] **Step 2: Build WASM and verify**

```bash
just wasm-build
```

- [ ] **Step 3: Commit**

### Task B2: Worker-based parallel trace

**Files:**
- Modify: `packages/engine/src/upscaleProviders/traceDispatch.ts`
- Modify: `packages/engine/src/upscaleProviders/wasmTraceProvider.ts`
- Create: `packages/engine/src/upscaleProviders/parallelWasmTraceProvider.ts`

- [ ] **Step 1: Write failing test for worker dispatch**

```typescript
// parallelWasmTraceProvider.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parallelWasmTraceProvider } from './parallelWasmTraceProvider';

describe('parallelWasmTraceProvider', () => {
  it('isAvailable returns true when Worker is available', () => {
    expect(parallelWasmTraceProvider.isAvailable()).resolves.toBe(true);
  });

  it('partitions image data across workers', async () => {
    // Mock worker to just return paths
    const mockWorker = { postMessage: vi.fn(), terminate: vi.fn() };
    vi.stubGlobal('Worker', vi.fn(() => mockWorker));

    // This test verifies the partitioning logic, not the actual trace
    const { partitionImageData } = await import('./parallelWasmTraceProvider');
    const data = new ImageData(new Uint8ClampedArray(256 * 4), 4, 4);
    const chunks = partitionImageData(data, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].width).toBe(4);
    expect(chunks[0].height).toBe(2);
    expect(chunks[1].width).toBe(4);
    expect(chunks[1].height).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @varve/engine test -- parallelWasmTrace
```

- [ ] **Step 3: Implement parallel provider**

The parallel WASM trace provider:
1. Probes `navigator.hardwareConcurrency`
2. Partitions the input ImageData into horizontal strips (one per worker)
3. Loads the WASM module in each worker
4. Each worker traces its strip independently
5. Results are merged (offset path coordinates by strip offset)
6. Falls back to single-worker WASM if Workers unavailable or COOP/COEP missing

Key constraint: No SharedArrayBuffer. Each worker gets its own WASM instance. Data transfer via `postMessage` with `Transferable` ArrayBuffer.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

### Task B3: Fallback hierarchy in trace dispatch

**Files:**
- Modify: `packages/engine/src/upscaleProviders/traceDispatch.ts`

- [ ] **Step 1: Insert parallel provider into chain**

```typescript
export const TRACE_PROVIDER_CHAIN: TraceProvider[] = [
  nativeTraceProvider,          // 1. Tauri native (rayon)
  parallelWasmTraceProvider,    // 2. Parallel WASM (multi-worker)
  wasmTraceProvider,            // 3. Sequential WASM
  workerTraceProvider,          // 4. Pure-TS in worker
  directTraceProvider,          // 5. Pure-TS on main thread
];
```

- [ ] **Step 2: Add capability detection**

`parallelWasmTraceProvider.isAvailable()` must check:
- `typeof Worker !== 'undefined'`
- `crossOriginIsolated === true` (for SharedArrayBuffer, if needed)
- WASM module loadable (HEAD probe)

If any check fails, return false → falls to sequential WASM.

- [ ] **Step 3: Add agreement tests**

```typescript
// traceAgreement.test.ts
describe('trace provider agreement', () => {
  const makeTestData = () => {
    const data = new ImageData(32, 32);
    // Draw a square
    for (let y = 10; y < 20; y++) {
      for (let x = 10; x < 20; x++) {
        const i = (y * 32 + x) * 4;
        data.data[i] = 255;
        data.data[i + 1] = 255;
        data.data[i + 2] = 255;
        data.data[i + 3] = 255;
      }
    }
    return data;
  };

  it('native and WASM produce same path count', async () => {
    const data = makeTestData();
    const native = await nativeTraceProvider.trace(data, {});
    const wasm = await wasmTraceProvider.trace(data, {});
    expect(native.paths.length).toBe(wasm.paths.length);
  });
});
```

- [ ] **Step 4: Run and verify**

- [ ] **Step 5: Commit**

---

## Milestone C: Canonical Effect Replay Architecture

### Task C1: Extract screen-bounds computation

**Files:**
- Modify: `packages/engine/src/effectPipeline.ts`
- Modify: `packages/engine/src/replay.ts` (import from effectPipeline)
- Modify: `packages/editor/src/CanvasArea.tsx` (import from effectPipeline)

- [ ] **Step 1: Write tests for computeScreenBounds**

Already written in A2.

- [ ] **Step 2: Replace duplicate code**

In `replay.ts` lines 355-371 and `CanvasArea.tsx` lines 1696-1711, replace the inline `mapPoint` + corner transform with:
```typescript
import { computeScreenBounds } from './effectPipeline';
```

- [ ] **Step 3: Run existing replay tests**

```bash
pnpm --filter @varve/engine test -- replay
```

- [ ] **Step 4: Commit**

### Task C2: Extract glassMaterial pixel pipeline

**Files:**
- Modify: `packages/engine/src/effectPipeline.ts`
- Modify: `packages/engine/src/replay.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`

- [ ] **Step 1: Move pixel pipeline to effectPipeline**

`replay.ts` `paintGlassMaterial` (lines 338-451) and `CanvasArea.tsx` (lines 1691-1831) both implement the exact same 5-step pipeline:
1. Capture backdrop via CompositeCanvas
2. Apply blur
3. Tint mixing
4. Saturation adjustment
5. Brightness multiply
6. Noise addition

Extract to `applyGlassMaterialBackdrop(canvas: HTMLCanvasElement | OffscreenCanvas, effect: GlassMaterialEffect): void`.

- [ ] **Step 2: Wire both call sites**

`replay.ts`: Replace the 100-line inline pipeline with `applyGlassMaterialBackdrop(cc.canvas, effect)`.

`CanvasArea.tsx`: Replace the 140-line inline pipeline with `applyGlassMaterialBackdrop(cc.canvas, effect)`.

Both callers are still responsible for:
- Computing the capture region
- Creating the CompositeCanvas
- Calling `captureSource`
- Compositing the result onto the target

The pixel manipulation logic is extracted once.

- [ ] **Step 3: Run effect tests**

```bash
pnpm --filter @varve/engine test -- effect
pnpm --filter @varve/editor test -- CanvasArea
```

- [ ] **Step 4: Commit**

### Task C3: Extract backgroundBlur backdrop capture

**Files:**
- Modify: `packages/engine/src/effectPipeline.ts`
- Modify: `packages/engine/src/replay.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`

- [ ] **Step 1: Extract capture-and-blur**

```typescript
export function captureAndBlurBackdrop(
  sourceCanvas: CanvasImageSource,
  sourceX: number, sourceY: number,
  sourceW: number, sourceH: number,
  radius: number,
): CompositeCanvas
```

Both `replay.ts:paintBackgroundBlur` and `CanvasArea.tsx:backgroundBlur` use this pattern.

- [ ] **Step 2: Wire both call sites**

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

### Task C4: Group flatten → replay.ts integration

**Files:**
- Modify: `packages/engine/src/replay.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`
- Modify: `packages/engine/src/effectPipeline.ts`

- [ ] **Step 1: Write failing test for group-level effect rendering**

```typescript
// effectPipeline.group.test.ts
describe('group-level effects', () => {
  it('renders glassMaterial on a group subtree', () => {
    // Set up a canvas, render group children, apply glassMaterial
    // Verify pixel output matches item-level glassMaterial
  });

  it('layerBlur applies software fallback for large radii at group level', () => {
    // CanvasArea currently only uses CSS filter — verify the extracted
    // pipeline uses the dual-path strategy (CSS for <=32, software for >32)
  });
});
```

- [ ] **Step 2: Implement group flatten in effectPipeline**

Create a `renderGroupWithEffects()` function that:
1. Takes the group's children IR, effects, blend mode, opacity
2. Renders children to an offscreen CompositeCanvas
3. Applies effects in order (outerGlow, dropShadow, glassMaterial, backgroundBlur)
4. Applies layerBlur with dual-path (CSS ≤32, software >32)
5. Returns the composited surface + position

Both `CanvasArea.tsx` and any future export renderer call this single function.

- [ ] **Step 3: Replace CanvasArea group flatten block**

Replace the 350-line block in `CanvasArea.tsx` (lines 1575-1921) with a call to `renderGroupWithEffects()`.

- [ ] **Step 4: Run all effect tests**

```bash
pnpm --filter @varve/engine test
pnpm --filter @varve/editor test -- CanvasArea
```

- [ ] **Step 5: Commit**

---

## Milestone D: PDF Resource Transfer Architecture

### Task D1: Export manifest types in Rust

**Files:**
- Modify: `crates/strata-print/src/resources.rs` (from A3, expand)

- [ ] **Step 1: Add IPC-compatible serialization**

The `ExportManifest` must serialize across the TS↔Rust IPC boundary. Verify serde (de)serialization with the exact JSON shape TS will produce.

- [ ] **Step 2: Add validation methods**

```rust
impl ExportManifest {
    pub fn validate(&self) -> Result<(), Vec<ResourceError>> { ... }
    pub fn resolve_image(&self, id: &str) -> Result<&ImageResource, ResourceError> { ... }
    pub fn resolve_pattern(&self, id: &str) -> Result<&PatternResource, ResourceError> { ... }
    pub fn deduplicate_images(&mut self) { ... }
}
```

- [ ] **Step 3: Commit**

### Task D2: TS resource collector

**Files:**
- Create: `packages/editor/src/export/resourceCollector.ts`
- Create: `packages/editor/src/export/resourceCollector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('resourceCollector', () => {
  it('collects unique image srcs from scene nodes', () => {
    const nodes = [
      { fills: [{ type: 'image', image: { src: 'img1.png' } }] },
      { fills: [{ type: 'image', image: { src: 'img2.png' } }] },
      { fills: [{ type: 'image', image: { src: 'img1.png' } }] }, // duplicate
    ];
    const manifest = collectResources(nodes as any);
    expect(manifest.images).toHaveLength(2);
  });

  it('decodes image to RGBA bytes', async () => {
    // Mock ImageCache to return a known canvas
    const manifest = collectResources([{ fills: [{ type: 'image', image: { src: 'test.png' } }] }] as any);
    expect(manifest.images[0].data.length).toBeGreaterThan(0);
    expect(manifest.images[0].color_space).toBe('rgb');
  });

  it('collects pattern tile srcs', () => {
    const nodes = [
      { fills: [{ type: 'pattern', pattern: { tileSrc: 'tile.png', spacing: 10 } }] },
    ];
    const manifest = collectResources(nodes as any);
    expect(manifest.patterns).toHaveLength(1);
    expect(manifest.patterns[0].tile_image_id).toBe(manifest.images[0].id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement resourceCollector**

`collectResources(nodes: SceneNode[]): ExportManifest`:
1. Walk all nodes, extract unique `image.src` and `pattern.tileSrc`
2. Load each via ImageCache
3. Draw to offscreen canvas, extract raw RGBA via `getImageData`
4. Assign stable IDs (`img_0`, `img_1`, ...)
5. Build pattern resources referencing image IDs
6. Deduplicate images (same src → same ID)

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

### Task D3: Wire manifest through IPC

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `manifest_json` param to PDF commands)
- Modify: `packages/print/src/native.ts` (pass manifest)
- Modify: `crates/strata-print/src/lib.rs` (accept manifest)

- [ ] **Step 1: Add manifest parameter to Tauri commands**

```rust
#[tauri::command]
async fn export_pdf_with_options(
    nodes_json: String,
    options_json: String,
    manifest_json: Option<String>,  // NEW
    page_height: f64,
    use_cmyk: bool,
) -> Result<Vec<u8>, String> {
    let manifest: Option<ExportManifest> = manifest_json
        .and_then(|s| serde_json::from_str(&s).ok());
    // ... pass manifest to export functions
}
```

- [ ] **Step 2: Wire TS to collect and pass manifest**

In `packages/print/src/native.ts`, before calling `export_pdf_with_options`:
```typescript
const manifest = collectResources(nodes);
const manifestJson = JSON.stringify(manifest);
// include in IPC call
```

- [ ] **Step 3: Commit**

---

## Milestone E: True PDF Pattern Rendering

### Task E1: Raster pattern tiles in PDF

**Files:**
- Modify: `crates/strata-print/src/lib.rs` (replace pattern placeholder)

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn render_fills_pattern_embeds_raster_tile() {
    let manifest = ExportManifest {
        images: vec![ImageResource {
            id: "tile_0".into(),
            mime_type: "image/png".into(),
            width: 32,
            height: 32,
            data: vec![200u8; 32 * 32 * 4], // solid light gray
            color_space: ColorSpace::Rgb,
        }],
        patterns: vec![PatternResource {
            id: "pat_0".into(),
            tile_image_id: "tile_0".into(),
            spacing: 5.0,
            rotation: 0.0,
            tile_width: 32.0,
            tile_height: 32.0,
        }],
    };

    let node = SceneNode {
        shape: Shape::Rect(Rect { x: 0.0, y: 0.0, w: 100.0, h: 100.0, rx: 0.0 }),
        fill: EngineColor::Rgb { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        fills: Some(vec![FillIR::Pattern {
            tile_src: "tile_0".into(),
            spacing: 5.0,
            rotation: 0.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]),
        ..Default::default()
    };

    let pdf = export_pdf(&[node], 800.0, false, Some(&manifest), &PdfOptions::default());
    let pdf_str = String::from_utf8_lossy(&pdf);
    // Should embed the raster tile as an XObject, not a dashed grid
    assert!(pdf_str.contains("/Im"), "should contain image XObject reference");
    assert!(!pdf_str.contains("pattern tile="), "should not contain placeholder annotation");
    assert!(!pdf_str.contains("0.8 0.85 0.9"), "should not contain placeholder light blue color");
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement real pattern rendering**

Replace the pattern fill section in `render_fills()` (lines 542-642):

1. Look up `tile_src` in the manifest's image resources
2. If found, embed the tile image as an XObject (reusing `embed_image`)
3. Create a PDF Pattern dictionary (`/Pattern /Tiling ...`)
4. Set the pattern's `BBox`, `XStep`, `YStep`, `PaintType`, `TilingType`
5. Apply the pattern transform (rotation, translation) via the pattern matrix
6. Reference the pattern in the content stream via `/Cs1 cs /Pat1 scn`
7. If tile not found in manifest, emit a warning comment and fall back to a gray fill (not a decorative grid)

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

### Task E2: Pattern transforms, repeat modes, opacity

**Files:**
- Modify: `crates/strata-print/src/lib.rs`

- [ ] **Step 1: Handle pattern transform matrix**

PDF tiling patterns support a `/Matrix` entry for object-space to pattern-space mapping. When the pattern has rotation or is applied to a rotated object:

```
/Pattern matrix [cos θ sin θ -sin θ cos θ tx ty]
```

- [ ] **Step 2: Handle opacity via ExtGState**

For patterns with opacity < 1.0:
```rust
// Create ExtGState with alpha
// Reference in pattern's Resources
```

- [ ] **Step 3: Handle repeat modes**

PDF TilingType 1 (constant spacing) is the default. For no-repeat or other modes, fall back to single tile centered.

- [ ] **Step 4: Commit**

### Task E3: Shared tile deduplication

**Files:**
- Modify: `crates/strata-print/src/lib.rs`
- Modify: `crates/strata-print/src/resources.rs`

- [ ] **Step 1: Deduplicate images in manifest**

Before rendering, call `manifest.deduplicate_images()` which hashes pixel data and merges identical images.

- [ ] **Step 2: Embed each unique tile only once**

Track embedded XObject references by image ID. When the same tile appears on multiple nodes, reference the same XObject.

- [ ] **Step 3: Commit**

### Task E4: Fallback for missing resources

**Files:**
- Modify: `crates/strata-print/src/lib.rs`

- [ ] **Step 1: Structured fallback when manifest is None or image missing**

```rust
// When manifest is None (legacy path) or image not found:
// Emit a comment: % WARNING: pattern tile 'tile_src' not found in export manifest
// Render a neutral gray fill that preserves the shape's visual extent
// Do NOT render a decorative grid — that is the old placeholder behavior
```

- [ ] **Step 2: Commit**

---

## Milestone F: Integration Tests & Verification

### Task F1: WASM trace cross-platform tests

- [ ] **Step 1: Native threaded vs native sequential agreement**

```rust
#[test]
fn native_threaded_vs_sequential_agreement() {
    let px = make_bitmap(64, 64);
    let opts = TraceOptions::default();
    // With rayon (default features) — tests the rayon path
    let threaded = trace_contours(&px, 64, 64, &opts);
    // Without rayon — use chunked with 1 chunk
    let sequential = chunked::trace_contours_chunked(&px, 64, 64, &opts, 1);
    assert_eq!(threaded.len(), sequential.len());
}
```

- [ ] **Step 2: Main-thread responsiveness test**

Verify that the parallel WASM provider does not block the main thread for large inputs.

### Task F2: Effect replay parity tests

- [ ] **Step 1: Item-level and group-level output agreement**

Render the same scene via `replayIr` (flat) and `replaySubtreeToCtx` (structural) and compare pixel output.

- [ ] **Step 2: glassMaterial and backgroundBlur parity**

Verify that the extracted pipeline produces identical pixels when called from both paths.

- [ ] **Step 3: Export rendering test**

Verify that the effect pipeline works for non-canvas targets (e.g., SVG export, PDF export backdrop rendering).

### Task F3: PDF pattern tests

- [ ] **Step 1: Real raster tiling in PDF**

Render a pattern fill, export to PDF, parse PDF to verify tile XObject exists and is referenced.

- [ ] **Step 2: Tile reuse across pages**

Two nodes sharing the same tile src should embed the tile image once.

- [ ] **Step 3: Scale, rotation, phase, clipping**

Test patterns with various transforms and verify the PDF pattern matrix is correct.

- [ ] **Step 4: Missing-resource fallback**

Export without a manifest → verify gray fill, not decorative grid.

- [ ] **Step 5: Visual regression**

Generate a PDF with pattern fills and compare against a golden fixture.

### Task F4: Performance benchmarks

- [ ] **Step 1: Trace latency benchmark**

```typescript
// trace.bench.ts
describe('trace performance', () => {
  it('benchmarks small trace (32x32)', async () => {
    const data = makeImageData(32, 32);
    const start = performance.now();
    await dispatchTrace(data);
    const elapsed = performance.now() - start;
    console.log(`Small trace: ${elapsed.toFixed(1)}ms`);
  });

  it('benchmarks large trace (512x512)', async () => {
    const data = makeImageData(512, 512);
    const start = performance.now();
    await dispatchTrace(data);
    const elapsed = performance.now() - start;
    console.log(`Large trace: ${elapsed.toFixed(1)}ms`);
  });
});
```

- [ ] **Step 2: Effect replay benchmark**

Measure group-level effect rendering time for nested groups.

- [ ] **Step 3: PDF export benchmark**

Measure export time for documents with repeated patterns.

---

## Execution Order

1. **Milestone A** (scaffolding) — no behavior changes, only test infrastructure
2. **Milestone B** (WASM trace) — uses A1 chunked module
3. **Milestone C** (effect replay) — uses A2 extracted pipeline
4. **Milestone D** (resource architecture) — uses A3 resource types
5. **Milestone E** (PDF patterns) — uses D1-D3 manifest
6. **Milestone F** (integration tests) — uses all milestones

Each milestone is independently committable and verifiable.

---

## Verification Checklist

After each milestone:
- [ ] `cargo test --workspace` passes
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 new errors)
- [ ] `pnpm audit:tokens` passes
- [ ] `pnpm audit:emoji` passes
- [ ] `pnpm test` passes (all JS tests)

After all milestones:
- [ ] Native threaded vs sequential trace agreement
- [ ] WASM trace produces same results as native sequential
- [ ] Effect pipeline extracts from both CanvasArea and replay
- [ ] PDF patterns embed real raster tiles, not placeholders
- [ ] PDF fallback for missing resources is gray fill (not grid)
- [ ] All benchmarks show improvement or no regression
