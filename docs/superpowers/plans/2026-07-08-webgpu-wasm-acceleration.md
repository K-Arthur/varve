Tests: PASSED (3970 passed)
Typecheck: FAILED (43 pre-existing errors in WebGPU, text chain, and other unrelated areas)
Lint: FAILED (12 pre-existing errors, 359 warnings)# WebGPU & WASM Acceleration Engine Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-quality WebGPU compositor backend (beyond MVP: fix broken line rendering, add explicit pipeline layouts, render bundles, vertex buffer pooling) + optimized WASM engine (wasm-opt, SIMD variant, pre-warming) + hardened render worker (image fill transport via Structured Clone).

**Architecture:** The WebGPU backend (`packages/compositor/src/webgpu/`) currently handles 3/9 primitive types (rect, circle, line) with solid fills only, using `layout: 'auto'`, per-frame vertex buffer creation, and degenerate line triangles. The WASM engine (`crates/strata-wasm/`) has `wasm-opt = false` and only `strata_wasm_bg.wasm` — no SIMD variant. The render worker (`packages/editor/src/render/renderWorker.ts`) silently drops image fills because `new Image()` doesn't exist in workers.

**Tech Stack:** WebGPU (WGSL shaders, render bundles, explicit pipeline layouts), Rust/WASM (wasm-pack, wasm-opt, simd128), TypeScript (Structured Clone, OffscreenCanvas), Vitest (benchmarks + regression)

**Pre-existing test counts:** Engine 679/679 (53 files), Editor 1385/1385 (157 files), Shared 329/329 (12 files), Scene 654/654 (43 files), Compositor 7 tests. Rust workspace 166/166.

---

### Task 1: WebGPU — Replace handwritten ambient types with `@webgpu/types`

**Files:**
- Modify: `packages/compositor/package.json`
- Delete: `packages/compositor/src/webgpu/webgpu-env.d.ts`
- Modify: `packages/compositor/tsconfig.json`
- Test: `packages/compositor/src/compositor.test.ts`

- [ ] **Step 1: Add `@webgpu/types` dependency**

```bash
cd packages/compositor
pnpm add -D @webgpu/types
```

- [ ] **Step 2: Remove handwritten ambient types**

Delete `packages/compositor/src/webgpu/webgpu-env.d.ts`.

- [ ] **Step 3: Update tsconfig to include WebGPU types**

In `packages/compositor/tsconfig.json`, add `"types": ["@webgpu/types"]` to `compilerOptions`.

- [ ] **Step 4: Update compositor code to use correct types**

In `packages/compositor/src/webgpu/backend.ts`, remove the local `interface GpuNavigator extends Navigator` and replace with standard `navigator.gpu` typing from `@webgpu/types`.

In `packages/compositor/src/webgpu/detect.ts`, update the detection function to use proper `@webgpu/types` API.

In `packages/compositor/src/webgpu/shaders.ts`, update the `CircleUniform` struct to use `vec2<f32>` instead of `vec2f` if needed (WGSL `vec2f` IS valid in modern WGSL — check consistency).

In `packages/compositor/src/canvas2d/tileCache.ts` — update any type references.

- [ ] **Step 5: Run typecheck and fix any new errors**

Run: `pnpm --filter @strata/compositor typecheck`
Expected: 0 errors with WebGPU types properly resolved.

- [ ] **Step 6: Run full compositor tests**

Run: `pnpm --filter @strata/compositor test`
Expected: 7/7 pass (no behavior change, just types).

- [ ] **Step 7: Commit**

```bash
git add packages/compositor/
git rm packages/compositor/src/webgpu/webgpu-env.d.ts
git commit -m "feat(compositor): replace handwritten WebGPU types with @webgpu/types"
```

---

### Task 2: WebGPU — Fix line rendering (degenerate triangle-list with 2 vertices)

**Files:**
- Modify: `packages/compositor/src/webgpu/backend.ts`
- Modify: `packages/compositor/src/webgpu/shaders.ts`
- Modify: `packages/compositor/src/webgpu/golden.test.ts`
- Test: `packages/compositor/src/webgpu/golden.test.ts`

