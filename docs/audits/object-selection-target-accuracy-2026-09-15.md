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
