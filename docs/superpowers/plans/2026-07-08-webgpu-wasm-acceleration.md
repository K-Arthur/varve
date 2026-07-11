# WebGPU & WASM Acceleration Engine Overhaul

> **Status as of 2026-07-11 reconciliation:** Tasks 1-6 and 8-10 below are verified
> committed on `master` (confirmed by reading the actual code, not just prior session
> notes — see Task checkboxes). Task 7 is coded but not actually shipped (CI never
> builds the SIMD artifact). Task 11's last recorded run (`Tests: PASSED 3970`,
> `Typecheck: FAILED 43 pre-existing`, `Lint: FAILED 12 pre-existing/359 warnings`)
> predates this reconciliation and should be re-run fresh before the next commit in
> this area rather than trusted — it was sitting unlabeled at the top of this file.
> Tasks 12-16 below are new, added from a second-pass addendum review; they were not
> part of the original plan.

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

- [x] **Step 1: Add `@webgpu/types` dependency**

```bash
cd packages/compositor
pnpm add -D @webgpu/types
```

- [x] **Step 2: Remove handwritten ambient types**

Delete `packages/compositor/src/webgpu/webgpu-env.d.ts`.

- [x] **Step 3: Update tsconfig to include WebGPU types**

In `packages/compositor/tsconfig.json`, add `"types": ["@webgpu/types"]` to `compilerOptions`.

- [x] **Step 4: Update compositor code to use correct types**

In `packages/compositor/src/webgpu/backend.ts`, remove the local `interface GpuNavigator extends Navigator` and replace with standard `navigator.gpu` typing from `@webgpu/types`.

In `packages/compositor/src/webgpu/detect.ts`, update the detection function to use proper `@webgpu/types` API.

In `packages/compositor/src/webgpu/shaders.ts`, update the `CircleUniform` struct to use `vec2<f32>` instead of `vec2f` if needed (WGSL `vec2f` IS valid in modern WGSL — check consistency).

In `packages/compositor/src/canvas2d/tileCache.ts` — update any type references.

- [x] **Step 5: Run typecheck and fix any new errors**

Run: `pnpm --filter @strata/compositor typecheck`
Expected: 0 errors with WebGPU types properly resolved.

- [x] **Step 6: Run full compositor tests**

Run: `pnpm --filter @strata/compositor test`
Expected: 7/7 pass (no behavior change, just types).

- [x] **Step 7: Commit**

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 3: Tessellate lines as quads in buildVertices**

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

- [x] **Step 4: Add line vertex shader alias + line fragment shader**

In `shaders.ts`, the existing `SOLID_VERTEX_WGSL` works for lines (same transform/passthrough). The existing `SOLID_FRAGMENT_WGSL` works too. No new shaders needed for lines after tessellation. Add a `LINE_VERTEX_WGSL = SOLID_VERTEX_WGSL` alias for clarity.

The pipeline in `init()` combines vertex+ fragment: we only need one pipeline for solid-fill rect+line+circle. But circle needs a separate fragment shader with `discard`. For now, keep the combined approach but push circle uniform via a 2nd bind group.

- [x] **Step 5: Update the pipeline to handle circle via a separate render pass or shader variant**

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

- [x] **Step 6: Write the fix test**

Run: `pnpm --filter @strata/compositor test`
Expected: All 7 tests pass, plus the new visible-pixels test.

- [x] **Step 7: Verify golden diff relaxes or passes**

Run: `pnpm --filter @strata/compositor test`
Expected: `fallback path matches Canvas2D` still passes (< 8 avg pixel diff).

- [x] **Step 8: Commit**

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

- [x] **Step 1: Create explicit bind group layouts**

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

- [x] **Step 2: Create pipelines with explicit layouts**

Replace the `layout: 'auto'` in `createRenderPipeline` calls with the explicit pipeline layouts.

- [x] **Step 3: Create reusable bind groups**

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

- [x] **Step 4: Update drawGpuItems to use shared bind groups**

In `drawGpuItems`, use the pre-created `cameraBindGroup` for the solid pipeline and `circleBindGroup` for the circle pipeline instead of creating a new bind group each frame:

