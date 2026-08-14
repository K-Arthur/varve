# Image enhancement system

Varve presents image restoration and super-resolution as one user workflow:
`Image → Enhance…`. Internally, the operations remain distinct so a model is
never selected by a marketing label or architecture family alone.

```text
Enhance dialog (Auto / Recommended + manual operations)
    ↓
RestorationRequest
    ↓
planRestoration (task + capability validation, no model load)
    ├── denoise → SCUNet through the shared native/worker provider chain
    ├── deblur → NAFNet-GoPro-width64 (validated, shipped)
    ├── compression restoration → unavailable (no model passed the corpus)
    └── upscale → Real-ESRGAN or bounded CPU/pixel-art scaling
    ↓
runRestoration (lazy dispatch, cancellation, stage timings)
    ↓
materialized image result → one document mutation / one undo entry
```

## Current capabilities

The canonical capability inventory is `packages/engine/src/restoration.ts`.
The shipped AI capabilities are:

- `scunet`: real-world RGB denoising, Apache-2.0, ONNX. Padding must be a
  multiple of 64 (the conversion's baked attention reshape crashes
  otherwise — corrected 2026-08-13; the manifest previously claimed 8).
- `nafnet-deblur-gopro`: NAFNet-GoPro-width64 deblurring, MIT, ONNX fp16
  (138 MB single file, dynamic shape, BGR boundary swap). Reproducible
  conversion + parity evidence in `tools/nafnet-export/`; artifact hosted
  on the `varve-models-v1` GitHub release with a pinned SHA-256.
- `upscale-realesr-general`: Real-ESRGAN general x4 super-resolution, ONNX,
  using the existing tiled provider.

JPEG artifact removal is represented as a user operation but is rejected by
the planner: no model passed Varve's design-content corpus (SCUNet destroys
1px line patterns and harms UI screenshots; the only NAFNet checkpoint
trained with JPEG was rejected on state-dict provenance). SCUNet is not
advertised as a JPEG-specific model. A new checkpoint must provide task
provenance, licensing, hashes, conversion details, and Varve corpus
evidence before it is added.

## Execution and compatibility

`runRestoration` composes stages and reuses one shared restoration core
(`restorationProviders/`): a single native→worker provider chain, one
tiled orchestrator with task-aware tile policy, and model adapters that
own channel order (NAFNet is BGR-trained; SCUNet RGB) and padding. The
legacy `dispatchDenoise` API remains as a compatibility wrapper, and
`upscaleSelectedImage` callers keep working; `operation` is optional and
activates the unified planner when present.

Deblur tiling is adaptive (single-shot up to 1280 px, then 1280/256):
NAFNet's global receptive field makes small tiles visibly seamed
(34 dB tiled-vs-whole at 768/128 on a 1536 px image vs 60 dB single-shot).

Preview requests crop a centered region before model dispatch. Final
requests retain the existing output pixel budget and document safeguards.
Alpha is carried separately by both restoration paths, and pixel-art
scaling stays on its specialized algorithm path rather than entering photo
restoration.

The default output is a new derived image layer. Replace-source remains
atomic and undoable. The existing persisted derived-output metadata is kept
for compatibility; it must not be described as re-editable non-destructive
restoration until the document model can replay the operation across model
revisions.

## Model management and supply chain

Model downloads continue to use the verified manifest and existing model
loader. Models are task-specific and lazy: selecting Denoise requests
SCUNet; selecting Deblur requests the NAFNet checkpoint; selecting CPU
Upscale requests nothing. A model is usable only after its declared
checksum and source policy pass verification. Large weights are not
committed to Git — the 138 MB deblur artifact ships as a release asset
with a pinned hash.

## Auto / Recommended mode

`packages/engine/src/restorationAuto.ts` runs a cheap classical analysis
(Laplacian-MAD noise, Laplacian-variance blur, 8px-grid blockiness,
resolution) and proposes an operation in human terms with a confidence
number. No neural classifier gates which neural model loads. A
compression-restoration suggestion is never silently substituted: the
dialog explains the operation is unavailable and offers the closest
validated operation instead.

## Validation policy

Fast validation covers planner contracts, mocked providers, alpha/dimension
goldens, cancellation, preview bounds, tile-blend regressions, and editor
behavior. Real-model quality and performance belong to the opt-in
corpus/benchmark lane: `scripts/bench/restore-reference/` (deterministic
degradation corpus, TS-exact ORT runners, contact sheets) and
`tools/nafnet-export/` (conversion + parity gate). Measured results live in
[`docs/quality/image-enhancement-benchmark.md`](../quality/image-enhancement-benchmark.md);
deblur quality claims are anchored to that run, not to academic numbers.

See also:

- [`docs/architecture/onnx-inference-architecture.md`](onnx-inference-architecture.md)
- [`docs/testing/real-image-validation-corpus.md`](../testing/real-image-validation-corpus.md)
- [`docs/quality/validation-strategy.md`](../quality/validation-strategy.md)
