# Object Selection parity and quality methodology

This document defines how Varve measures Object Selection quality and how a
replacement segmentation runtime is accepted. It exists so that "the model
looks fine on one screenshot" is never the acceptance bar.

External product/model research and the observed Varve behaviour that
motivated the 2026-09-13 smart-selection repairs are recorded in
`docs/quality/smart-selection-research-2026-09-13.md`.

## Corpus

`SEGMENTATION_CORPUS` in
`packages/engine/src/segmentation/quality/corpus.ts` is license-safe by
construction: every fixture is generated from code, so the corpus lives in
the repository and can run in CI. Fixtures:

| id | category | what it exercises |
| --- | --- | --- |
| `circle-plain` | plain-background | product-on-plain analog; one prompt |
| `fuzzy-edge` | hair-fur | stochastic boundary; point + box prompt |
| `thin-geometry` | thin-geometry | ring + 1px spokes (bicycle/typography) |
| `overlapping` | overlapping | two overlapping objects; prompt must disambiguate |
| `tiny-object` | tiny-object | 12px subject in a 128px frame |
| `touches-edge` | touches-edge | subject clipped by image edges |
| `low-contrast` | low-contrast | 8-gray-level separation, color is useless |
| `soft-alpha` | glass-translucency | feathered alpha ramp; oracle = opaque core |
| `multiple-similar` | multiple-similar | three identical circles; oracle = prompted one |
| `foliage-like` | foliage | many small regions forming one subject |

Every fixture records source-pixel prompt coordinates and a binary oracle
mask. The oracle is the metric target, not a claim that a promptable model
must reproduce it exactly — real photography is harder than synthetic
fixtures, and the release tolerances below account for that.

## Metrics

`packages/engine/src/segmentation/quality/metrics.ts`:

- **IoU** — intersection over union on binary masks (both-empty = 1).
- **Dice / F1** — pixel-level Dice.
- **Boundary F-score** — contour precision/recall with a 1px Chebyshev
  tolerance, so a one-pixel contour shift scores high on boundary quality
  while IoU captures the area penalty separately.
- **Click-efficiency** — recorded per interaction pattern (1 positive click,
  positive+negative, box, multi-click refinement) as the number of prompts
  needed to reach the target IoU; reported as an observation, not a score.

`evaluateCorpus` is the backend seam: it accepts any `predict(image,
prompts) => mask` function. The mock backend in the unit tests returns the
oracle (perfect score) and an empty mask (zero score) to prove the harness;
the real backend plugs in through the worker-backed SAM2 adapter.

## Release gate (real-model run)

Before a release can claim Object Selection quality, run the corpus against
the pinned SAM2-Hiera-Tiny model on a machine with the model installed:

1. Install the model (Settings → Offline Models → Object Selection), or point
   the runner at a repaired encoder + decoder directory. The pinned artifact
   is the *repaired* encoder (see "Graph repair" below).
2. Run the corpus runner:
   `VARVE_SAM2_REAL_MODEL_DIR=<dir> VARVE_SAM2_RESULTS_PATH=results.json pnpm exec vitest run packages/engine/src/segmentation/quality/realModelParity.test.ts`
   It writes `results.json` with per-fixture IoU/Dice/boundary F, the default
   candidate, the best-of-cycling candidate, and prompt latency.
3. Render the table:
   `node scripts/bench/object-selection-parity-report.mjs --input results.json`
4. Run the real-model integration spec
   `tests/e2e/canvas/object-selection-real-model.spec.ts` with
   `VARVE_SAM2_REAL_MODEL=1` against a COOP/COEP server (or a browser
   reporting `navigator.deviceMemory`) — it drives the real tool end to end
   (cold preview latency, candidate cycling, Apply, undo/redo, warm-cache
   prompt latency, and reviewed-candidate Use as selection).
   Set `VARVE_SAM2_BASE_URL` when the server runs on a non-default port.

## First real-model run (2026-08-14)