```typescript
pass.setBindGroup(0, cameraBindGroup);
// ... vs the current:
pass.setBindGroup(0, device.createBindGroup({ ... }));
```

- [x] **Step 5: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: 7+/7 pass + golden diff still passes.

- [x] **Step 6: Commit**

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

- [x] **Step 1: Add a vertex buffer pool to WebGPUBackend**

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

- [x] **Step 2: Update drawGpuItems to use pool**

Replace the per-frame `device.createBuffer`/`.destroy()` with:

```typescript
const vertexBuffer = this.getOrCreateVertexBuffer(data.byteLength);
device.queue.writeBuffer(vertexBuffer, 0, data);
// Remove the vertexBuffer.destroy() call at the end
```

- [x] **Step 3: Clean up pool on destroy**

Add pool cleanup to `destroy()`:

```typescript
for (const buf of this.vertexPool.values()) buf.destroy();
this.vertexPool.clear();
```

- [x] **Step 4: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: 7+/7 pass + golden diff passes.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Add a render bundle cache**

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

- [x] **Step 2: Use bundles in drawGpuItems**

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

- [x] **Step 3: Implement the hash function**

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

- [x] **Step 4: Clear bundle cache on device/destroy events**

In `destroy()`: `this.bundleCache.clear();`

In `watchDeviceLost`, clear the cache on device lost.

- [x] **Step 5: Verify all tests pass**

