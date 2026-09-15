# Object Selection target-accuracy evidence — 2026-09-15

## Scope

This gate checks that a prompted selection is anchored to the requested object,
does not silently include nearby objects, and persists the reviewed source-sized
mask. It uses the licensed photographic fixture
`tests/e2e/fixtures/real-life-still-life.jpg` (1280 × 960), not a synthetic
shape.

The test places an include point inside the right-hand apple and a Shift-click
exclude point inside the white mug. The left and middle flowers are independent
distractors. The pointer coordinates are derived from the selected artwork's
actual screen bounds, so the test does not confuse the canvas viewport with the
image placement.

## Result

Command:

```text
TMPDIR=/home/kevina/varve-selection-validation-bXqjQq \
VARVE_SAM2_REAL_MODEL=1 \
VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-apple-negative-20260915 \
VARVE_E2E_PORT=1631 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=selection-specific-target-20260915-exact-topology \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --workers=1 --grep "prompted apple" --reporter=list
```

Result: **1 passed** (57.0 seconds).

The accepted source-resolution mask reported:

| Check | Observed |
| --- | ---: |
| Mask dimensions | 1280 × 960 |
| Hard mask pixels | 51,584 |
| Connected components | 1 |
| Apple review window | 45,084 pixels |
| Apple interior window | 20,730 pixels |
| Mug review window | 0 pixels |
| Flower distractor window | 0 pixels |
| Hard-mask bounds | x 1017–1279, y 557–817 |

The full-composition preview and applied screenshots were inspected:

- `test-results/selection-specific-target-20260915-exact-topology/canvas-object-selection-re-1535c-bjects-in-a-real-still-life-chromium/real-still-life-apple-preview.png`
- `test-results/selection-specific-target-20260915-exact-topology/canvas-object-selection-re-1535c-bjects-in-a-real-still-life-chromium/real-still-life-apple-applied.png`

The preview highlights the apple while retaining the negative mug marker. The
applied view retains only the apple-shaped mask; the mug and flowers remain
outside the persisted mask. The test also exercises the review confirmation,
mask application, and source-resolution document persistence path.

## Selection-to-generation synchronization

Command:

```text
TMPDIR=/tmp VARVE_SAM2_REAL_MODEL=1 \
VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-generative-20260915-final \
VARVE_E2E_PORT=1639 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=selection-generative-20260915-final \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --workers=1 \
  --grep "passes the reviewed real-object mask into Generative Edit before Remove" \
  --reporter=list
```

Result: **1 passed** (1 minute 6 seconds).

The reviewed candidate was imported into the Content-Aware Fill dialog at the
original 1280 × 960 dimensions. The generation-context review remained
required: `Remove && Fill` was disabled until the second review checkbox was
confirmed. The local promptless Remove completed in 2 seconds and Apply
persisted a `remove` generative-edit record with the same source node and mask
topology:

| Check | Observed |
| --- | ---: |
| Imported hard mask pixels | 51,584 |
| Imported apple review window | 45,084 pixels |
| Imported mug review window | 0 pixels |
| Imported flower review window | 0 pixels |
| Persisted hard mask pixels | 51,584 |
| Persisted apple review window | 45,084 pixels |
| Persisted mug review window | 0 pixels |
| Persisted flower review window | 0 pixels |
| Persisted connected components | 1 |

The E2E assertion compares those imported and persisted measurements directly,
so a stale, resampled, or different candidate cannot pass this lane. The
reviewed full-dialog and applied-canvas artifacts are retained at:

- `test-results/selection-generative-20260915-final/canvas-object-selection-re-dac48-nerative-Edit-before-Remove-chromium/real-object-remove-result.png`
- `test-results/selection-generative-20260915-final/canvas-object-selection-re-dac48-nerative-Edit-before-Remove-chromium/real-object-remove-applied.png`

This validates data flow and review gating, not semantic removal quality. The
point-only mask visibly captured only the upper portion of this edge-hugging
apple; the Remove result retained a lower/right apple crescent. A point is not
enough evidence for an object whose visible extent reaches an image boundary.
The user must review the overlay and use a box hint or additional positive
points before generation.

## Edge-object box recovery and adjacent-object rejection

The first real box run exposed a separate selection bug. A broad box around
the edge apple produced four disconnected components and incorrectly included
8,430 hard pixels from the nearby mug. The validator had treated every
component intersecting a box as endorsed by the user. That was unsafe for
object-specific editing.

Prompted-mask validation now treats a box as a location hint: it anchors only
the largest supported connected component. Smaller disconnected regions must
be supported by their own positive prompt or are pruned/rejected. The focused
unit regression test covers this ambiguity, and the real-photo rerun passed:

```text
BOX OBJECT MASK: width=1280 height=960 hardPixels=85882
componentCount=1 appleHardPixels=72242 appleInteriorHardPixels=28724
mugHardPixels=0 flowerHardPixels=0 bounds=minX:1007 minY:555 maxX:1279 maxY:959
```

The box preview and applied mask were visually inspected and are retained at:

- `test-results/selection-box-20260915-fixed/canvas-object-selection-re-dc7a9-real-object-before-applying-chromium/real-still-life-box-preview.png`
- `test-results/selection-box-20260915-fixed/canvas-object-selection-re-dc7a9-real-object-before-applying-chromium/real-still-life-box-applied.png`

Together these lanes show that selection prompts are mapped to the actual
placed artwork, reviewed before mutation, transferred without changing the
source-sized mask, and protected against a broad-box adjacent-object leak.
They do not replace the required multi-photo qualification for hair,
transparency, reflections, boundaries, perspective, or other difficult cases.