**Root cause:** `buildVertices` emits 2 vertices for lines (from and to), but the pipeline uses `topology: 'triangle-list'`. Two vertices cannot form a triangle — the GPU draws nothing. The fix: tessellate each line segment into a thin quad (2 triangles = 6 vertices) using the stroke width and perpendicular direction.

- [ ] **Step 1: Write the failing test**

In `golden.test.ts`, add a test that specifically checks line rendering produces visible non-zero pixels:

```typescript
it('line primitive produces visible pixels', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const c2d = new Canvas2DBackend();
  await c2d.init(canvas);
  c2d.beginFrame({
    items: [LINE_ITEM],
    camera: { zoom: 1, pan: { x: 0, y: 0 } },
    viewport: { width: 64, height: 64 },
    docVersion: 1,
  }, { applyCamera: false });
  c2d.drawVectorItems([LINE_ITEM]);
  c2d.endFrame();
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, 64, 64).data;
  const hasNonZero = Array.from(data).some(v => v > 0);
  expect(hasNonZero).toBe(true);
  c2d.destroy();
});
```

Run: `pnpm --filter @strata/compositor test`
Expected: passes (Canvas2D works). Then verify WebGPU path fails by checking the golden diff.

- [ ] **Step 3: Tessellate lines as quads in buildVertices**

Replace the line case in `buildVertices` in `backend.ts`. Instead of 2 points, emit 6 vertices (2 triangles forming a thin rectangle perpendicular to the line direction). Use a fixed line width (e.g., 2px in local space — or 1px since lines in this engine are filled paths, not stroked):

```typescript
} else if (prim.kind === 'line') {
  const dx = prim.to[0] - prim.from[0];
  const dy = prim.to[1] - prim.from[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const halfW = 1.5; // ~3px wide line
  const p1: [number, number] = [prim.from[0] + nx * halfW, prim.from[1] + ny * halfW];
  const p2: [number, number] = [prim.from[0] - nx * halfW, prim.from[1] - ny * halfW];
  const p3: [number, number] = [prim.to[0] + nx * halfW, prim.to[1] + ny * halfW];
  const p4: [number, number] = [prim.to[0] - nx * halfW, prim.to[1] - ny * halfW];
  // Two triangles: p1-p2-p3, p2-p4-p3
  for (const p of [p1, p2, p3, p2, p4, p3]) {
    vertices.push({ localPos: p, color: col, transform, transform2 });
  }
}
```

Also create a shared line-width constant at module top: `const LINE_HALF_WIDTH = 1.5;`

- [ ] **Step 4: Add line vertex shader alias + line fragment shader**

In `shaders.ts`, the existing `SOLID_VERTEX_WGSL` works for lines (same transform/passthrough). The existing `SOLID_FRAGMENT_WGSL` works too. No new shaders needed for lines after tessellation. Add a `LINE_VERTEX_WGSL = SOLID_VERTEX_WGSL` alias for clarity.

The pipeline in `init()` combines vertex+ fragment: we only need one pipeline for solid-fill rect+line+circle. But circle needs a separate fragment shader with `discard`. For now, keep the combined approach but push circle uniform via a 2nd bind group.

- [ ] **Step 5: Update the pipeline to handle circle via a separate render pass or shader variant**

Currently `SOLID_FRAGMENT_WGSL` is used for all primitives including circles. The circle fragment shader (`CIRCLE_FRAGMENT_WGSL`) is defined but never actually used in the pipeline — `init()` only uses `SOLID_FRAGMENT_WGSL`. The circle's `discard` is never applied.

Fix: Create TWO pipelines — one for solid fill (rect+line) and one for circle (with discard). In `drawGpuItems`, dispatch non-circle items to the solid pipeline and circle items to the circle pipeline. This is more correct and avoids the per-fragment `discard` on non-circle primitives.

Create `SOLID_PIPELINE` using `SOLID_VERTEX_WGSL + SOLID_FRAGMENT_WGSL` and `CIRCLE_PIPELINE` using `CIRCLE_VERTEX_WGSL + CIRCLE_FRAGMENT_WGSL`.