Environment: CachyOS, 22 GB RAM, headless Chromium (new headless), ort-web
1.27.0, wasm execution provider only (no GPU provider available), the app
served with COOP/COEP (crossOriginIsolated).

| path | measured |
| --- | --- |
| Cold: model load + encode + first prompt (cat fixture) | 13 s to preview |
| Warm prompt (embedding cache hit, same image) | 1 s |
| Encoder alone (ort-node, 1024x1024) | 4.2 s |
| Candidate masks per prompt | 3 |
| Reported confidence | 94% (76% on repeat prompt) |

The full interactive loop is verified: preview overlay renders, candidate
cycling wraps, Apply commits one undoable document mask (provenance row with
confidence), Undo removes it, Redo restores it.

## Frontend installation and real-model integration run (2026-09-03)
Environment: CachyOS, 22 GiB RAM, headless Chromium, ort-web 1.27.0, WASM
execution provider, COOP/COEP server (`crossOriginIsolated`). A clean
persistent Chromium profile exercised the Settings → Offline Models install
route. The editor-facing loader fetched the upstream SAM2 encoder, verified
its upstream SHA-256, removed the two metadata-only empty `value_info` entries,
verified the repaired SHA-256, and stored the repaired encoder plus decoder in
the shared IndexedDB model store.

The final gate used the portrait fixture rather than the legacy `cat.jpg` path:
the checked-in bytes at that path are a coastal landscape, so a centre-point
prompt selects sky/sea and is not a meaningful object-selection test. The gate
also cycles all candidates back to the initial candidate before applying, so a
lower-confidence alternate mask is not mistaken for a model failure.

| path | measured |
| --- | --- |
| Cold: install-backed model load + encode + first prompt | 22 s to preview |
| Warm prompt (embedding cache hit, same image) | 2 s |
| Candidate masks per prompt | 3 |
| Initial candidate confidence | 88% |
| Applied candidate confidence | 88% |

`tests/e2e/canvas/object-selection-real-model.spec.ts` passed with the real
model and verified candidate wrapping, visible applied provenance, undo/redo,
and warm-cache inference. The persistent canvas screenshots were inspected:
the preview covers the prompted person and the applied frame shows the person
cut out against the editor background. This validates the frontend install and
integration path; the corpus-wide quality table remains a release gate.

## Real-model integration run (2026-09-14)

Environment: CachyOS, 22 GiB RAM, Chromium (Playwright persistent profile),
`vite` dev server with COOP/COEP (`VARVE_CROSS_ORIGIN_ISOLATION=1`) and HMR
disabled, ort-web WASM execution provider. A fresh profile exercised the real
installer: the Inspector's "Install Object Selection model" downloaded both
artifacts (~155 MB), verified the upstream encoder SHA-256, applied the
documented graph repair, verified the repaired SHA-256, and reported the model
ready with no manual file placement.

| path | measured |
| --- | --- |
| Install (download 155 MB + verify + repair + store) | completed in-run; no manual model copy |
| Cold preview (load from store + encode + decoder + first candidate) | 27 s |
| Candidate masks per prompt | 3, cycling wrapped |
| Apply as mask provenance | Predicted IoU score 0.88; prompt match 100% |
| Undo / redo | removes and restores one mask operation |
| Warm preview (embedding cache hit) | 3 s |
| Use as selection (reviewed candidate, no re-encode) | 1 s; area selection saveable |

Screenshots inspected: the preview overlay covers the prompted person; the
applied mask cuts the person out of the wall (hair and crossed arms kept);
the selection output traces the same silhouette. The decoder removes the
model-square padding recorded by the encoder before restoring the source-sized
mask. On the 320x483 portrait, the uncorrected decoded silhouette occupied
approximately x=84..253; the corrected mask occupied x=46..300 and matched the
inspected source silhouette. The regression is covered by
`packages/engine/src/inference/models/sam2.test.ts`. The downloader, the
reviewed-candidate commit path, and the persistence path were exercised in one
pass. Candidates that fail explicit point or box constraints are now removed
from the review list, and a stale or legacy rejected candidate cannot be
applied.

