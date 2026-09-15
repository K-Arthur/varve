# Text/object discovery system

Status: **shipped experimental** (2026-09-15). Text discovery is an optional
local capability inside Object Selection. It produces reviewable detection
boxes that enter the *same* promptable-provider router as pointer prompts; it
never produces or commits a mask itself. Behavioural invariants live in
`docs/architecture/object-selection-system.md` → "Text-conditioned discovery";
this document carries the artifact, runtime, budget, and evidence detail.

## Pipeline

```text
description ("red backpack", "person. dog.")
  → normalizeGroundingQuery      lowercase, strip control chars/accents,
                                 split on . ; newline, collapse whitespace,
                                 rejoin with ". " and a trailing period
  → bertTokenize + locatePhraseSpans
  → Grounding DINO Tiny INT8 (local ONNX, explicit download)
  → decodeGroundingDinoOutput    box threshold 0.3, text threshold 0.3,
                                 per-phrase duplicate suppression (IoU >= 0.9),
                                 hard cap 64 detections
  → reviewable detection list    phrase, score, box, size, phrase index
  → user selects a detection
  → shared prompted router       routePromptedSelection('auto', box prompt)
  → SAM2 / explicit alternative
  → candidate review             the ordinary commit gate
  → selection / mask / refinement
```

The detector is a **discovery** stage. It does not segment, does not accept its
own top-ranked box, and does not bypass candidate review. Reviewed boxes flow
through `applySam2Segmentation`, which runs the normal capability → runtime →
hard-budget → validated-quality routing, so text discovery automatically
follows provider changes instead of hardcoding a segmenter.

## Artifact

| Item | Value |
| --- | --- |
| Model id | `grounding-dino-tiny` |
| Revision | `onnx-community/grounding-dino-tiny-ONNX@ff690b0a8050566c290287545bd059350f3e9096` |
| Upstream | `IDEA-Research/grounding-dino-tiny` (Apache-2.0); tokenizer vocab pinned at the same revision |
| Graph | `model_int8.onnx`, 203,824,481 B, SHA-256 `3bff430de583461ab3c1e8b99b19508f4fb238bf0fea0cde2c45f840a0082a26` |
| Vocab | `vocab.txt`, 231,508 B, SHA-256 `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` |
| Inputs | `pixel_values` f32 [1,3,800,800]; `input_ids`, `token_type_ids`, `attention_mask` i64 [1,256]; `pixel_mask` i64 [1,800,800] |
| Outputs | `logits` f32 [1,900,256]; `pred_boxes` f32 [1,900,4] (normalized center/size) |
| Preprocessing | stretch resize to 800x800, `[0,1]` rescale, ImageNet mean/std, RGB, NCHW |
| Download | explicit, checksum-verified, never triggered by ordinary Object Selection |

## Verified runtime behavior

* **onnxruntime-web 1.27.0 WASM** (the browser runtime, exercised through the
  same wasm binary in Node): session creation 5.7 s, one 800x800 forward pass
  **41.9 s single-threaded**, peak RSS **2.4 GB**. The WASM path accepts the
  int64 feeds.
* **onnxruntime-node 1.27.0 CPU**: real-photo gate (four repository
  photographs) produced phrase-attributed detections — elephant 0.979,
  person 0.906/0.845, sunflower 0.715 top-box — in ~10-16 s per query, peak
  RSS ~3.95 GB. Evidence: `/tmp/varve-grounding-dino-evidence`.
* **WebGPU is unverified.** Four of the five inputs are int64; ORT-web's
  WebGPU EP registers int64 kernels only for a small op allowlist (and fully
  only under graph capture). The catalog keeps the graph downloadable and the
  execution path requests WASM; no browser-WebGPU claim is made.

## Budget and gating

* The catalog declares `peakMemoryBytes: 3_200_000_000` from the measured runs.
* The panel's inference reservation uses that catalog peak, so a low-memory
  session is refused **before** the 194 MiB download is spent, with a message
  pointing back to point/box selection.
* The panel copy states the measured ~3 GB working set and that the feature is
  unavailable on low-memory sessions.
* No background analysis: discovery runs once per explicit query on the
  selected image.

## Scores are not one number

| Score | Provenance | Meaning |
| --- | --- | --- |
| detection score | sigmoid of the query's max text-token logit | detector similarity, not certainty that the object exists |
| phrase label | matched token span decoded back to text | which part of the query matched |
| candidate confidence | provider-specific predicted IoU | mask ranking estimate, not intent |

The UI labels the detection score as a model score. The measured absent-object
control (a "dog" query on the elephant photograph returned a 0.708 box) is why
the panel says a confident box can appear even when the object is absent;
the user verifies the highlighted region before segmenting.

## Deliberate limitations

* Overlapping/nested boxes are kept (same-phrase IoU ≥ 0.9 only) because two
  people standing together are two real objects; the review list is capped at
  64 and ranked by score.
* Query language support is BERT-uncased WordPiece; CJK text is tokenized
  per code point but detector quality for non-English phrases is unmeasured.
* No OCR: this does not read printed text.
* Latency is tens of seconds on WASM; it is not an interactive-speed feature.
* Detections are transient UI state; they are never serialized into the
  document, and the committed selection/mask remains ordinary document data.

## Non-goals

* No cloud inference, no hidden upload, no automatic download.
* No detector→mask shortcut, no silent top-1 acceptance.
* No document dependency on the detector: a saved mask reopens without it.

## Evidence map

* Contract/tokenizer/decoding tests: `packages/engine/src/discovery/groundingDino.test.ts`
* Real-photo gate: `packages/engine/src/discovery/groundingDinoRealModel.test.ts`
* Feasibility research and the artifact/reproducibility gate:
  `docs/research/text-object-discovery-feasibility-2026-09-14.md`
* Cross-product complaint research: `docs/research/object-selection-user-complaints-2026-09-15.md`
* Provider routing after detection: `docs/quality/object-selection-parity.md`