## Revalidation after interior-anchor guard (commit `edd484862`)

The selection validator now measures hard-mask support in a bounded
neighbourhood around each positive point. A point-only candidate whose only
include point is on or near the proposed boundary remains visible but cannot be
applied or handed into Generative Edit until the user adds a deeper include
point or a box. Candidate ranking also prefers a candidate without this
refinement requirement over a higher-scoring boundary candidate.

The real-photo edge guard was rerun after the change:

```text
TMPDIR=/home/kevina/varve-selection-validation-PGtrW4 \
VARVE_SAM2_REAL_MODEL=1 \
VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-edge-20260915c \
VARVE_E2E_PORT=1661 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=selection-edge-20260915c \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --workers=1 \
  --grep "blocks an under-specified edge-object prompt" --reporter=list
```

Result: **1 passed** (45.5 seconds). The full-composition screenshots were
inspected at:

- `test-results/selection-edge-20260915c/canvas-object-selection-re-381f9-t-before-it-reaches-an-edit-chromium/real-still-life-apple-preview.png`
- `test-results/selection-edge-20260915c/canvas-object-selection-re-381f9-t-before-it-reaches-an-edit-chromium/real-still-life-apple-blocked.png`

The complementary box recovery lane was rerun with the same model and source:

```text
TMPDIR=/home/kevina/varve-selection-validation-EJ5fiP \
VARVE_SAM2_REAL_MODEL=1 \
VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-box-20260915b \
VARVE_E2E_PORT=1662 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=selection-box-edd484862 \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --workers=1 \
  --grep "uses a box hint to capture an edge-hugging real object" --reporter=list
```

Result: **1 passed** (50.1 seconds). The production mask report was
`1280 × 960`, `85882` hard pixels, one connected component, `72242` pixels in
the apple review window, and zero pixels in both the mug and flower windows.
The inspected artifacts are:

- `test-results/selection-box-edd484862/canvas-object-selection-re-dc7a9-real-object-before-applying-chromium/real-still-life-box-preview.png`
- `test-results/selection-box-edd484862/canvas-object-selection-re-dc7a9-real-object-before-applying-chromium/real-still-life-box-applied.png`

These runs validate the new selection safety behavior on a licensed photograph;
they do not qualify SAM2 for all categories and do not establish that semantic
generative Fill, Replace, or Expand quality is complete.

## Revalidation after source-mask reopen fix (commit `38513841c`)

The source-mask handoff was revalidated against a second licensed photograph
from the Pexels portrait corpus (`tests/fixtures/bg-removal-corpus/human.jpg`).
The prompt was an off-centre point on the shirt rather than the image centre,
so the visual check exercises the actual placed artwork and the candidate's
boundary. The real model returned three candidates, and the reviewed candidate
was applied through the normal undo/redo path:

```text
VARVE_SAM2_REAL_MODEL=1 VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-real-20260915d \
VARVE_E2E_PORT=1663 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 \
VARVE_E2E_OUTPUT_DIR=selection-real-20260915d \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --workers=1 \
  --grep "clicks an object, gets a real mask preview" --reporter=list
```

Result: **1 passed** (55.8 seconds). The status reported a real predicted-IoU
score of `0.55`, prompt match `100%`, and three candidate masks. The selected
and applied screenshots were inspected at:

- `test-results/selection-real-20260915d/canvas-object-selection-re-592e1-s-it-and-survives-undo-redo-chromium/real-model-selection.png`
- `test-results/selection-real-20260915d/canvas-object-selection-re-592e1-s-it-and-survives-undo-redo-chromium/real-model-preview.png`
- `test-results/selection-real-20260915d/canvas-object-selection-re-592e1-s-it-and-survives-undo-redo-chromium/real-model-applied.png`

The reviewed result shows the blue shirt region selected and applied without
the surrounding wall or the rest of the portrait being included in the mask.
This is a visual selection check, not proof of semantic intent for every point
or photograph. The source-mask reopen path itself remains covered by the
source-frame/unit contract; a high-resolution model-quality run is still
required before the overall generative-editing release gate can pass.

Prompt geometry is validated immediately after decoding the source dimensions
and before local model lookup, memory probing, or full-resolution pixel
allocation. An off-image or unmappable point/box therefore fails as an input
error without starting segmentation work; the focused hook test asserts that
no model path is requested in that case.

## Failure that led to the fix

The first corrected-coordinate run selected the right apple and excluded the
mug and flowers, but the persisted hard mask contained nine components:

```text
hardPixels=52063, componentCount=9, appleHardPixels=45528,
appleInteriorHardPixels=20760, mugHardPixels=0, flowerHardPixels=0
componentAreas=[51584,346,37,35,27,18,12,3,1]
```

The previous bounded 384-pixel topology grid merged small gaps in this
1280 × 960 mask, so those disconnected specks were not pruned. Prompted mask
validation now uses exact connected-component topology for sources up to 2 MP
and a bounded 1024-pixel review grid for larger sources. The source-sized
regression test `keeps high-resolution photographic specks from merging into
the target component` covers the one-pixel-gap case.

## Limits

This is evidence that explicit point polarity, placement mapping, candidate
review, and disconnected-noise handling work for this photographed still life.
It is not a claim that SAM2 semantically identifies every arbitrary object or
that one photograph qualifies the complete generative-editing system. Portrait,
hair, transparency, boundary, rotated-placement, low-memory, and other model
quality lanes remain separate release evidence.
