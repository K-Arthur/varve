# WebGPU & WASM Engine Memory Tracker

> Persistent state log for the WebGPU/WASM acceleration overhaul.
> Updated at the end of each implementation turn.

## Session: 2026-07-08

### Research Summary (Phase 1)

**Industry patterns (Figma, Canva-class tools):**
- C++ renderer compiled to WASM (Emscripten) + native via Dawn/wgpu for WebGPU parity
- Tile-based dirty-region rendering; RenderBundles for repeated draw submission
- Dynamic mid-session WebGPU→WebGL fallback on device loss
- Explicit pipeline layouts; uniform buffer batching; compute shaders for blur/filters

**WebGPU optimization:**
- Avoid `layout: 'auto'` — use explicit `GPUPipelineLayout` + shared bind groups
- Pipeline compilation caches expected per spec; key by shader+layout not instance ID
- WGSL uniform buffers: 16-byte struct alignment
- Vertex buffer pooling — never create/destroy per frame
- Render bundles encode draw commands once for static geometry

**WASM:**
- wasm-opt -O3 for 30-50% size reduction
- simd128 variant for vector-heavy IR build
- Pre-warm via requestIdleCallback before first document open
- Structured Clone ImageBitmap transport for worker image fills

### Baseline Audit (pre-fix)

| Component | Status |
|-----------|--------|
| WebGPU Tasks 1-5 | Coded but **inert** — Canvas2D acquired before WebGPU context |
| preferWebGpu | Never wired from CanvasArea |
| Multi-circle | Wrong uniform (first circle only) |
| Bundle cache | Stale vertex data on hash hit; weak 64-float hash |
| WASM wasm-opt | Disabled in Cargo.toml |
| SIMD loader | Base WASM preferred over SIMD variant |
| Worker images | Types exist; CanvasArea never sent bitmaps |

### Implementation Log — Turn 1 (complete)

| Area | Change | Files |
|------|--------|-------|
| **P0 WebGPU init** | WebGPU context before 2D; offscreen fallback for non-GPU primitives; alpha blit overlay | `webgpu/backend.ts`, `canvas2d/backend.ts`, `shaders.ts` |
| **Circle fix** | Per-circle draw with correct discard uniform (no bundle cache) | `webgpu/backend.ts` |
| **Bundle cache** | Full FNV hash; always `writeBuffer` before execute; clear on first pass | `webgpu/backend.ts` |
| **preferWebGpu** | `settings.render.preferWebGpu` + Settings UI toggle + CanvasArea wiring | `settings.ts`, `SettingsDialog.tsx`, `CanvasArea.tsx` |
| **Diagnostics** | `CompositorDiagnostics` + StatusBar + `compositorDiagnosticsStore` | `types.ts`, `StatusBar.tsx` |
| **WASM** | wasm-opt -O3 in Cargo.toml + wasm-pack.toml; SIMD-first loader | `wasmLoader.ts`, `crates/strata-wasm/` |
| **Worker images** | `collectImageBitmaps` + transferables in `workerHost` + `sceneCanUseWorkerRenderer` | `collectImageBitmaps.ts`, `sceneCompositing.ts`, `CanvasArea.tsx` |
| **Tests** | bench.test.ts, wasm-bench.test.ts, line tessellation, worker gate tests | compositor + editor + engine |
| **Docs** | render-pipeline.md, wasm-backends.md updated | `docs/architecture/` |

### Test Results (Turn 1)

| Suite | Result |
|-------|--------|
| `@strata/compositor` | **11/11 pass** (1 skipped native GPU) |
| Compositor typecheck | **0 errors** |
| Editor typecheck | pending |

### Known Limitations (honest)

- WebGL2 fallback not implemented (Canvas2D is CPU path; ADR-0003 Linux stays Canvas2D default)
- WebGPU covers rect/circle/line only; text/path/effects use 2D overlay
- `preferWebGpu` requires tab reload to re-init compositor
- WASM SIMD build requires `just wasm-build-all` (artifacts not committed)
- WebGPU native golden test skipped in jsdom (no `navigator.gpu`)

### Upcoming Branch Targets

- `feat/webgpu-wasm-acceleration` — recommended worktree branch for merge

### Memory Footprints

- Vertex pool: power-of-2 rounded buffers
- Bundle cache: LRU max 32 entries
- Worker image map: keyed by src URL, zero-copy transferables
