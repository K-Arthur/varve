# EfficientSAM-Ti A/B evaluation — 2026-09-14

Decision: **Rejected for production routing; retained as an offline benchmark
adapter only.** No manifest entry, no download surface, and no provider fact is
registered, so EfficientSAM cannot be selected by automatic or explicit
routing. The adapter exists so future provider comparisons can keep using one
shared corpus and the parity gate stays runnable.

## Question

Does EfficientSAM-Ti earn a place next to SAM2 and MobileSAM as a promptable
provider — either as a lower-resource option or as a quality competitor — on
the same source pixels, the same prompts, and the same runtime?

## Artifacts

| Item | Value |
| --- | --- |
| Official repository | `yformer/EfficientSAM` (Apache-2.0), export script `export_to_onnx.py` (opset 17, wraps the official `EfficientSam` module) |
| Official checkpoint | `weights/efficient_sam_vitt.pt` (Ti/Ti variant) |
| ONNX host | `yunyangx/EfficientSAM` revision `main` (upstream-sanctioned host, declared in the official README) |
| Encoder | `efficientsam_ti_encoder.onnx`, 24,799,761 B, SHA-256 `84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951` |
| Decoder | `efficientsam_ti_decoder.onnx`, 16,565,728 B, SHA-256 `a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11` |
| Combined reference | `efficientsam_ti.onnx`, 41,365,520 B, SHA-256 `143c3198a7b2a15f23c21cdb723432fb3fbcdbabbdad3483cf3babd8b95c1397` |
| Licenses | Apache-2.0 for source and weights; ONNX files are exports of the official checkpoint |
| Inputs (encoder) | `batched_images` `[1,3,H,W]` RGB in `[0,1]`; graph stretches to 1024x1024 and normalizes with ImageNet mean/std internally |
| Inputs (decoder) | `image_embeddings` `[1,256,64,64]`, `batched_point_coords` `[1,1,N,2]`, `batched_point_labels` `[1,1,N]`, `orig_im_size` **int64** `[2]` |
| Outputs (decoder) | `output_masks` `[1,1,3,H,W]` source-sized logits, `iou_predictions` `[1,1,3]` raw logits |
| Mask threshold | `0.0` (official `EfficientSam.mask_threshold`, sigmoid >= 0.5) |
| Prompt semantics | source-pixel points/labels; box = corner points labeled 2/3; padded/truncated to 6 points with (-1,-1) and -1, matching `predict_masks` |
| Candidate semantics | three multimask candidates ranked by raw predicted-IoU logits; scores are not calibrated probabilities |
| Runtime note | `orig_im_size` is int64-only (verified: int32/float32 feeds are rejected). ONNX Runtime Web cannot host int64 inputs on the WebGPU execution provider, so EfficientSAM would be WASM/native-only. |
| Capability note | The decoder has no mask-input tensor: EfficientSAM cannot satisfy a mask prompt or a refinement round-trip, unlike SAM2/MobileSAM. |

## Method

* Corpus: `packages/engine/src/segmentation/quality/corpus.ts` (`object-selection-corpus-v1`), 10 generated fixtures, unchanged oracle definitions.
* Harness: `pnpm exec vitest run packages/engine/src/segmentation/quality/providerAb.test.ts` with
  `VARVE_SAM2_REAL_MODEL_DIR`, `VARVE_MOBILE_SAM_MODEL_DIR`, `VARVE_EFFICIENT_SAM_MODEL_DIR`.
* Real-photo gate: `efficientSamRealModel.test.ts` runs the same photographs and prompts as the MobileSAM real-photo gate and asserts split-vs-combined parity against the official combined ONNX.
* Environment: onnxruntime-node 1.27.0, CPU execution provider, Linux x86_64. Encoder input is 1024x1024 for every provider; corpus fixtures are 128x128. Node CPU numbers are not browser numbers; they are comparable *within this run*.

## Results

### Corpus quality (selected candidate per provider, same prompts)

| Provider | mean IoU | mean boundary F | mean Dice | worst IoU | worst boundary F |
| --- | --- | --- | --- | --- | --- |
| SAM2.1 Hiera Tiny | 0.654 | 0.654 | 0.727 | 0.000 (foliage) | 0.000 |
| MobileSAM (Acly multi) | 0.747 | 0.714 | 0.823 | 0.221 (translucency) | 0.000 |
| EfficientSAM-Ti | 0.723 | 0.689 | 0.809 | 0.222 (translucency) | 0.000 |

EfficientSAM-Ti is materially better than SAM2 on this corpus (mean IoU +0.069)
and 0.025 IoU / 0.025 boundary F below MobileSAM — inside the routing
equivalence band of 0.03, i.e. **quality-equivalent to MobileSAM, not better**.

Critical categories (thin geometry, tiny object, touches-edge, hair/fur) all
clear the 0.5 floor: thin 0.979, tiny 0.876, touches-edge 0.551, hair/fur 0.909
(boundary F 0.665). No critical-category regression versus MobileSAM except
hair/fur boundary F (0.665 vs 0.734).