A follow-up run used the same photograph with an off-centre torso point rather
than the earlier centre prompt. It completed in 23 s cold and 1 s warm,
reported predicted IoU 0.91, prompt match 100%, and three eligible candidates.
The inspected preview, applied mask, and selection boundary followed the full
person, including hair, arms, shirt, and the lower boundary. This also records
the intended interaction distinction: a point on the head can validly select
the head region, while a whole-person target should use a torso point, a box,
or additional include/exclude prompts.

## Corpus quality run (2026-09-14)

Command:

```sh
VARVE_SAM2_REAL_MODEL_DIR=<dir with repaired encoder + decoder> \
VARVE_SAM2_RESULTS_PATH=/tmp/opencode/sam2-corpus-results.json \
pnpm exec vitest run packages/engine/src/segmentation/quality/realModelParity.test.ts
```

The runner mirrors the worker preprocessing (RGB, scale-to-fit 1024, centered
black padding, ImageNet normalization; pure-JS sampling instead of
OffscreenCanvas) and reuses the production `encodeSam2Prompts` /
`decodeSam2DecoderOutput`, so prompt mapping and mask postprocessing are the
app's. `IoU (default)` is the highest predicted-IoU candidate; `best
candidate` is the best of the three masks (what cycling can reach). CPU
execution provider, ort-node 1.27.0, ~5.0-5.8 s per prompt, cold session
0.9 s.

| fixture | IoU (default) | best candidate | boundary F |
| --- | --- | --- | --- |
| circle-plain | 0.994 | 0.994 | 1.000 |
| fuzzy-edge | 0.910 | 0.922 | 0.677 |
| thin-geometry | 0.993 | 0.993 | 1.000 |
| overlapping | 0.621 | 0.703 | 0.599 |
| tiny-object | 0.871 | 0.871 | 1.000 |
| touches-edge | 0.552 | **0.947** | 0.693 |
| low-contrast | 0.986 | 0.986 | 1.000 |
| soft-alpha | 0.222 | 0.253 | 0.000 |
| multiple-similar | 0.389 | 0.526 | 0.354 |
| foliage-like | 0.000 | 0.008 | 0.215 |
| **mean** | **0.654** | **0.720** | **0.654** |

Interpretation, recorded as measured fact rather than a passing claim:

The table was rerun on 2026-09-14 after correcting the tolerance matcher to
deduplicate ground-truth boundary pixels. The previous scorer could report an
impossible boundary F-score above 1 when several predicted pixels matched the
same target boundary; the corrected score is bounded to `[0, 1]` and the
quality decision remains unchanged.

- Preprocessing and prompt mapping are validated by the plain, thin, tiny,
  low-contrast, and fuzzy fixtures (all ≥ 0.87 IoU) plus the real-photo run
  above.
- **Candidate cycling is not cosmetic.** `touches-edge` reaches 0.947 IoU on
  a non-default candidate (default 0.552); `multiple-similar` reaches 0.526.
  The UI exposes Previous/Next with a candidate count, and the reviewed
  candidate is what commits.
- `soft-alpha` is the documented matting-vs-segmentation difference (oracle
  is the opaque core); it is not marketed as an alpha matte.
- `foliage-like` with a single point prompt in a gap selects essentially
  nothing; a box or multiple points is the correct interaction. This is a
  fixture prompt-design limitation, not a pipeline failure.
- The provisional tolerances above predate this run and are deliberately
  **not** relaxed here: the flat mean is recorded below the provisional 0.80,
  and the four weak categories are proposed as documented review categories
  for the maintainer. No quality threshold in this document was changed to
  make this run pass.

Model-backed foreground candidates keep separate channels for selection and
masking: binary hard coverage is used for pixel selections, while the
provider's soft alpha is retained for mask output and the review overlay. A
near-whole-frame result (at least 99.5% hard coverage) is rejected as an
ambiguous foreground failure instead of being allowed to turn a later edit
into a full-photograph operation.

## Automatic foreground proposals (2026-09-14)

`Select subject` moved from a model-free-only estimate to an explicitly
routed automatic-foreground capability. The models are the ones Varve already
ships; the routing policy and the artifact research are recorded in
`docs/quality/subject-selection-provider-research-2026-09-14.md` and the plan
`docs/plans/subject-selection-providers-2026-09-14.md`.

| Level | Provider | Download | Runtime gate |
| --- | --- | --- | --- |
| Fast (default) | `u2netp` (MIT, 4.7 MB, bundled) | none | Browser/WASM or native; catalog working set 330 MB |
| Balanced | `isnet-general-use` when installed, else Fast | optional 179 MB | Native preferred; browser/WASM needs the catalog 1.3 GB peak to fit the safe budget |
| High quality | `birefnet-general-lite` when installed and admissible, then Balanced | optional 224 MB | Native preferred; bare-WASM runs are rejected unless the multiple-GB working set fits |
| Portrait | `modnet-portrait` (Apache-2.0, 26 MB) | optional 26 MB | Browser/WASM worker only; photographic people; no general-model or heuristic step-down |
| No model | model-free `foregroundSelect` estimator | none | Always available; the panel labels it |

Routing is capability- and measurement-based. The decision function records,
for every request, the ordered attempts, the reason each was chosen, and every
rejected alternative; execution reports the model that actually produced the
candidates plus any step-down. An explicit model request (`modelId` on the
removal options) is honored by every provider or fails loudly — the native
provider declines when the requested model is not its own, and the
quality-to-balanced automatic fallback is skipped for explicit requests.

**Admission fix.** The `removeBackground` browser preflight previously assessed
every AI method with the bundled `u2netp` peak (330 MB). An installed IS-Net or
BiRefNet run could therefore pass the gate and later exceed the wasm32 ceiling.
The preflight now resolves the model the request will actually run (bounded to
a 5 s probe so a blocked model store cannot hang it) and assesses that model's
catalog working set. The `u2netp-int8` variant is also mapped to its real
320 px u2netp-family spec instead of the 1024 BiRefNet fall-through.

**Real-photo review.** `tests/e2e/canvas/subject-proposal.spec.ts` runs the
shipped Fast level and the explicit Portrait level on licensed photographic
fixtures (still life, portrait with hair, interior) through the real worker
path and exports the preview, applied-selection, and applied-mask screenshots
plus candidate coverage labels for inspection. The Portrait lane also
serializes and decodes the persisted source-sized mask: on
`real-life-katharine-hepburn.jpg` the person interior is covered and a clear
upper-background window remains at zero. Each candidate is overlaid before an
explicit "I reviewed the highlighted subject before applying" confirmation;
changing a candidate clears that confirmation. A separate 2026-09-15 review
found that MODNet retains the dark oval background in
`real-life-braided-portrait.jpg`, so that output is recorded as a rejected
one-person selection in
`docs/audits/subject-selection-portrait-model-2026-09-15.md`. Portrait
matting remains a reviewed matte capability, not semantic target proof.

## Model acquisition and hosting (2026-09-14)

- `sam2_hiera_tiny.encoder.onnx` (134,261,315 B, upstream SHA-256
  `4cc015ee18520e93f8c7ddfeaca7436039daaaaf19721b4b96a8810a805e82f7`)
  downloads from the Apache-2.0 export
  `vietanhdev/segment-anything-2-onnx-models`; the repair produces
  134,261,247 B at
  `b4cfd6c8bec2ef3674536419d731e61d15840367bd004d65095ae6a2b88b41cf`.
  Both checksums are pinned in the manifest.
- `sam2_hiera_tiny.decoder.onnx` (20,640,886 B,
  `f5a4bd656c143899fb7f52d64ed81e6f6aeb37d477a0b6da50146ac7cf2187bf`).
- A verified archival mirror is published on the repository's
  `varve-models-v2` GitHub release with the same upstream bytes and
  checksums, for manual or CI use:
  `gh release download varve-models-v2` then `sha256sum -c`.
- GitHub release assets do **not** send `Access-Control-Allow-Origin`
  (verified with ranged GET + `Origin`: neither the `302` nor the final `206`
  carries it), so a browser `fetch()` cannot download them. The in-app
  downloader therefore keeps using the CORS-enabled upstream host recorded in
  the manifest; a local-first client without a server proxy cannot consume
  GitHub release assets directly.

## Graph repair

## Cache and constrained-device follow-up (2026-09-14)

The encoder embedding cache is now bounded relative to the runtime's reported
safe working budget rather than using one 512 MB allowance on every device. The
allowance is capped at 512 MB, has a 16 MB floor for runtimes with a valid
budget, and defaults to 128 MB when no usable budget is reported. This is only
a cache policy; the source-plus-model resource preflight remains the admission
gate, and a coarse browser memory hint is not treated as proof that the model
fits.

Cache keys include the source pixel fingerprint, the preprocessing revision,
and the verified encoder and decoder artifact checksums from the model catalog.
That prevents a model replacement behind a stable locator from reusing old
embeddings. A transform change must still bump the preprocessing revision, and
the cache never persists embeddings into the document.

The upstream `sam2_hiera_tiny.encoder.onnx` declares empty shapes
(`{}`) for the `/conv_s0` and `/conv_s1` output value_info entries.
onnxruntime-node tolerates this with a lenient merge, but ort-web's wasm
shape inference rejects the graph at session creation
(`[ShapeInferenceError] ... inferred=4 declared=0`), so Object Selection
was blocked in every browser build. `scripts/models/repair-sam2-graph.mjs`
removes the two metadata-only entries; the repaired graph produces
bit-identical encoder outputs (verified against the upstream graph with
ort-node, matching to the last digit). Both the tiny and small encoders
have the defect; repaired checksums are pinned in the manifest/catalog.

Acceptance tolerances (provisional until the first real-model run pins
numbers; the table below is the measurement record, not a claim):

| metric | provisional gate |
| --- | --- |
| IoU mean across corpus | ≥ 0.80 |
| Boundary F mean | ≥ 0.85 |
| Per-fixture IoU floor (any single case) | ≥ 0.5, or a documented and accepted failure category |
| Prompt p95 on a mid-range machine | ≤ 1500 ms after warm image encode |
| Encode (one per image) | ≤ 8 s on CPU-only, ≤ 3 s on GPU |

Category-specific expectations: `soft-alpha` (glass) and `fuzzy-edge` (fur)
are expected to land below the flat mean — matting-quality alpha is a
separate pipeline and the mask must not be marketed as an alpha matte.

## Runtime-replacement gate

A replacement backend (Candle, an official export, a newer model) must run
the identical corpus, prompts, and coordinates and report:

- cold load, image encode p50/p95, subsequent prompt p50/p95;
- peak RAM/VRAM, execution provider, binary and model size;
- mask IoU / Dice / boundary F against the same oracles.

It is not accepted if it regresses quality below the tolerances or makes the
CPU-only path unusable. See ADR-0220.

## Known failure categories to test by hand

Hair, fur, feathers, branches, spokes, fences, cables, thin type, glass,
translucent fabric, shadows, smoke, reflections, holes, overlapping
subjects, similar fg/bg colors, tiny objects, occlusion, soft focus, motion
blur, very low contrast. The synthetic corpus covers the structure of these
cases; the release visual review covers their photographic reality.

## MobileSAM A/B and real-photo gate (2026-09-14)

The MobileSAM comparison uses the same production prompt encoder/decoder
adapter, source-coordinate prompts, candidate filtering, and corpus oracles as
the SAM2 run. It is not a comparison of model-file size alone.

| provider | mean IoU | mean boundary F | worst critical IoU | warm prompt p50/p95 proxy | decision |
| --- | ---: | ---: | ---: | ---: | --- |
| SAM2 Hiera Tiny | 0.6538 | 0.6535 | 0.5516 | 496 / 1068 ms | validated Auto provider |
| MobileSAM split | 0.7474 | 0.7141 | 0.5494 | 326 / 485 ms | explicit experimental provider |

The corpus result is useful evidence, not a release claim: both providers
remain below the provisional aggregate gates above, and MobileSAM's stronger
mean did not clear the real-photo intent gate. The raw `iou_predictions` value
is retained as a predicted-IoU ranking score; it is not a probability that the
mask matches the user's intended object.

The real browser gate used the pinned Acly split artifacts (encoder SHA-256
`580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749`, multi-mask
decoder SHA-256
`8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe`) through
the actual Chromium/ort-web WASM worker on the public-domain
`real-life-elephant.jpg` photograph. It selected an interior elephant point,
added a negative grass point, reviewed all four candidates, returned to the
reviewed candidate, applied the mask, and verified the mask-output workflow.
The run passed:

```text
VARVE_E2E_PORT=1474 VARVE_MOBILE_SAM_REAL_MODEL=1 \
VARVE_MOBILE_SAM_PROFILE_DIR=/tmp/varve-mobile-sam-profile-20260914 \
VARVE_MOBILE_SAM_BASE_URL=http://localhost:1474 \
pnpm exec playwright test \
  tests/e2e/canvas/object-selection-mobile-real-model.spec.ts \
  --project=chromium --workers=1 --reporter=line \
  --output=/tmp/varve-mobile-real-run-20260914b
