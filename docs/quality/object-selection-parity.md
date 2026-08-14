# Object Selection parity and quality methodology

This document defines how Varve measures Object Selection quality and how a
replacement segmentation runtime is accepted. It exists so that "the model
looks fine on one screenshot" is never the acceptance bar.

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

1. Install the model (Settings → AI Models → Object Selection).
2. Run the quality E2E spec
   `tests/e2e/canvas/object-selection-quality.spec.ts` — it drives the real
   tool, reads the preview mask back, and writes `results.json` with
   per-fixture metrics, provider, and p50/p95 prompt latency.
3. Render the table:
   `node scripts/bench/object-selection-parity-report.mjs --input results.json`

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
