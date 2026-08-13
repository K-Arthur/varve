# Image enhancement system

Varve presents image restoration and super-resolution as one user workflow:
`Image → Enhance…`. Internally, the operations remain distinct so a model is
never selected by a marketing label or architecture family alone.

```text
Enhance dialog
    ↓
RestorationRequest
    ↓
planRestoration (task + capability validation, no model load)
    ├── denoise → SCUNet through the existing native/worker provider chain
    ├── deblur → unavailable until a task-specific checkpoint is validated
    ├── compression restoration → unavailable until a task-specific checkpoint is validated
    └── upscale → Real-ESRGAN or bounded CPU/pixel-art scaling
    ↓
runRestoration (lazy dispatch, cancellation, stage timings)
    ↓
materialized image result → one document mutation / one undo entry
```

## Current capabilities

The canonical capability inventory is `packages/engine/src/restoration.ts`.
The current shipped AI capabilities are:

- `scunet`: real-world RGB denoising, Apache-2.0, ONNX, 8-pixel padding,
  alpha preserved outside the model.
- `upscale-realesr-general`: Real-ESRGAN general x4 super-resolution, ONNX,
  using the existing tiled provider.

Deblur and JPEG artifact removal are represented as user operations but are
deliberately rejected by the planner. SCUNet is not advertised as a deblur or
JPEG-specific model. A new checkpoint must provide task provenance, licensing,
hashes, conversion details, and Varve corpus evidence before it is added.

NAFNet remains an evaluation candidate, not a shipped dependency. Its
denoising and deblurring checkpoints are task-specific and must not be
conflated; no model is added merely because it is popular or implemented in
Rust.

## Execution and compatibility

`runRestoration` composes stages and reuses `dispatchDenoise` and
`dispatchUpscale`. It does not create a second provider registry or eagerly
load models. Existing `UpscaleOptions` and `upscaleSelectedImage` callers
remain valid; `operation` is optional and activates the unified planner when
present.

Preview requests crop a centered region before model dispatch. Final requests
retain the existing output pixel budget and document safeguards. Alpha is
carried separately by the denoise implementation, and pixel-art scaling stays
on its specialized algorithm path rather than entering photo restoration.

The default output is a new derived image layer. Replace-source remains
atomic and undoable. The existing persisted derived-output metadata is kept
for compatibility; it must not be described as re-editable non-destructive
restoration until the document model can replay the operation across model
revisions.

## Model management and supply chain

Model downloads continue to use the verified manifest and existing model
loader. Models are task-specific and lazy: selecting Denoise requests SCUNet;
selecting CPU Upscale does not request a restoration model. A model is usable
only after its declared checksum and source policy pass validation. Large
weights are not committed to Git.

## Validation policy

Fast validation covers planner contracts, mocked providers, alpha/dimension
goldens, cancellation, preview bounds, and editor behavior. Real-model quality
and performance belong to the opt-in corpus/benchmark lane. Do not claim NAFNet
parity, GPU support, deblur quality, JPEG cleanup, or browser AI parity until
those paths have measured evidence.

See also:

- [`docs/architecture/onnx-inference-architecture.md`](onnx-inference-architecture.md)
- [`docs/testing/real-image-validation-corpus.md`](../testing/real-image-validation-corpus.md)
- [`docs/quality/validation-strategy.md`](../quality/validation-strategy.md)
