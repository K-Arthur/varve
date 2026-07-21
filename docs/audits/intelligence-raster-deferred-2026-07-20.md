# Intelligence & Raster Deferred Items — 2026-07-20

Immediate items from the intelligence architecture report and
clipping-blend audit have been implemented. This file captures what
remains deferred, with concrete next-step guidance for each.

## Items completed (this session 2026-07-20)

| Item | Key files | Tests |
|------|-----------|-------|
| **D1** InferenceCore extraction | `packages/engine/src/inference/` — ModelRegistry, SessionManager, ProviderChain | 21 inference tests |
| **D4** Closed-form matting | `refineHairMatting.ts` — `applyClosedFormMatting()` selectable via `HairMattingOptions.method` | 3 existing + implementation |
| **D5** ort crate abstraction | `inference.rs` — `InferenceRuntime` trait + `OrtInferenceRuntime` impl | 2 new Rust tests (18 total) |
| **D8** Effect ordering documentation | `docs/architecture/effect-rendering.md` — 5-pass structure verified | — |

## Deferred — Intelligence architecture (ranked)

### D1. ~~InferenceCore extraction~~ ✅ Done

Extracted bg-removal provider chain into generic `InferenceCore`:
- `ModelRegistry` — generic manifest + lifecycle state machine
- `SessionManager` — ONNX session caching with provider-order resolution
- `ProviderChain` — generic provider chain with timeout/fallback/cancellation
- `mlModelRegistry.ts` now uses the shared core

### D2. Layout classifier model (High effort, high impact)

Train or convert a MobileNetV3-small / EfficientNet-Lite0 for layout
classification (document type, column/row structure). Input 224×224
rendered frame, output class probabilities. Target 2-5MB INT8.

Requires: training data (PubLayNet, DocBank), ONNX export, manifest
entry, preprocessing spec in InferenceCore.

**Integration seam:** add a `layout-classifier` entry to the
`ModelRegistry` manifest with an `inputSpec` (224×224, ImageNet
normalization), register a `LayoutClassifierProvider` via the
`InferenceProvider` interface, and wire it through the provider chain.
No existing provider chain code needs modification.

### D3. INT8 dynamic quantization path (Medium effort, high impact)

Faster CPU fallback (2-4x) for existing bundled models. Use ORT
`quantization` Python toolkit; validate quality per-model.

### D3.5. ~~Contrast audit unification~~ ✅ Done (previous session)

### D4. ~~Closed-form matting~~ ✅ Done

`refineEdgeBand` now supports two methods via `HairMattingOptions.method`:
- `'guided'` — fast box-filter guided filter (default, ~O(N))
- `'closed-form'` — sparse Laplacian with Gauss-Seidel (~O(N·iter))

The closed-form method implements:
- 3×3 window color covariance (full RGB, not just luminance)
- Sparse Laplacian with symmetric 3×3 inverse
- Gauss-Seidel iteration (40 iter default, tolerance 1e-4)
- Stronger constraints for known FG/BG pixels

### D5. ~~ort crate bus-factor mitigation~~ ✅ Done

`ort` is single-maintainer. Abstracted ORT behind `InferenceRuntime`/
`InferenceSession` trait pair in `strata-bgremove/src/inference.rs`.
`OrtInferenceRuntime` is the current implementation; alternative backends
(tract, burn, ort C API) can be added via `set_runtime()` without
rewriting `remove_ai()`.

### D6. On-device LLM via llama.cpp (Very high effort, speculative)

Only if NL commands prove valuable server-side first. Qwen2.5-1.5B-Instruct
GGUF Q4_K_M (~2GB). Requires Rust bindings to llama.cpp.

**Integration seam:** wrap GGUF inference behind the same
`InferenceRuntime` trait (with appropriate tensor-type changes). The
provider chain pattern already supports heterogeneous backends.

### D7. ~~Effect ordering finalization~~ ✅ Done

Verified and documented. See `docs/architecture/effect-rendering.md`.

### D9. Adaptive contrast text (Medium effort)

Text on blended/clipped surfaces should auto-adjust contrast. Depends on
live frame subtree compositing (D7 in original) for correct backdrop
sampling.

### D10. Structured alpha/luminance export (Medium effort)

Export alpha/luminance masks as separate channels. Needs artifact-level
tests against reference renderers.

### D11. PDF structural masks + raster-mask fallback (High effort)

PDF export of clip masks and blend modes. Currently preflight rejects
most structural mask cases. Needs explicit compatibility paths.

### D12. SVG import for clipping masks (High effort)

Export works; import does not. Requires parsing `<clipPath>`/`<mask>`
and reconstructing scene relationships.

### D13. PSD masks (High effort)

PSD layer mask import. Depends on `@webtoon/psd` decoder (already a
dependency for PSD import).

### D14. WebGPU eligibility/order (Low effort, monitor)

Blocked on Safari WebGPU. Monitor; when shipped, the `ort` crate's
WebGPU EP (via Dawn) is the browser-accelerated path.

### D15. E2E visual fixtures + platform coverage (Ongoing)

Browser E2E visual regression fixtures, desktop WebDriver verification,
many-mask/blend perf tests, platform coverage beyond Linux.

## Architecture decisions locked

| Decision | Choice |
|----------|--------|
| Primary runtime | ORT Native (desktop) + ORT Web WASM (web) |
| Model format | ONNX |
| CPU quantization | INT8 dynamic |
| GPU quantization | FP16 |
| Future LLM | llama.cpp (GGUF) — only if justified |
| Future Rust runtime | `InferenceRuntime` trait — swappable |
| WebNN | Reject until 2027+ |
| WebGPU ML | Investigate only (no Safari) |