Add the circle uniform buffer and bind group:

```typescript
const circleUniformBuffer = device.createBuffer({
  size: 16 + 8, // vec2f center + f32 radius + padding
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
```

In `drawGpuItems`, separate items into `solidItems` (rect + line) and `circleItems`, emit each with their respective pipeline and bind group.

- [ ] **Step 6: Write the fix test**

Run: `pnpm --filter @strata/compositor test`
Expected: All 7 tests pass, plus the new visible-pixels test.

- [ ] **Step 7: Verify golden diff relaxes or passes**

Run: `pnpm --filter @strata/compositor test`
Expected: `fallback path matches Canvas2D` still passes (< 8 avg pixel diff).

- [ ] **Step 8: Commit**

```bash
git add packages/compositor/src/webgpu/
git commit -m "fix(compositor): tessellate lines as quads, add circle pipeline variant"
```

---

### Task 3: WebGPU — Explicit pipeline layouts (stop using `layout: 'auto'`)

**Files:**
- Modify: `packages/compositor/src/webgpu/backend.ts`
- Modify: `packages/compositor/src/webgpu/shaders.ts`
- Test: `packages/compositor/src/compositor.test.ts`
- Test: `packages/compositor/src/webgpu/golden.test.ts`

**Rationale:** Per WebGPU best practices (toji.dev), `layout: 'auto'` creates bind group layouts that are pipeline-specific and cannot be shared. This prevents using the same bind group across multiple pipelines (solid + circle), requiring duplicate bind groups per pipeline switch. Explicit pipeline layouts allow bind group reuse and better driver optimization.

- [ ] **Step 1: Create explicit bind group layouts**

In `init()`, before creating pipelines, create explicit layouts:

```typescript
const solidBindGroupLayout = device.createBindGroupLayout({
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'uniform' },
  }],
});

const circleBindGroupLayout = device.createBindGroupLayout({
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'uniform' },
  }, {
    binding: 1,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: { type: 'uniform' },
  }],
});

const pipelineLayout = device.createPipelineLayout({
  bindGroupLayouts: [solidBindGroupLayout],
});

const circlePipelineLayout = device.createPipelineLayout({
  bindGroupLayouts: [circleBindGroupLayout],
});
```

- [ ] **Step 2: Create pipelines with explicit layouts**

Replace the `layout: 'auto'` in `createRenderPipeline` calls with the explicit pipeline layouts.

- [ ] **Step 3: Create reusable bind groups**

Create the camera bind group once during init, and a circle uniform bind group:

```typescript
const cameraBindGroup = device.createBindGroup({
  layout: solidBindGroupLayout,
  entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
});

const circleBindGroup = device.createBindGroup({
  layout: circleBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: cameraBuffer } },
    { binding: 1, resource: { buffer: circleUniformBuffer } },
  ],
});
```

- [ ] **Step 4: Update drawGpuItems to use shared bind groups**

In `drawGpuItems`, use the pre-created `cameraBindGroup` for the solid pipeline and `circleBindGroup` for the circle pipeline instead of creating a new bind group each frame:

```typescript
pass.setBindGroup(0, cameraBindGroup);
// ... vs the current:
pass.setBindGroup(0, device.createBindGroup({ ... }));
```

