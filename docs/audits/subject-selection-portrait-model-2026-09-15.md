# Portrait subject-selection model review — 2026-09-15

## Outcome

The pinned `modnet-portrait` model is wired and runs locally, but it is not a
semantic single-person selector. It is acceptable for a reviewed portrait
matte on the ordinary portrait fixture below; it is rejected as evidence for
selecting one intended person in the framed braided-portrait fixture. The
latter causes MODNet to retain the dark oval portrait background as foreground.

The product consequence is deliberate:

- `Portrait (MODNet)` remains an explicit, reviewed portrait-matte option.
- `Select specific object` remains the required route for one person or one
  object. It uses prompted Object Selection with include/exclude points or a
  box and a second review gate before a generative procedure can consume it.
- MODNet is never a fallback for generic foreground selection, and a portrait
  request never silently steps down to U²-Net or the heuristic.
- The framed braided portrait is not used as a marketing before/after or as a
  portrait-model quality pass.

## Real-model command

The native contract harness ran the exact pinned ONNX graph and preprocessing
against the real photographic corpus:

```text
VARVE_MODNET_MODEL="$PWD/apps/desktop/public/models/modnet-portrait/model.onnx" \
VARVE_MODNET_EVIDENCE_DIR=/tmp/varve-modnet-real-evidence-20260915 \
VARVE_MODNET_RESULTS_PATH=/tmp/varve-modnet-results-20260915.json \
pnpm exec vitest run packages/engine/src/backgroundRemoval/modnetPortraitRealModel.test.ts
```

Result: **1 passed**. CPU inference completed for four portrait photographs
and two out-of-domain controls. The numeric gate confirmed finite alpha,
source/output geometry, fractional edge coverage, and the reviewed constraint
fusion. Numeric alpha coverage is not treated as semantic target accuracy.

Selected measurements:

| Fixture | Source | Model input | Hard coverage | Fractional pixels | Visual result |
| --- | ---: | ---: | ---: | ---: | --- |
| `real-life-katharine-hepburn.jpg` | 1280 × 1696 | 512 × 672 | 73.77% | 7.33% | Accepted reviewed portrait matte |
| `real-life-braided-portrait.jpg` | 1920 × 2383 | 512 × 608 | 33.89% | 2.31% | **Rejected for person selection**: dark oval background retained |
| `real-life-bearded-man.jpg` | 1280 × 1600 | 512 × 640 | 75.34% | 7.96% | Reviewed matte evidence |
| `real-life-portrait.jpg` | 5171 × 6402 | 512 × 608 | 7.41% | 0.73% | Reviewed matte evidence |

The temporary alpha and composite artifacts are retained at
`/tmp/varve-modnet-real-evidence-20260915/` during validation. They are not
portable document assets and are not committed.

## Browser workflow and pixel evidence

The production Chromium workflow used the licensed
`real-life-katharine-hepburn.jpg` fixture, selected `Portrait (MODNet)`,
reviewed the highlighted candidate, applied it as a source-bound raster mask,
and captured both the overlay and the applied image:

```text
VARVE_VISUAL_HARNESS_ONLY=1 VARVE_E2E_PORT=18450 VARVE_E2E_WORKERS=1 \
VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=run-subject-portrait-modnet-18450 \
pnpm exec playwright test tests/e2e/canvas/subject-proposal.spec.ts \
  --project=chromium --workers=1 --grep "portrait specialist" --reporter=list
```

Result: **1 passed in 49.9 seconds**. The test does not accept a screenshot
alone. It serializes the applied document, decodes the persisted PNG mask, and
asserts:

| Check | Observed |
| --- | ---: |
| Mask dimensions | 1280 × 1696 |
| Hard mask pixels | 1,601,157 |
| Connected hard components | 142 (hair-edge fragments are retained for review) |
| Person interior hard pixels | 236,181 |
| Clear upper-background hard pixels | 0 |

The applied capture was inspected at the editor canvas scale. The browser
commit now warms the bounded mask render cache before announcing success, so
the capture is not an earlier unmasked frame. The full-resolution PNG remains
the authoritative persisted mask.

## Selection contract

A model score or area percentage cannot establish what the user intended. The
selection workflow therefore has explicit contracts at each boundary:

1. The source image, dimensions, decoded-pixel fingerprint, and image-placement
   mapping are captured before inference.
2. Automatic proposals are review-only. Candidate selection does not mutate the
   document; the user must inspect the overlay and confirm the exact candidate.
3. Binary selection pixels and soft matte pixels are separate channels. A soft
   hair edge cannot silently become a hard generative edit region.
4. Applying a candidate rechecks source identity, placement, candidate bytes,
   and review key. A changed image or candidate invalidates approval.
5. For a specific object, prompted Object Selection requires positive target
   evidence, optional negative/background evidence, candidate validation, and
   review again in the Generative Edit context before generation.
6. The final mask is source-sized and persisted with provenance; model absence
   affects regeneration only and never removes an accepted mask.

The real still-life Object Selection gate is the semantic-target evidence for
this contract: its reviewed apple mask contains the apple interior and zero
mug/flower pixels. That evidence is recorded in
`docs/audits/object-selection-target-accuracy-2026-09-15.md`.

## Remaining qualification boundary

This audit verifies the selection plumbing and a reviewed MODNet matte. It does
not qualify automatic portrait semantics across the complete 24-photo/32-task
corpus, and it does not promote MODNet to a one-click object selector. Any
future claim that a portrait model selects a particular person must include an
annotated real-photo target task, a negative/background region assertion, and
an inspected 100% edge crop. Until then, use prompted Object Selection or
manual brush/trimap refinement when the intended target is one item inside a
complex photograph.
