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
  using the existing tiled provider (`TILE 64/OVERLAP 16`).
- `upscale-realesrgan-anime`: Real-ESRGAN anime/illustration x4 (6B), with a
  pinned ONNX artifact, checksum, source license, and contract/inference
  validation in the model manifest. It is optional and downloaded on demand;
  the UI never silently substitutes the general checkpoint when it is absent.
  The task-quality corpus benchmark remains a separate measured gate.

JPEG artifact removal is represented as a user operation but is rejected by
both planner (`planRestoration` throws `unsupported-operation`) and dispatch
(`dispatchRestorationTask` throws even if the planner is bypassed): no model
passed Varve's design-content corpus (SCUNet destroys 1px line patterns and
harms UI screenshots; the only NAFNet checkpoint trained with JPEG was
rejected on state-dict provenance). SCUNet is never advertised as a
JPEG-specific model. A new checkpoint must provide task provenance,
licensing, hashes, conversion details, and Varve corpus evidence before it
is added.

**Candidate:** FBCNN (Jiang et al., ICCV 2021, Apache-2.0) is the leading
candidate for future JPEG artifact removal. It is a flexible blind CNN that
predicts the JPEG quality factor and embeds it into the reconstructor for
configurable restoration strength (~6.7 MB, pixel-domain, no DCT access
needed). OpenVINO model zoo has a pre-exported version. To enable it:
1. Convert to ONNX with verified SHA-256 (tools/fbcnn-export/).
2. Run the design-content corpus (tests/fixtures/restore-corpus/) and
   measure PSNR on JPEG-degraded fixtures.
3. Verify it does not destroy 1px lines, text edges, or UI screenshots.
4. Only then add a `compression-restoration` capability with
   `status: 'available'` and enable the UI option.

Scale semantics:
the Real-ESRGAN model is fixed 4×. A request for 2×/3× via AI is served as
**AI 4× → high-quality lanczos3 downsample** to the exact target size
(`restorationPipeline.ts`, `enhancementPipeline.ts`). This honest pipeline is
documented in the dialog's output hint and avoids claiming variable-scale
super-resolution.

## Execution and compatibility

`runRestoration` composes stages and reuses one shared restoration core
(`restorationProviders/`): a single native→worker provider chain, one
tiled orchestrator with task-aware tile policy, and model adapters that
own channel order (NAFNet is BGR-trained; SCUNet RGB) and padding. The
legacy `dispatchDenoise` API remains as a compatibility wrapper, and
`upscaleSelectedImage` callers keep working; `operation` is optional and
activates the unified planner when present.

Native and worker SCUNet preprocessing are intentionally equivalent: both
repeat edge pixels to the next graph-safe multiple of 64, then crop the
top-left output back to the source dimensions. Native inference must not use
resampling for this padding because it changes thin lines and alpha edges.

Deblur tiling is adaptive (single-shot up to 1280 px, then 1280/256):
NAFNet's global receptive field makes small tiles visibly seamed
(34 dB tiled-vs-whole at 768/128 on a 1536 px image vs 60 dB single-shot).
Deblur has its own user-controllable strength (Light 0.3 / Medium 0.5 /
Strong 0.7 / Maximum 0.9) exposed as a segmented control when the
operation is Deblur or Deblur-Upscale. For backward compatibility, the
pipeline falls back to the denoise-mapped value when `deblur.strength` is
not set.

Preview is honest: a centered 512 px crop is enhanced with the *same*
preprocessing, model, and postprocessing as the final job, while the
baseline is the *same* crop upscaled with a neutral classical filter
(bicubic, nearest for pixel-art) to the *same* output dimensions. Both
halves are shown at the same pixel size under the split slider, which is
keyboard-accessible (← →, Shift+← →, Home/End) and offers Fit / 100%
pixel view. A 3×3 region picker lets the user choose which part of the
image to inspect (center by default). No browser-bilinear exaggeration.

Alpha is carried separately by both restoration paths, and pixel-art
scaling stays on its specialized algorithm path rather than entering photo
restoration. The `restorationAuto` heuristic adds a conservative
pixel-art hint (≤128 px short edge, ≤32 colours) that surfaces as
“consider Pixel Art mode” without overriding the resolution recommendation.

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
number. No neural classifier gates which neural model loads. Below 96 px
short edge, noise/blur signals are suppressed (only resolution matters) to
avoid flagging icons as noisy. A compression-restoration suggestion is
never silently substituted: the dialog explains the operation is
unavailable and offers the closest validated operation instead. Limited
palette on small images surfaces a pixel-art hint.

Progress and errors in the Enhance dialog are stage-aware (`Denoise` →
`Upscale` etc. with ✓/•) and typed (`model-not-installed` offers Download,
`hash-mismatch` Re-download, `dimension-limit`/`tensor-allocation` suggest a
smaller scale, `stale-result` explains source changed). Cancellation and
stale-job protection (revision check before commit) are enforced so a
preview cannot clobber an in-flight Apply.

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