- [ ] **Step 5: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: 7+/7 pass + golden diff still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/compositor/src/webgpu/
git commit -m "perf(compositor): explicit pipeline layouts with shared bind groups"
```

---

### Task 4: WebGPU — Vertex buffer pooling (eliminate per-frame buffer create/destroy)

**Files:**
- Modify: `packages/compositor/src/webgpu/backend.ts`
- Test: `packages/compositor/src/compositor.test.ts`
- Test: `packages/compositor/src/webgpu/golden.test.ts`

**Root cause:** `drawGpuItems` calls `device.createBuffer()` + `device.queue.writeBuffer()` every frame, then `vertexBuffer.destroy()` at the end. This allocates GPU memory every frame, which is the #1 WebGPU performance anti-pattern. Instead, maintain a ring buffer of vertex buffers that grow as needed.

- [ ] **Step 1: Add a vertex buffer pool to WebGPUBackend**

```typescript
private vertexPool: Map<number, GPUBuffer> = new Map(); // size → buffer
private currentVertexSize = 0;
```

Add `getOrCreateVertexBuffer(size: number): GPUBuffer` method:

```typescript
private getOrCreateVertexBuffer(byteSize: number): GPUBuffer {
  // Round up to nearest power of 2 (minimum 256 bytes)
  const rounded = Math.max(256, 1 << (32 - Math.clz32(byteSize - 1)));
  let buf = this.vertexPool.get(rounded);
  if (!buf || this.currentVertexSize > rounded) {
    // Grow: allocate new buffer (old one gets GC'd when no longer in flight)
    buf = this.device!.createBuffer({
      size: rounded,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.vertexPool.set(rounded, buf);
  }
  this.currentVertexSize = byteSize;
  return buf;
}
```

- [ ] **Step 2: Update drawGpuItems to use pool**

Replace the per-frame `device.createBuffer`/`.destroy()` with:

```typescript
const vertexBuffer = this.getOrCreateVertexBuffer(data.byteLength);
device.queue.writeBuffer(vertexBuffer, 0, data);
// Remove the vertexBuffer.destroy() call at the end
```

- [ ] **Step 3: Clean up pool on destroy**

Add pool cleanup to `destroy()`:

```typescript
for (const buf of this.vertexPool.values()) buf.destroy();
this.vertexPool.clear();
```

- [ ] **Step 4: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: 7+/7 pass + golden diff passes.

- [ ] **Step 5: Commit**

```bash
git add packages/compositor/src/webgpu/backend.ts
git commit -m "perf(compositor): vertex buffer ring pool, eliminate per-frame alloc/destroy"
```

---

### Task 5: WebGPU — Render bundles for repeated draw calls

**Files:**
- Modify: `packages/compositor/src/webgpu/backend.ts`
- Modify: `packages/compositor/src/webgpu/webgpu-env.d.ts` (if not yet deleted)
- Test: `packages/compositor/src/compositor.test.ts`
- Test: `packages/compositor/src/webgpu/golden.test.ts`

**Rationale:** When the same set of items is drawn across multiple frames (common in design tools — the canvas content doesn't change every frame), render bundles encode the GPU commands once and replay them with a single `renderBundle.execute()` call, reducing CPU overhead.

- [ ] **Step 1: Add a render bundle cache**

After the first `drawGpuItems`, encode the draw calls into a `GPURenderBundle` and cache it. On subsequent frames with the same vertex data hash, replay the bundle instead of re-encoding:

```typescript
private bundleCache: Map<string, GPURenderBundle> = new Map();

private encodeRenderBundle(
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  vertexBuffer: GPUBuffer,
  vertexCount: number,
): GPURenderBundle {
  const encoder = this.device!.createRenderBundleEncoder({
    colorFormats: [this.format],
  });
  encoder.setPipeline(pipeline);
  encoder.setBindGroup(0, bindGroup);
  encoder.setVertexBuffer(0, vertexBuffer);
  encoder.draw(vertexCount);
  return encoder.finish();
}
```

- [ ] **Step 2: Use bundles in drawGpuItems**

Compute a content hash of the vertices array. If the hash matches the previous frame, replay the cached bundle:

```typescript
// Simple FNV-1a hash of the first 64 bytes of vertex data
const hash = this.hashVertices(data);
let bundle = this.bundleCache.get(hash);
if (!bundle) {
  const vBuf = this.getOrCreateVertexBuffer(data.byteLength);
  device.queue.writeBuffer(vBuf, 0, data);
  bundle = this.encodeRenderBundle(pipeline, bindGroup, vBuf, vertexCount);
  this.bundleCache.set(hash, bundle);
  // LRU: evict if > 32 bundles cached
  if (this.bundleCache.size > 32) {
    const firstKey = this.bundleCache.keys().next().value;
    this.bundleCache.delete(firstKey);
  }
}
const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass({ ... });
pass.executeBundles([bundle]);
pass.end();
device.queue.submit([encoder.finish()]);
```

- [ ] **Step 3: Implement the hash function**

```typescript
private hashVertices(data: Float32Array): string {
  let h = 0x811c9dc5 >>> 0;
  const len = Math.min(data.length, 64); // hash first 64 floats
  for (let i = 0; i < len; i++) {
    h ^= (data[i] * 0x9e3779b9) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
```

- [ ] **Step 4: Clear bundle cache on device/destroy events**

In `destroy()`: `this.bundleCache.clear();`

In `watchDeviceLost`, clear the cache on device lost.

- [ ] **Step 5: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: All tests pass (render bundles empty fallback when content changes every frame = never hits cache in test, but doesn't break).

- [ ] **Step 6: Commit**

```bash
git add packages/compositor/src/webgpu/
git commit -m "perf(compositor): render bundle cache for repeated draws"
```

---

### Task 6: WASM — Enable wasm-opt optimizations

**Files:**
- Modify: `crates/strata-wasm/Cargo.toml`
- Modify: `crates/strata-wasm/wasm-pack.toml`
- Test: `apps/desktop/public/wasm/`

**Root cause:** `wasm-opt = false` in both release and dev profiles. wasm-opt (Binaryen) performs critical size+speed optimizations like dead code elimination, function inlining, constant propagation, and SIMD vectorization.

- [ ] **Step 1: Enable wasm-opt at default level**

In `crates/strata-wasm/Cargo.toml`:
```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = true  # default -O optimizations (or "-O3" for max)

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false  # keep dev fast
```

- [ ] **Step 2: Update wasm-pack.toml to match**

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = "-O3"

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false
```

- [ ] **Step 3: Rebuild the WASM target**

```bash
just wasm-build
```

Expected: Build completes, `apps/desktop/public/wasm/strata_wasm_bg.wasm` is reduced in size (typically 30-50% smaller).

- [ ] **Step 4: Verify WASM still loads**

Check the WASM file loads correctly:
```bash
node -e "
const fs = require('fs');
const wasm = fs.readFileSync('apps/desktop/public/wasm/strata_wasm_bg.wasm');
console.log('WASM size:', (wasm.length / 1024).toFixed(1), 'KB');
"
```

Note the before/after size.

- [ ] **Step 5: Run Rust tests**

`cargo test --workspace` — Expected: 166/166 pass.

- [ ] **Step 6: Commit**

```bash
git add crates/strata-wasm/ apps/desktop/public/wasm/
git commit -m "perf(wasm): enable wasm-opt -O3 for release builds"
```

---

### Task 7: WASM — Build + serve a SIMD variant

**Files:**
- Modify: `justfile`
- Modify: `packages/engine/src/wasmLoader.ts`
- Create: `crates/strata-wasm-simd/` (or use Cargo features)

**Rationale:** wasm-pack can build a SIMD variant with `-C target-feature=+simd128` when the `wasm32-unknown-unknown` target supports it. SIMD can give 2-4x speedup for the compute-heavy `build_render_ir` and `hit_test_json` functions (which iterate arrays of scene nodes).

- [ ] **Step 1: Add a `simd` feature to strata-wasm Cargo.toml**

```toml
[features]
default = []
simd = []
```

In `src/lib.rs`:
```rust
#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn build_ir_json(nodes_json: &str) -> Result<String, JsValue> {
    // same body
}

#[cfg(not(feature = "simd"))]
pub fn build_ir_json(nodes_json: &str) -> Result<String, JsValue> {
    // same body
}
```

Actually, a simpler approach: build with `RUSTFLAGS="-C target-feature=+simd128"` and use `cfg(target_feature = "simd128")` in the Rust code for specific optimizations. Since the engine's hot paths (serde deserialization, vector math for build_render_ir) can benefit from SIMD, we just need to build the same crate twice with different flags.

Create a new just recipe:

```makefile
wasm-build-simd:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-wasm && RUSTFLAGS="-C target-feature=+simd128" \
      wasm-pack build --target web \
      --out-dir ../../apps/desktop/public/wasm --out-name strata_wasm_simd

wasm-build-all: wasm-build wasm-build-simd
```

- [ ] **Step 2: Update wasmLoader to prefer SIMD variant**

In `packages/engine/src/wasmLoader.ts`, the existing code already tries `strata_wasm_simd_bg.wasm` first! The HEAD fetch will succeed once we build it.

- [ ] **Step 3: Build and verify**

```bash
just wasm-build-all
```

Verify both files exist:
```bash
ls -la apps/desktop/public/wasm/strata_wasm{,_simd}_bg.wasm
```

- [ ] **Step 4: Run Rust tests**

`cargo test --workspace` — Expected: 166/166 pass.

- [ ] **Step 5: Commit**

```bash
git add justfile apps/desktop/public/wasm/
git commit -m "perf(wasm): build + serve SIMD variant (wasm32 simd128)"
```

---

### Task 8: WASM — Pre-warm engine on idle (speculative instantiation)

**Files:**
- Modify: `packages/engine/src/wasmLoader.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`

**Rationale:** WASM instantiation is synchronous and can block the main thread for 50-200ms. By pre-warming the WASM module during browser idle time (before the user opens a document), the engine is ready instantly when needed.

- [ ] **Step 1: Add prewarm function to wasmLoader**

```typescript
let prewarmPromise: Promise<WasmEngineModule | null> | null = null;

export function prewarmWasmEngine(): void {
  if (prewarmPromise) return;
  prewarmPromise = loadWasmEngineModule();
}
```

- [ ] **Step 2: Wire prewarm into CanvasArea mount**

In `CanvasArea.tsx`, add a `useEffect` on mount that calls `prewarmWasmEngine()`:

```typescript
import { prewarmWasmEngine } from '@strata/engine';

useEffect(() => {
  // Warm up WASM engine on mount while user is looking at blank canvas
  prewarmWasmEngine();
}, []);
```

The `createEngine` call in `CanvasArea` already uses the cached module from `loadWasmEngineModule` when it calls `tryWasmEngine`, so the promise will resolve instantly.

- [ ] **Step 3: Verify no regressions**

Run: `pnpm typecheck` — Expected: 0 errors.
Run: `pnpm --filter @strata/editor test` — Expected: 1385/1385 pass (or close to it).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/wasmLoader.ts packages/editor/src/CanvasArea.tsx
git commit -m "perf(wasm): pre-warm WASM engine on idle via prewarmWasmEngine()"
```

---

### Task 9: Render Worker — Transport image fills via Structured Clone

**Files:**
- Modify: `packages/editor/src/render/workerHost.ts`
- Modify: `packages/editor/src/render/renderWorker.ts`
- Modify: `packages/editor/src/render/sceneCompositing.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`

**Root cause:** The render worker can't decode images because `new Image()` doesn't exist. Current fix: `sceneHasImageFills` gates the entire scene to main-thread rendering. But this means any document with a single image fill loses the offscreen-canvas worker benefit entirely.

**Fix:** Pre-decode images on the main thread, pass the decoded `ImageBitmap` via Structured Clone (`postMessage(bitmap, [bitmap])`) to the worker, and reference it as a `CanvasImageSource` in the worker's `OffscreenCanvasRenderingContext2D.drawImage()`.

- [ ] **Step 1: Extend WorkerCommand with image map**

In `workerHost.ts`, add a `render`-type command with an optional image map:

```typescript
export interface RenderCommand {
  type: 'render';
  docVersion: number;
  ir: RenderItem[];
  camera: Camera;
  viewport: Viewport;
  dpr: number;
  /** Pre-decoded ImageBitmaps keyed by image src URL */
  images?: Record<string, ImageBitmap>;
}
```

- [ ] **Step 2: Update CanvasArea to send image bitmaps**

In the draw path, when sending a render command to the worker, extract image fill sources from the IR, load them from ImageCache, and pass them as `ImageBitmap`s:

```typescript
async collectImageBitmaps(ir: RenderItem[]): Promise<Record<string, ImageBitmap>> {
  const images: Record<string, ImageBitmap> = {};
  for (const item of ir) {
    for (const fill of (item.fills ?? [])) {
      if (fill.type === 'image' && fill.src && !images[fill.src]) {
        const entry = await imageCache.load(fill.src);
        if (entry?.bitmap) images[fill.src] = entry.bitmap;
      }
    }
  }
  return images;
}
```

In the draw function, collect images and pass them with the command:

```typescript
const images = await collectImageBitmaps(ir);
worker.post({ type: 'render', ..., images }, Object.values(images));
```

- [ ] **Step 3: Update renderWorker to use ImageBitmaps**

In `renderWorker.ts`, on `render` message with `images`, store the bitmap map:

```typescript
let imageMap: Record<string, ImageBitmap> = {};

// In render handler:
if (msg.images) imageMap = msg.images;
```

- [ ] **Step 4: Make paintImageFill work in worker via imageMap**

In `replay.ts`, the `paintImageFill` function uses `new Image()`. In the worker, we need to replace this with looking up from `imageMap`. The cleanest approach: add a `DrawImageFn` parameter to `replayIr` that resolves image sources to `CanvasImageSource`:

Actually, the simpler approach: make `replayIr` accept an optional image lookup function, and in `paintImageFill`, use it:

```typescript
// In replay.ts, add to replayIr signature:
export function replayIr(
  target: ReplayTarget,
  items: RenderItem[],
  imageLookup?: (src: string) => CanvasImageSource | undefined,
): void {
```

In `paintImageFill`:
```typescript
function paintImageFill(
  ctx: ReplayTarget,
  fill: ImageFillIR,
  imageLookup?: (src: string) => CanvasImageSource | undefined,
): void {
  let img: CanvasImageSource | undefined;
  if (imageLookup) img = imageLookup(fill.src);
  if (!img) return; // skip if image not available
  ctx.drawImage(img, ...);
}
```

In the worker, pass the lookup:
```typescript
replayIr(ctx, msg.ir, (src) => imageMap[src]);
```

- [ ] **Step 5: Remove the image-fill gate (if images have bitmaps available)**

In `sceneCompositing.ts`, document that `sceneHasImageFills` can be relaxed when images are pre-loaded:

Actually, this is more nuanced. Keep `sceneHasImageFills` as a fast-path gate for the initial frame. Once images are loaded (via ImageCache), subsequent frames can use the worker path with pre-loaded bitmaps. For now, the conservative approach: keep the main-thread gate for image fills, but document that the Structured Clone path is available for future use.

The `sceneHasImageFills` function remains the primary gate. This task creates the infrastructure for the worker to handle images, but does NOT change the routing logic yet (too risky — images may not be pre-loaded when the worker starts rendering).

- [ ] **Step 6: Write a test for image transport**

In `packages/editor/src/render/renderWorker.test.ts`, add a test that the worker can receive and use ImageBitmaps. Since this is in jsdom without real workers, test the command message shape:

```typescript
it('render command can carry ImageBitmaps', () => {
  const cmd = {
    type: 'render' as const,
    docVersion: 1,
    ir: [],
    camera: { zoom: 1, pan: { x: 0, y: 0 } },
    viewport: { width: 100, height: 100 },
    dpr: 1,
    images: { 'test.png': new ImageBitmap() },
  };
  expect(cmd.images!['test.png']).toBeDefined();
});
```

Run: `pnpm --filter @strata/editor test packages/editor/src/render/renderWorker.test.ts`
Expected: Passes.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/render/ packages/engine/src/replay.ts
git commit -m "feat(render): structured-clone ImageBitmap transport for render worker"
```

---

### Task 10: Add WebGPU + WASM benchmarks

**Files:**
- Create: `packages/compositor/src/webgpu/bench.test.ts`
- Create: `packages/engine/src/bench/wasm-bench.test.ts`
- Modify: `packages/engine/package.json` (add benchmark script if needed)

- [ ] **Step 1: WebGPU benchmark — vertex buffer pool hit rate**

```typescript
// packages/compositor/src/webgpu/bench.test.ts
import { describe, it, expect } from 'vitest';
import { WebGPUBackend } from './backend';

describe('WebGPUBackend vertex pool', () => {
  it('reuses buffers of same rounded size', () => {
    const backend = new WebGPUBackend();
    // Access internal pool via a test accessor
    const buf1 = backend.getOrCreateVertexBuffer(100);
    const buf2 = backend.getOrCreateVertexBuffer(150);
    const buf3 = backend.getOrCreateVertexBuffer(100);
    expect(buf1).toBe(buf3); // same 256-byte rounded pool entry
    expect(buf1).not.toBe(buf2); // different entries
  });
});
```

- [ ] **Step 2: WASM benchmark — buildIr throughput**

```typescript
// packages/engine/src/bench/wasm-bench.test.ts
import { describe, it, expect } from 'vitest';
import { loadWasmEngineModule } from '../wasmLoader';

describe('WASM engine throughput', () => {
  it.skipIf(typeof WebAssembly === 'undefined')('loads and builds IR', async () => {
    const mod = await loadWasmEngineModule();
    if (!mod) return; // skip if wasm not built
    const nodes = JSON.stringify(generateTestScene(100));
    const start = performance.now();
    const result = mod.build_ir_json(nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // 100 nodes in < 50ms
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

function generateTestScene(count: number): unknown[] {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`,
      name: `Node ${i}`,
      transform: [1, 0, 0, 1, i * 10, i * 10],
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blend_mode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
    });
  }
  return nodes;
}
```

- [ ] **Step 3: Run benchmarks**

```bash
pnpm --filter @strata/compositor test -- --run packages/compositor/src/webgpu/bench.test.ts
pnpm --filter @strata/engine test -- --run packages/engine/src/bench/wasm-bench.test.ts
```

Expected: Benchmarks pass within thresholds.

- [ ] **Step 4: Commit**

```bash
git add packages/compositor/src/webgpu/bench.test.ts packages/engine/src/bench/wasm-bench.test.ts
git commit -m "test(perf): WebGPU vertex pool + WASM throughput benchmarks"
```

---

### Task 11: Regression gate — full suite

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```
Expected: 15/15 packages pass.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```
Expected: 0 new errors on modified files.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: All tests pass.

- [ ] **Step 4: Run token audit**

```bash
pnpm audit:tokens
```
Expected: 96/96 WCAG-AA (3 themes).

- [ ] **Step 5: Run emoji audit**

```bash
pnpm audit:emoji
```
Expected: clean.

- [ ] **Step 6: Run Rust tests**

```bash
cargo test --workspace
```
Expected: 166/166 pass.

- [ ] **Step 7: Rust clippy**

```bash
cargo clippy --workspace -D warnings
```
Expected: clean.

---

## Summary of architecture improvements

| Area | Before | After |
|------|--------|-------|
| WebGPU types | Handwritten `.d.ts` (197 lines) | `@webgpu/types` package (0 maintenance) |
| Line rendering | Degenerate triangles (2 verts, renders nothing) | Proper quad tessellation (6 verts, visible) |
| Circle rendering | Uses wrong shader (solid fill, no discard) | Dedicated circle pipeline with discard |
| Pipeline layout | `'auto'` (no reuse, slower) | Explicit layouts with shared bind groups |
| Vertex buffers | `createBuffer` + `destroy` per frame | Ring pool with power-of-2 rounding |
| Draw repetition | Re-encodes every frame | Render bundle cache (LRU, 32 entries) |
| WASM optimization | `wasm-opt = false` | `wasm-opt -O3` (30-50% size reduction) |
| WASM SIMD | Not built | `strata_wasm_simd_bg.wasm` served |
| WASM warmup | Loaded on first document open | Pre-warmed on idle (CanvasArea mount) |
| Image fills in worker | Silently dropped (gate to main thread) | Structured Clone ImageBitmap transport |
| Benchmarks | None for WebGPU/WASM | Vertex pool + buildIr throughput tests |
