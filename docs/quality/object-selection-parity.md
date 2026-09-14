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
| Apply as mask provenance | Mask score 88% |
| Undo / redo | removes and restores one mask operation |
| Warm preview (embedding cache hit) | 3 s |
| Use as selection (reviewed candidate, no re-encode) | 1 s; area selection saveable |

Screenshots inspected: the preview overlay covers the prompted person; the
applied mask cuts the person out of the wall (hair and crossed arms kept);
the selection output traces the same silhouette. The downloader, the
reviewed-candidate commit path, and the persistence path were exercised in
one pass.

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
| fuzzy-edge | 0.910 | 0.922 | 0.705 |
| thin-geometry | 0.993 | 0.993 | 0.984 |
| overlapping | 0.621 | 0.703 | 0.599 |
| tiny-object | 0.871 | 0.871 | 1.020 |
| touches-edge | 0.552 | **0.947** | 0.695 |
| low-contrast | 0.986 | 0.986 | 1.000 |
| soft-alpha | 0.222 | 0.253 | 0.000 |
| multiple-similar | 0.389 | 0.526 | 0.354 |
| foliage-like | 0.000 | 0.008 | 0.204 |
| **mean** | **0.654** | **0.720** | **0.656** |

Interpretation, recorded as measured fact rather than a passing claim:

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
