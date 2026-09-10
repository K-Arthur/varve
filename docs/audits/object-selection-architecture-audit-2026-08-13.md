# Object Selection architecture audit — 2026-08-13

This is the pre-implementation audit for the intelligent Object Selection
workstream. It records the repository state before the staged changes in this
branch. The user-facing feature name is **Object Selection**; SAM 2 is an
implementation detail of the current backend.

## Findings

| Area | Current implementation | Decision |
| --- | --- | --- |
| Document masks | `@varve/scene` has immutable `RasterMaskAsset` resources and `Node.mask.rasterMask`; `commitRasterMask` is the editor entry point. | Reuse it. Do not add a SAM-only mask type. |
| Mask algebra | Scene and compositor support alpha/vector/effect masks, but prompt-result combination was not exposed as a small pure service. | Add model-independent `combineAlphaMasks` for replace/add/subtract/intersect. |
| Image coordinates | `imageMaskCoordinates.ts` maps world points through node transforms and image placement to source pixels. | Use the same mapper for Object Selection prompts; never derive prompts from axis-aligned world bounds. |
| Inference | `@varve/engine` owns a worker-backed ONNX registry. SAM is currently split into encoder and decoder graphs and the image embedding is cached in `useSam2Segmentation`. | Preserve worker isolation, but put the editor behind `SegmentationBackend`. |
| Model lifecycle | Manifest/catalog, checksum verification, download progress, cancellation, and model settings UI already exist. | Extend the shared catalog; do not create a second downloader. |
| Native model storage | Tauri injects `AppDirectories.models`; comments and one test still mention `strata/models`. The current Rust fallback is `dev.varve.desktop/models`. | Correct the stale documentation and add an explicit legacy migration probe before changing storage behavior. |
| Temporary state | Background removal has a transient preview session; Object Selection currently toggles preview mode without retaining the returned mask for overlay/refinement. | Add a dedicated transient Object Selection session in the editor state. It must not enter document history until Apply. |
| Tool interaction | `Sam2SegmentationTool` adds a point on pointer-down and also starts a box, so click and box semantics overlap. | Split click-vs-drag recognition and expose explicit positive/negative prompt mode. |
| Subject/background | No reliable semantic subject detector is wired to SAM. Existing background removal is a separate automatic foreground pipeline. | Do not call arbitrary automatic proposals “Select Subject”. Use the existing foreground estimate as the honest fallback and document ambiguity. |
| Candidate masks | Decoder returns multiple candidates but the editor immediately chooses `selectedIndex`. | Preserve candidates in the session and allow cycling when the UI milestone lands. |
| Website | Feature pages describe background removal but not Object Selection. Screenshot automation has a generated manifest and no current selection scene. | Add measured, capability-accurate Object Selection copy first; add imagery only from the shipping UI. |

## Runtime decision status

The current repository contains an ONNX worker path and verified SAM2 encoder /
decoder graph contracts, but no checked-in parity corpus or reproducible
benchmark comparing ONNX Runtime with Candle + safetensors. Therefore this
workstream does **not** claim that Candle is production-ready or that ONNX is
the measured winner yet. The first implementation keeps ONNX behind the
backend contract and adds benchmark/parity documentation requirements before
any runtime replacement.

## Target pipeline

```text
Object Selection tool
  → source-image coordinate adapter
  → SegmentationBackend
  → bounded embedding cache
  → worker/runtime (currently split ONNX graphs)
  → candidate mask session (transient)
  → combineAlphaMasks / manual refinement
  → commitRasterMask (one document history operation)
```

Heavy work stays off the canvas render loop. Cache keys must include source
identity/revision, model identity/version, preprocessing version, and crop
context. Embeddings are session data and are not serialized into documents.

## Progressive commit boundaries

1. `test(selection)`: backend contract, mask algebra, and fixtures.
2. `feat(models)`: catalog truth, lifecycle messaging, and legacy storage migration.
3. `feat(inference)`: adapter around the existing worker and bounded embedding cache.
4. `feat(editor)`: transient prompt/candidate session, correct click/box/prompt modes.
5. `feat(mask)`: apply/refine/undo integration and downstream mask consumers.
6. `test(selection)`: coordinate, race, quality, performance, E2E, and visual coverage.
7. `docs/website`: user/developer docs, provenance, ADR, and measured marketing copy.

## Known audit limitations

No real model download, official SAM reference predictor, or GPU matrix was
run during this audit. Those are validation gates for the inference milestone,
not facts inferred from the existence of an ONNX file or a manifest entry.