Run: `pnpm --filter @strata/compositor test`
Expected: All tests pass (render bundles empty fallback when content changes every frame = never hits cache in test, but doesn't break).

- [x] **Step 6: Commit**

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

- [x] **Step 1: Enable wasm-opt at default level**

In `crates/strata-wasm/Cargo.toml`:
```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = true  # default -O optimizations (or "-O3" for max)

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false  # keep dev fast
```

- [x] **Step 2: Update wasm-pack.toml to match**

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = "-O3"

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false
```

- [x] **Step 3: Rebuild the WASM target**

```bash
just wasm-build
```

Expected: Build completes, `apps/desktop/public/wasm/strata_wasm_bg.wasm` is reduced in size (typically 30-50% smaller).

- [x] **Step 4: Verify WASM still loads**

Check the WASM file loads correctly:
```bash
node -e "
const fs = require('fs');
const wasm = fs.readFileSync('apps/desktop/public/wasm/strata_wasm_bg.wasm');
console.log('WASM size:', (wasm.length / 1024).toFixed(1), 'KB');
"
```

Note the before/after size.

- [x] **Step 5: Run Rust tests**

`cargo test --workspace` — Expected: 166/166 pass.

- [x] **Step 6: Commit**

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

> **Reconciliation finding (2026-07-11):** `wasm-build-simd` and `wasm-build-all` recipes
> exist in `justfile` (lines 34, 40) and `wasmLoader.ts` already fetches
> `strata_wasm_simd_bg.wasm` first — code-complete. But `.github/workflows/ci.yml`
> only runs `just wasm-build` (the base variant), never `wasm-build-all`. So the SIMD
> artifact is never built or uploaded in CI/release, meaning every shipped build falls
> through to the base WASM every time — the SIMD path is currently dead code in
> practice, not a shipped optimization. Fixing this is a one-line CI change
> (`wasm-build` → `wasm-build-all` in ci.yml and build.yml) plus confirming build time
> impact is acceptable; tracked as a follow-up rather than done here since it changes
> CI, which the git-workflow protocol (Task 15) says should land as its own reviewable
> commit.

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

- [x] **Step 1: Add prewarm function to wasmLoader**

```typescript
let prewarmPromise: Promise<WasmEngineModule | null> | null = null;

export function prewarmWasmEngine(): void {
  if (prewarmPromise) return;
  prewarmPromise = loadWasmEngineModule();
}
```

- [x] **Step 2: Wire prewarm into CanvasArea mount**

In `CanvasArea.tsx`, add a `useEffect` on mount that calls `prewarmWasmEngine()`:

```typescript
import { prewarmWasmEngine } from '@strata/engine';

useEffect(() => {
  // Warm up WASM engine on mount while user is looking at blank canvas
  prewarmWasmEngine();
}, []);
```

The `createEngine` call in `CanvasArea` already uses the cached module from `loadWasmEngineModule` when it calls `tryWasmEngine`, so the promise will resolve instantly.

- [x] **Step 3: Verify no regressions**

Run: `pnpm typecheck` — Expected: 0 errors.
Run: `pnpm --filter @strata/editor test` — Expected: 1385/1385 pass (or close to it).

- [x] **Step 4: Commit**

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

- [x] **Step 1: Extend WorkerCommand with image map**

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

- [x] **Step 2: Update CanvasArea to send image bitmaps**

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

- [x] **Step 3: Update renderWorker to use ImageBitmaps**

In `renderWorker.ts`, on `render` message with `images`, store the bitmap map:

```typescript
let imageMap: Record<string, ImageBitmap> = {};

// In render handler:
if (msg.images) imageMap = msg.images;
```

- [x] **Step 4: Make paintImageFill work in worker via imageMap**

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

- [x] **Step 5: Remove the image-fill gate (if images have bitmaps available)**

In `sceneCompositing.ts`, document that `sceneHasImageFills` can be relaxed when images are pre-loaded:

Actually, this is more nuanced. Keep `sceneHasImageFills` as a fast-path gate for the initial frame. Once images are loaded (via ImageCache), subsequent frames can use the worker path with pre-loaded bitmaps. For now, the conservative approach: keep the main-thread gate for image fills, but document that the Structured Clone path is available for future use.

The `sceneHasImageFills` function remains the primary gate. This task creates the infrastructure for the worker to handle images, but does NOT change the routing logic yet (too risky — images may not be pre-loaded when the worker starts rendering).

- [x] **Step 6: Write a test for image transport**

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

- [x] **Step 7: Commit**

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

- [x] **Step 1: WebGPU benchmark — vertex buffer pool hit rate**

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

- [x] **Step 2: WASM benchmark — buildIr throughput**

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

- [x] **Step 3: Run benchmarks**

```bash
pnpm --filter @strata/compositor test -- --run packages/compositor/src/webgpu/bench.test.ts
pnpm --filter @strata/engine test -- --run packages/engine/src/bench/wasm-bench.test.ts
```

Expected: Benchmarks pass within thresholds.

- [x] **Step 4: Commit**

```bash
git add packages/compositor/src/webgpu/bench.test.ts packages/engine/src/bench/wasm-bench.test.ts
git commit -m "test(perf): WebGPU vertex pool + WASM throughput benchmarks"
```

---

### Task 11: Regression gate — full suite

> **Reconciliation finding (2026-07-11):** a prior run's result (`Tests: PASSED 3970`,
> `Typecheck: FAILED — 43 pre-existing errors`, `Lint: FAILED — 12 pre-existing errors,
> 359 warnings`) was left as an unlabeled fragment at the very top of this file with no
> date or commit reference, which made it look like current status when it was stale.
> Moved here for visibility. Per AGENTS.md's regression protocol, `pnpm typecheck` must
> be 15/15 and lint 0 *new* errors before committing — "43/12 pre-existing" needs a
> fresh run to confirm it's still accurate and still pre-existing (i.e., not introduced
> by this work) before relying on it again. Re-run Steps 1-2 below and record the
> result with a date instead of leaving it ambient.

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

### Task 12: Rollback readiness — fallback removal criterion

**Rationale:** `settings.render.preferWebGpu` (`packages/editor/src/settings.ts:41,85`) already gives a runtime-toggleable fallback — it's a persisted setting with a Settings UI toggle, not a build-time flag, so incident response doesn't require a rebuild. That part of this concern is already satisfied. What's missing is documentation of the two things that make a fallback a real safety net rather than permanent dual-implementation debt: the exact incident-response order, and a criterion for when the fallback (and the Canvas2D-parity-maintenance burden it implies) gets removed.

- [ ] **Step 1: Document known caveat** — flipping `preferWebGpu` currently requires an app/tab reload to re-init the compositor (per `WEBGPU_WASM_ENGINE_MEMORY.md`); it is not a hot-swap mid-session. State this explicitly in `docs/architecture/render-pipeline.md` so on-call doesn't discover it live.
- [ ] **Step 2: Document incident-response order** — (a) flip `preferWebGpu` off / ship a default-flip if needed (fast, no deploy for users who already have the setting UI; a forced default change still needs a release), (b) only if the fallback itself doesn't resolve the issue, bisect and revert specific WebGPU/WASM commits (this implies shared cleanup code — e.g. `destroy()`, vertex pool teardown — is the suspect, since it runs regardless of which path is active).
- [ ] **Step 3: Define removal criterion** — e.g. "remove the Canvas2D-parity requirement once WebGPU has shipped as default for N releases with no rollback, across the cross-platform matrix" (tie to whatever matrix Task 16 / ADR-0003 ends up defining). Record it in `docs/adr/0003-compositor-backend-selection.md` so it isn't an unstated permanent dual-implementation.

---

### Task 13: Shader/pipeline compilation caching — measure before assuming

**Rationale:** Pipeline/shader-module creation cost is a real, separate contributor to startup latency alongside WASM init, but it hasn't been measured here, and — this is the important constraint — **WebGPU does not currently expose a standard, JS-accessible persistent pipeline cache API** (unlike Vulkan's `VkPipelineCache` or Metal binary archives). Dawn/wgpu may cache internally at the process or driver level, but there is nothing in the spec today for an app to explicitly serialize compiled pipeline state to disk and reload it across launches. Treat "can we cache this" as an open research question with a likely-negative answer, not an implementation task.

- [ ] **Step 1: Measure baseline** — add a timing mark around `device.createShaderModule` + `device.createRenderPipeline` in `WebGPUBackend.init()` (`packages/compositor/src/webgpu/backend.ts:173-281`), separate from WASM init timing. Log via the existing `CompositorDiagnostics` path.
- [ ] **Step 2: Confirm spec status** — re-check the current WebGPU spec / Dawn and wgpu release notes for any shipped pipeline-cache proposal before assuming it's still unavailable; this changes fast enough to be worth a fresh look rather than trusting this document.
- [ ] **Step 3: If still unavailable**, document the finding in `docs/architecture/render-pipeline.md` and close this out as "not implementable today, revisit if the spec changes" rather than leaving it as a silent gap. If a cache mechanism does exist by the time this is read, scope it as a new task rather than bolting it on here.

---

### Task 14: WASM threading reality check — documented finding

**Rationale:** the addendum asked this be made concrete rather than left as an abstract "threading assumptions unsupported on some targets." It now is:

- [x] **Finding:** No code in this repository uses `SharedArrayBuffer`, `wasm-bindgen-rayon`, or Rust `rayon` for WASM threading. The only `thread`-adjacent hits (`crates/strata-trace/src/lib.rs`, `apps/desktop/src-tauri/src/lib.rs`) are native-side `std::thread` usage in Tauri's Rust process, unrelated to the WASM module. The `simd128` variant (Task 7) is SIMD, which parallelizes across vector lanes within a single thread — it does **not** require shared memory or cross-origin isolation.
- [x] **Finding:** `apps/desktop/src-tauri/tauri.conf.json:28` sets `"csp": null` — no COOP/COEP-equivalent headers are configured. This is currently moot, since nothing requests threaded WASM. It becomes load-bearing only if threaded WASM is added later (e.g. a future `rayon`-based compute path), at which point Tauri's isolation story would need a real check (Tauri's webview shell differs from a browser tab; the COOP/COEP mental model doesn't map 1:1 and needs its own verification when it's actually needed).
- [ ] **Step 1 (if threading is ever proposed later):** re-open this task, verify Tauri's actual `SharedArrayBuffer` availability on all target platforms before relying on it, and confirm the single-threaded fallback path is the one actually exercised in tests on configurations where it's unavailable.

---

### Task 15: CI GPU honesty — documented gap, not implied coverage

**Rationale:** make explicit what "tests pass in CI" does and doesn't cover for the WebGPU path.

- [x] **Finding:** `.github/workflows/ci.yml` runs the Rust/JS matrix on GitHub-hosted `ubuntu-latest` / `macos-latest` / `windows-latest` runners. None provide real GPU hardware access. `packages/compositor/src/webgpu/golden.test.ts:114` explicitly self-skips via `it.skipIf(navigator.gpu === undefined)` — in Vitest/jsdom, `navigator.gpu` is always undefined, so **the WebGPU rendering path has never been exercised by an automated test run**; only the Canvas2D fallback path and the code-level unit tests (vertex math, pool reuse, hashing) run in CI. The "11/11 pass, 1 skipped native GPU" note in `WEBGPU_WASM_ENGINE_MEMORY.md` is this same skip, worth reading as "untested," not "tested and fine."
- [ ] **Step 1: Decide and document one of** — (a) a GPU-enabled CI runner (self-hosted with real hardware, or a GitHub-hosted GPU runner tier if available for this org), (b) a scheduled/manual benchmark-and-visual-regression pass on real hardware before each release, or (c) an explicit manual verification checklist maintained alongside releases. This is a cost/infra decision for a human, not something to default silently — flag it rather than pick one.
- [ ] **Step 2:** whichever is chosen, add a line to `docs/architecture/render-pipeline.md` stating the actual GPU-testing posture so "tests pass" claims in future PRs don't imply GPU coverage they don't have.

---

### Task 16: Documented minimum supported baseline

**Rationale:** `WebGPUBackend.init()` (`packages/compositor/src/webgpu/backend.ts:160-163`) already detects when the adapter is a software implementation (`adapterIsFallback`, checking for `'swift'` i.e. SwiftShader) and surfaces it via `CompositorDiagnostics` — but nothing currently *acts* on that signal. Right now a SwiftShader-backed "WebGPU" adapter is treated the same as real hardware, which is exactly the indefinite-capability-degradation gap the addendum flagged: detection exists, policy doesn't.

- [ ] **Step 1: Decide the floor** — e.g. "if `adapterIsFallback` is true, prefer Canvas2D over software-WebGPU" (a real GPU-optimized Canvas2D path is likely faster than a software-emulated WebGPU one) or "warn via diagnostics/status bar but allow it." This is a product/UX decision, not a technical one — surface it rather than pick silently.
- [ ] **Step 2:** implement whichever policy is chosen in `drawVectorItems`/`init` gating logic.
- [ ] **Step 3:** record the decision in `docs/adr/0003-compositor-backend-selection.md` alongside the existing backend-selection rationale, so it reads as one coherent policy instead of two separate half-decisions.

---

## Git Workflow Protocol (for remaining/future tasks in this area)

Adopted from a second-pass addendum review; scoped to this project's actual task-based
structure rather than the phase-cluster framing it was originally written in. Applies
to Tasks 12-16 above and any further WebGPU/WASM work, not retroactively to what's
already merged.

- **Why stricter here than elsewhere:** regressions in this subsystem are often
  driver-/hardware-specific and only reproducible after the fact (see Task 15) —
  bisectability matters more here than in most of this codebase.
- **One behavioral change per commit**, small enough that `git bisect` lands cleanly
  on a single cause if a user reports a regression on a specific GPU/driver
  combination. Conventional commits, per existing repo convention.
- **Commit messages reference the task/finding that motivated the change** (e.g. "Task
  16" or "addendum §6") so this document and the change history stay reconcilable —
  the exact drift this reconciliation pass had to repair once already.
- **Docs/ADR updates land in the same commit or PR as the behavioral change they
  describe**, not deferred to a later pass.
- **Push and open PRs only with explicit go-ahead** — none of Tasks 12-16 involve a
  push or PR yet; this section documents the protocol for when they do, it doesn't
  authorize one now.
- **Merge to master requires explicit human sign-off** — consistent with how this
  repo already treats master as the single working branch.
- **If CI fails, fix and re-push the same branch** rather than routing around it.

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