```

The inspected captures were `mobile-elephant-click-preview.png`,
`mobile-elephant-negative-correction.png`, and
`mobile-elephant-applied-mask.png` in that output directory. The first
interior click produced a clean elephant overlay; the negative grass prompt
kept the full elephant and removed the competing ground interpretation; the
applied mask preserved the body, head, trunk, and legs with a review-worthy
grass/edge ambiguity. A separate boundary-click probe on the same photograph
returned a high-scoring expansive ground patch. That failure is why MobileSAM
is explicit-only today, despite passing the artifact, contract, and browser
lifecycle gates.

The real-photo run is visual evidence rather than a hidden benchmark: no image
pixels, screenshots, or filenames are sent to telemetry. The captures are
local temporary evidence and are not part of the document or model cache.

A repeat of the MobileSAM scenario on 2026-09-15 was refused before model
allocation because the active browser/native working-set budget was about
1.1 GiB and the conservative MobileSAM estimate was also about 1.1 GiB. The
failure was classified as an expected `insufficient-memory` capacity result,
not as a successful model-quality run; the E2E lane now skips only for that
explicit reason and still fails on model, graph, decode, or mask errors. The
low-memory real-photo fallback remains covered by
`tests/e2e/canvas/object-selection.spec.ts`, which asserts the actionable
preflight message without pretending that a model ran.

## Routing decision after the gate

| user intent | validated default | explicit alternative | unavailable/failure behaviour |
| --- | --- | --- | --- |
| Automatic subject estimate | bundled U²-Net Fast proposal, or the requested installed higher-quality foreground model | IS-Net / BiRefNet through the existing explicit quality controls | explain the model-free estimate or install offer; never call it semantic recognition |
| Portrait subject matte | explicit MODNet Portrait proposal for suitable photographic people, with persisted-mask pixel evidence | manual refinement or prompted Object Selection for one specific target; the framed braided portrait is a known rejection | missing/failed MODNet is fail-closed; never substitute a generic foreground model |
| Prompted point/box object selection | SAM2 Hiera Tiny when installed, WASM-compatible, and within the measured working-set budget | MobileSAM split ONNX, only after the user chooses Faster local model | explain the exact provider failure; never silently substitute a foreground estimate |
| Soft edge / hair refinement | existing brush, trimap, and closed-form matting tools | BiRefNet only in its explicit high-quality cutout/refinement role | preserve binary-safe/manual refinement; do not call a hard mask an alpha matte |
| Text discovery | Grounding DINO Tiny (INT8) explicit local download, phrase-attributed boxes, automatic routing never downloads | image-backed reviewed box → same prompted segmenter candidate path | detection never commits a mask; the selected box must be explicitly confirmed against the source image; scores are model similarity, not proof of presence; no match is an honest empty state |

## EfficientSAM-Ti challenger (explicit-only production route, 2026-09-15)

EfficientSAM-Ti was evaluated through the same corpus and the same production
encode/decode functions, plus a split-vs-combined ONNX parity gate on real
photos. It produced identical predictions to the official combined export
(bit-identical mask and IoU logits) and cleared every critical-category floor,
but it is quality-equivalent to MobileSAM (mean IoU 0.723 vs 0.747, inside the
0.03 equivalence band), has a larger measured peak working set (731 MB vs
574 MB), has no mask-prompt capability, and its decoder requires an int64
`orig_im_size` that the WebGPU execution provider cannot host. It was
therefore rejected for automatic routing and remains **explicit-only**: the
routing fact carries `experimental: true` and Auto never selects it.

On 2026-09-15 the verified adapter became reachable from the ordinary editor
workflow as the explicit "Experimental — EfficientSAM-Ti" model preference.
The graphs are registered in the generic inference worker
(`efficient-sam-encoder` / `efficient-sam-decoder`), embeddings are cached by
artifact checksum and provider, and prompt feeds respect the decoder's int64
`orig_im_size`. A production-dispatch unit test
(`packages/editor/src/context/promptedSegmentationProvider.test.ts`) asserts
the graph names, the pre-packed 1024-longest-edge `batched_images` tensor, the
three source-sized candidates, and that no mask input is sent. Full evidence:
`docs/audits/efficient-sam-ti-ab-evaluation-2026-09-14.md` and
`docs/audits/selection-ai-routing-real-world-2026-09-15.md`.

Text discovery is now implemented rather than deferred: Grounding DINO Tiny
runs locally, returns phrase-attributed reviewed boxes, and feeds the same
prompted-segmentation candidate path. The panel renders the selected box over
the source image and requires explicit confirmation before segmentation; changing
the detection clears that confirmation. Its artifact, tokenizer parity, and the
measured absent-object false-positive control are recorded in
`docs/audits/selection-ai-routing-real-world-2026-09-15.md`.

## Chromium real-model E2E evidence (2026-09-15)

`tests/e2e/canvas/object-selection-real-model.spec.ts` was run end to end
against the committed pipeline with `VARVE_SAM2_REAL_MODEL=1` on headless
Chromium (`--project=chromium`, fresh persistent profile, isolated dev-server
port), serving the pinned repaired encoder and decoder from `/models/`:

| Case | Prompt | Cold preview | Warm preview | Use as selection | Result |
| --- | --- | --- | --- | --- | --- |
| `tests/fixtures/bg-removal-corpus/human.jpg` (320×483 portrait) | torso point | 31 s · predicted IoU 0.91 · prompt match 100% · 3 candidates | 6 s (cached embedding) | 1 s, no re-inference | Apply → provenance shown → undo/redo; mask keeps hair, crossed arms, and watch |
| `tests/e2e/fixtures/real-life-still-life.jpg` (1280×960) | point on the right-hand apple | passed (same 3-candidate flow) | — | — | Apple isolated with its stem; flowers and background removed |

Candidate cycling wraps and invalidates review; the applied mask records
`predicted IoU score 0.91` and `Use as selection` commits the reviewed
candidate in one second with no further inference. Screenshots are attached
to each Playwright run under `test-results/`. These are single-machine Linux
x86_64 browser WASM numbers: the 31 s cold path is dominated by the first
session compile and encoder run and is not a cross-platform guarantee.
