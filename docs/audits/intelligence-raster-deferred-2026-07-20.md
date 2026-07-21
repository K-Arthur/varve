# Intelligence & Raster Deferred Items — 2026-07-20

Immediate items from the intelligence architecture report and
clipping-blend audit have been implemented. This file captures what
remains deferred, with concrete next-step guidance for each.

## Immediate items completed (this session)

| Item | Key files | Tests |
|------|-----------|-------|
| Wire `mlModelRegistry.ts` to real ONNX loading | `packages/editor/src/intelligence/mlModelRegistry.ts` | 5 (updated) |
| Guided filter in `refineEdgeBand` | `packages/engine/src/backgroundRemoval/reconstructMask.ts` | 3 (updated) |
| Model loading unification verified | `upscaleProviders/dispatch.ts` → shared `modelLoader.ts` | 631 passing |
| Contrast audit unification (D6) | `packages/shared/src/contrast.ts`, `packages/scene/src/intelligence/audit.ts`, `packages/editor/src/intelligence/wcagFix.ts` | 53 passing |

## Deferred — Intelligence architecture (ranked)

### D1. InferenceCore extraction (Medium effort, very high reuse)

Extract the BG-removal provider chain (`dispatch.ts`, `workerPool.ts`,
`modelLoader.ts`) into a generic `InferenceCore` in `@strata/engine`.
A new model should be a manifest entry + preprocessing spec only.

Trigger: when the second real model (after layout-classifier) is added.

Key files: `packages/engine/src/backgroundRemoval/dispatch.ts`,
`workerPool.ts`, `modelLoader.ts`.

### D2. Layout classifier model (High effort, high impact)

Train or convert a MobileNetV3-small / EfficientNet-Lite0 for layout
classification (document type, column/row structure). Input 224×224
rendered frame, output class probabilities. Target 2-5MB INT8.

Requires: training data (PubLayNet, DocBank), ONNX export, manifest
entry, preprocessing spec in InferenceCore.

### D3. INT8 dynamic quantization path (Medium effort, high impact)

Faster CPU fallback (2-4x) for existing bundled models. Use ORT
`quantization` Python toolkit; validate quality per-model.

### D3.5. ~~Contrast audit unification~~ ✅ Done

Extracted `isLargeText` to `@strata/shared/contrast.ts`; both `audit.ts`
and `wcagFix.ts` now import it. `audit.ts` uses `managedColorToRgba`
(CMYK/gray/spot, not just RGB). "skips non-RGB" test renamed to
"handles non-RGB" — the audit now evaluates all color spaces.

### D4. Guided filter quality — closed-form matting (Low effort)

`refineEdgeBand` now uses the guided filter from `refineHairMatting.ts`.
Closed-form matting (Levin et al.) is still deferred — would improve
hair/fur edges further but the guided filter covers the common case.

### D5. ort crate bus-factor mitigation (Low effort, ongoing)

`ort` is single-maintainer. Abstract ORT behind a thin interface in
`strata-bgremove` so the crate is swappable (to `tract`, `burn`, or ORT
C API) without rewriting inference code.

### D6. On-device LLM via llama.cpp (Very high effort, speculative)

Only if NL commands prove valuable server-side first. Qwen2.5-1.5B-Instruct
GGUF Q4_K_M (~2GB). Requires Rust bindings to llama.cpp.

## Deferred — Clipping & blend audit (ranked)

### D7. Live frame subtree compositing (High effort)

Frame subtree rendering with bounded offscreens. Needed for correct
compositing of nested blend modes and effects within frames.

### D8. Effect ordering finalization (Medium effort)

Effects render in array order within each pass (backdrop → fills →
content → main → edge highlight). Cross-pass ordering is correct but
per-node effect array order is user-driven with no implicit sort.
Needs UX for reordering effects within a node.

### D9. Adaptive contrast text (Medium effort)

Text on blended/clipped surfaces should auto-adjust contrast. Depends on
live frame subtree compositing (D7) for correct backdrop sampling.

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
| WebNN | Reject until 2027+ |
| WebGPU ML | Investigate only (no Safari) |
