# Background-removal system

Status: current implementation contract, 2026-08-13.

Varve keeps background removal local by default. The workflow creates a
non-destructive raster mask on the selected image; the source raster remains
available for reset, editing, save/reload, and export.

## Architecture map

```text
Inspector / Selection Quick Bar
  → useBackgroundRemoval / subject-isolation actions
  → @varve/engine removeBackground
  → provider dispatch
  → model loader + unified manifest
  → Worker ONNX | native Tauri ONNX | direct ONNX | explicit cloud provider
  → model-specific preprocessing + inference
  → output activation, normalization, letterbox-aware reconstruction
  → soft mask cleanup / optional decontamination / optional matting refinement
  → source-resolution alpha mask
  → document raster-mask commit + undo
  → Canvas2D/WebGPU replay and PNG/PDF/export consumers
```

## User policy

The labels describe user intent, not implementation jargon:

| User mode | Policy | Download | Fallback |
|---|---|---:|---|
| Fast | Quick local heuristic for simple, colour-consistent backgrounds | No | Manual mask/trimap editing |
| Auto | IS-Net General Use when installed; bundled U²-NetP when it is not | Optional | Actual model/provider is recorded |
| High quality | BiRefNet General Lite, preferred through native ONNX on desktop | 224 MB | Auto result only with an explicit reduced-quality status |

BiRefNet Full remains an advanced, native-only catalogue entry. Its roughly
928 MB artifact and multi-gigabyte peak-memory estimate do not justify making
it an automatic default without a separate held-out quality/performance study.

The browser path refuses unsafe bare-WASM allocations before creating a session.
That is a safety decision, not a claim that every browser GPU provider is
unsupported. When a requested mode falls back, the result carries the actual
method/model and the review UI shows both requested and generated values.

## Model and runtime contract

The versioned JSON manifest in `apps/desktop/public/models/manifest.json` is the
authoritative frontend catalogue. It records IDs, source revision, license,
checksum, tensor contract, preprocessing/postprocessing versions, supported
providers, and memory estimate. `packages/engine/src/inference/manifest.ts`
normalises this data for the generic registry. Rust exposes a deliberately
small native IPC view of the same model IDs and checksums; its duplicate list
is a compatibility boundary that must stay covered by manifest-sync tests.

BiRefNet Lite and Full use the rembg ONNX exports currently pinned in the
manifest. The declared contract is 1024×1024 RGB float input, ImageNet
normalisation, and sigmoid output interpretation followed by soft-mask
reconstruction. The manifest checksum is integrity evidence, not reference
quality evidence.

Adding a model should require a manifest entry, a model-spec contract only when
pre/postprocessing differs, a compatible weight artifact, and corpus coverage.
Adding a runtime should implement the existing provider contract and prove
output parity before being placed ahead of ONNX.

## Quality and alpha semantics

`packages/engine/src/backgroundRemoval/qualityMetrics.ts` provides reusable
IoU, Dice, precision, recall, F0.3, mask MAE, boundary precision/recall/F-score,
and optional alpha SAD/MSE/gradient/trimap-band metrics. Binary segmentation
fixtures report only segmentation metrics. True alpha metrics require an
independently authored alpha matte and are never inferred from a thresholded
mask.

The benchmark writes source-resolution mask artifacts for visual inspection on
checkerboard, white, and black backgrounds. Reviewers should inspect hair,
fur, thin structures, holes, halos, and translucent material separately from
the aggregate numbers.

For reproducible native measurements, `crates/varve-bgremove/examples/bgremove_bench.rs`
records cold load, warm p50/p95, RSS, output masks, and optional reference
metrics. The Python harness under `scripts/bench/bgremove-reference/` mirrors
the pinned rembg stretch pipeline and Varve's letterbox pipeline, and preserves
the exact alpha channel of generated RGBA fixtures. It is an experiment tool,
reports mean/p95/max per-pixel divergence between those pipelines, and is not a
substitute for an independently annotated held-out corpus.

## Resource and lifecycle safeguards

- preview inference is capped and reconstructed to source dimensions;
- unsafe bare-WASM models are rejected before session creation;
- native sessions use a bounded model-keyed pool with cancellation checks;
- model downloads use pinned HTTPS/checksums, resumable partial storage, and
  atomic installation;
- stale editor jobs are rejected by request/document identity before commit;
- Quick is never silently substituted for an AI request;
- decontamination and hair/trimap refinement are optional mask operations, not
  destructive source-pixel replacement. Decontamination defaults to off on
  every provider, native included (opt-in everywhere).

## Reference parity and benchmarking

`scripts/bench/bgremove-reference/` contains the reproducible reference
pipeline (rembg-faithful ONNX inference for the pinned checkpoints), the
synthetic ground-truth fixture generator, the divergence decomposer, and the
contact-sheet renderer. `crates/varve-bgremove/examples/bgremove_bench.rs`
measures the native path (cold/warm latency, RSS, quality vs reference masks)
and writes machine-readable JSON with git commit and hardware metadata.
`crates/varve-bgremove/src/metrics.rs` mirrors `qualityMetrics.ts` so native
and browser reports are directly comparable.

Adding a model: manifest entry + checksum-verified artifact + (when
preprocessing differs) a model-spec entry in both the Rust `model_spec`/
`image_model_spec` and TS `getSegmentationModelSpec` + corpus coverage.
Adding a runtime: implement the existing provider contract and prove output
parity (same checkpoint, same preprocessing) before placing it ahead of ONNX.

## Known limits

Reference parity is measured, not assumed: `docs/audits/background-removal-parity-audit-2026-08-13.md`
records the same-checkpoint rembg-faithful reference runs (u2netp and IS-Net
verified; BiRefNet Lite/Full completed on a host with memory headroom — see the
audit for the current status), the native-vs-reference noise floor, and the
decomposition of the letterbox-vs-stretch and clamp-vs-min-max divergences.
The output normalisation now follows the reference (sigmoid where required,
then clamp — no min-max stretch), and a gated golden test pins native u2netp
against a checked-in reference mask.

Transparent glass, smoke, and similar materials need genuine alpha mattes or a
user-authored trimap. A binary foreground estimate cannot honestly promise
physical alpha separation for those cases. The synthetic `synth-glass` fixture
is the regression target for this limit (u2netp/IS-Net/BiRefNet all score it
low against the ground-truth matte; see the audit tables).
