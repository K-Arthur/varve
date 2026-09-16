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
| Preprocessing | reference (Node/A-B) identity `grounding-dino-tiny-800-stretch-imagenet-v1`: stretch resize in JS to 800x800, `[0,1]` rescale, ImageNet mean/std, RGB, NCHW. Shipped browser identity `grounding-dino-tiny-800-canvas-bilinear-v2`: the panel draws the source into an 800x800 canvas (browser antialiased filtering) and only normalizes. The two input tensors are **not equivalent**: measured mean absolute difference 0.31 (normalized) on a real 1280x853 photograph, with the browser path 2.2x closer to an independent area-average resize (0.128 vs 0.276). Evidence: `tests/e2e/canvas/discovery-preprocess-parity.spec.ts`, `/tmp`-independent report under `reports/inference-platform/`. Detection parity for the browser identity is **unverified**. |
| Download | explicit, checksum-verified, never triggered by ordinary Object Selection |

## Verified runtime behavior

* **onnxruntime-web 1.27.0 WASM** (the browser runtime, exercised through the
  same wasm binary in Node): session creation 5.7 s, one 800x800 forward pass
  **41.9 s single-threaded**, peak RSS **2.4 GB**. The WASM path accepts the
  int64 feeds.
* **The editor worker is single-threaded by policy, and the policy is now
  measured.** `configureOrtRuntime` pins `ort.env.wasm.numThreads = 1` inside
  workers. The 2026-09-15 probe
  (`tests/e2e/canvas/threaded-wasm-probe.spec.ts`) ran a real shipped graph in
  a cross-origin isolated page (COOP/COEP set by the probe itself,
  `crossOriginIsolated` true, `SharedArrayBuffer` present, 8 logical CPUs, 4 GiB
  of shared `WebAssembly.Memory` reservable): with `numThreads = 1` the session
  was created in 1283 ms and ran at 156.9 ms/run, while with `numThreads = 2`
  **session creation never returned** and the worker had to be terminated after
  120 s. Threaded execution of this graph is therefore unusable on this
  host/browser/architecture, and the cell stays `unverified` in
  `packages/engine/src/inference/platformEvidence.ts` because a different
  runtime build is untested. Cross-origin isolation still raises the admission
  budget (1.2 GB → 3.0 GB on an 8 GB tier); it is not a threading switch.
* **Browser preprocessing is the 800x800 canvas path (v2).** The panel draws
  the source directly into an 800x800 canvas (stretch, high smoothing) and
  normalizes without resampling, so a 24 MP photo copies 2.6 MB instead of
  ~96 MB before inference. The reference processor resizes with antialiasing;
  the previous path sampled the downscaled source with nearest-neighbour. The
  Node harness keeps the v1 nearest path, and the detection cache key includes
  the preprocessing identity so the two are never mixed. Browser parity for
  the v2 path is still **unverified**: the real-detector browser run needs a
  2.4 GB-class allocation that a loaded shared host could not provide
  (see `docs/audits/segmentation-hardening-followup-2026-09-15.md`).
* **Measured stage timings are shown, including the total.** The worker reports
  session creation, preprocessing, inference, and postprocessing wall times;
  the panel adds image preparation (source load + canvas draw), the detector
  release, and the total time-to-first-usable-result. A warm session is
  labeled as such.
* **Detector release before segmentation.** After the detections are
  materialized as plain source-space boxes, the detector session is released
  and the release outcome is surfaced; a failed release stays conservatively
  accounted and the next heavy stage re-reserves it unless the idle worker was
  recycled. Cancelling a run also releases the detector (idle-only: an
  in-flight graph is reported as in use, never force-freed). Identical
  query/source/threshold searches reuse the in-session compact detection cache
  and do not re-run the model. Measured in Node CPU
  (`scripts/bench/handoff-peak-trace.ts`): release returned in 4 ms and process
  RSS fell 139 MB → 124 MB; the strictly sequential handoff peaked at 571 MB
  against 590 MB for the overlapped ordering. That is a Node-CPU measurement of
  the lifecycle ordering, not a browser-WASM claim.
* **A refusal names the constraint.** The WASM admission decision is pure
  (`evaluateWasmAdmission`) and its detail sentence is shown to the user, e.g.
  "Needs about 2.6 GB, more than this session's 1.2 GB budget. The budget is
  raised by cross-origin isolation, which this page does not have." A memory
  denial is a distinct panel state from a timeout or an inference failure.
* **onnxruntime-node 1.27.0 CPU**: real-photo gate (four repository
  photographs) produced phrase-attributed detections — elephant 0.979,
  person 0.906/0.845, sunflower 0.715 top-box — in ~10-16 s per query, peak
  RSS ~3.95 GB. Evidence: `/tmp/varve-grounding-dino-evidence`.
* **WebGPU is unsupported for this graph.** Four of the five inputs are int64;
  ORT-web's WebGPU EP registers int64 kernels only for a small op allowlist (and
  fully only under graph capture). The catalog keeps the graph downloadable and
  the execution path requests WASM; no browser-WebGPU claim is made.

## Budget and gating

* **What "2.6 GB" is.** The catalog declares
  `peakMemoryBytes: 2_600_000_000` — 2.6 × 10⁹ B = **2.42 GiB** — as a
  *budget*: the measured browser-WASM peak (2.4 GB) plus ~200 MB headroom.
  It is not a measured process RSS, not a GiB figure, and not a device
  recommendation. The hard runtime ceiling is separate and was measured: a
  shared `WebAssembly.Memory` maximum of 65536 pages (4 GiB, the wasm32
  address limit) is reservable, so the detector budget consumes about 65 % of
  the address space available to the runtime. Node's ~4 GB process RSS is a
  different domain and is not used as the browser budget.
* The panel's inference reservation uses that catalog peak, so the total
  reservation (model + source frame) stays under the runtime's
  `wasmSafePeakBytes` (3.0 GB on a cross-origin-isolated 8 GB-tier browser)
  while a low-memory session is refused **before** the 194 MiB download is
  spent, with a message that names the binding constraint (missing isolation
  vs device tier) and points back to point/box selection.
* The panel copy states the ~2.6 GB working set and that the feature is
  unavailable on low-memory sessions.
* No background analysis: discovery runs once per explicit query on the
  selected image.

### Observed browser memory behavior (2026-09-15)

* Single-threaded WASM (no cross-origin isolation): the runtime's safe peak is
  1.2 GB on a 16 GB-tier device, below the model's 2.6 GB reservation, so
  discovery is refused in ~18 s with the point/box fallback message. This is
  the intended behavior without `SharedArrayBuffer`.
* Cross-origin isolated (3.0 GB safe peak): the model runs single-threaded and
  returned the expected real-photo detection ("apple" → one 310×382 px box at
  76%) inside the editor. Isolation raised the budget; it did not add threads.
* Under external system memory pressure the threaded headless renderer
  OOM-crashed: a 22 GB machine with only ~2.3 GB available because other
  processes held ~20 GB. The admission gate sizes itself from
  `navigator.deviceMemory`, so it cannot see memory held by other
  applications; this is an inherent browser limitation. The feature must stay
  optional, the copy stays honest, and point/box selection always remains
  available.

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