### Latency and memory

Isolated per-process run at 1280x853 source (one encode + decode after load):

| Provider | cold load | RSS after load | peak RSS | encode+decode |
| --- | --- | --- | --- | --- |
| SAM2 | 1194 ms | 363 MB | 1119 MB | 5280 ms |
| MobileSAM | 1090 ms | 242 MB | 574 MB | 3634 ms |
| EfficientSAM-Ti | 548 ms | 233 MB | 731 MB | 2900 ms |

Harness means (10 corpus fixtures, machine under load) show the encoder cost in
the opposite order (SAM2 ~9.5 s, MobileSAM ~4.2 s, EfficientSAM ~6.6 s), so
latency evidence is **inconclusive**: EfficientSAM has the fastest cold load and
a smaller resident session, but a larger measured peak than MobileSAM. Peak
working set, not file size, is the routing budget and EfficientSAM loses on it.

### Split-vs-combined parity (real photos)

Four photographs, the same prompts as the MobileSAM gate; the split adapter and
the official combined ONNX were fed identical preprocessed tensors:

| Case | candidates | score max abs diff | mask logits max abs diff |
| --- | --- | --- | --- |
| still-life-sunflower | 3 | 0 | 0 |
| portrait-braids | 3 | 0 | 0 |
| elephant-box | 3 | 0 | 0 |
| reflective-glass | 3 | 0 | 0 |

Bit-identical outputs. The adapter's preprocessing, prompt encoding, tensor
plumbing, and decoding match the upstream export exactly for these inputs. The
remaining preprocessing risk (the upstream demo uses a PIL resize while Varve
uses center-aligned bilinear) is documented as a limitation: no PyTorch runtime
was available to run a pixel-level reference against the `.pt` checkpoint.

Visual review of the evidence overlays: the box prompt on the elephant produces
a clean whole-object mask including tusks and tail; the braided portrait selects
face and neck; the sunflower selects the disc under the prompt. With a
background exclusion point on the braids photo the top-ranked candidate becomes
a near-full-frame mask (98.2% coverage) — a candidate-ranking failure, not a
model-capability failure, and the same class of expansive-background pick the
MobileSAM real-photo gate found.

### Candidate-ranking calibration

| Provider | top candidate == oracle-best | mean IoU lost to ranking |
| --- | --- | --- |
| SAM2 | 40% | 0.067 |
| MobileSAM | 20% | 0.043 |
| EfficientSAM-Ti | 40% | 0.053 |

Predicted-IoU ranking is weak for every provider. The worst category is
`touches-edge`, where all three select a much worse candidate:
SAM2 0.552 vs 0.947 available, EfficientSAM 0.551 vs 0.896, MobileSAM 0.549 vs
0.816. `foliage` is similar for EfficientSAM (0.732 vs 0.839). Consequences:

* predicted-IoU must not be presented as semantic confidence or a calibrated
  cross-provider quality score (it already is not);
* user candidate cycling must remain available for all providers;
* EfficientSAM's own score is no more trustworthy than the incumbents', so it
  offers no candidate-selection advantage.

## Promotion gate

* **Outcome A (lower-resource provider)** — fails: peak working set (731 MB) is
  higher than MobileSAM (574 MB), and latency evidence is contradictory.
* **Outcome B (quality competitor)** — fails: quality is inside the equivalence
  band of MobileSAM and below it, not materially above.
* **Outcome C (no meaningful advantage)** — applies: 3 candidates instead of
  MobileSAM's 4, no mask prompts, int64/WASM-only decoder, extra artifacts and a
  third code path, for no measured quality, memory, or latency win.

## Decision

Reject for production routing. Keep `efficientSam.ts` and its gated tests as the
benchmark adapter so the A/B remains reproducible and future lightweight
segmentation candidates can be compared against the same corpus. Reopen only
with (a) a materially better variant (EfficientSAM-S at a similar budget), or
(b) evidence that the int64 decoder and mask-prompt gap are resolved.

## Reproduction

```bash
VARVE_EFFICIENT_SAM_MODEL_DIR=/path/to/efficientsam \
VARVE_EFFICIENT_SAM_COMBINED_MODEL=/path/to/efficientsam_ti.onnx \
  pnpm exec vitest run packages/engine/src/segmentation/quality/efficientSamRealModel.test.ts

VARVE_SAM2_REAL_MODEL_DIR=... VARVE_MOBILE_SAM_MODEL_DIR=... VARVE_EFFICIENT_SAM_MODEL_DIR=... \
  pnpm exec vitest run packages/engine/src/segmentation/quality/providerAb.test.ts
```

## Remaining limitations

* Preprocessing was validated against the ONNX export, not against the `.pt`
  checkpoint through PyTorch (no PyTorch in the evaluation environment).
* Node CPU numbers only; browser WASM/WebGPU numbers for EfficientSAM were not
  collected because the provider is not wired into the browser worker.
* The corpus is synthetic; the real-photo gate checks artifact and lifecycle
  execution plus visual plausibility, not corpus-wide quality.
