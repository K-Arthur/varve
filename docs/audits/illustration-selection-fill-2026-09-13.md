# Illustration selection-fill slice — 2026-09-13

## Scope and product boundary

This slice rounds out the existing illustration workflow without adding a
workspace, route, project type, document format, or second paint system. It
adds a selection-to-flats operation to the existing **Selection Sources**
Inspector section and the existing sparse raster tile compositor.

The supported path is:

1. Build a selection with the existing marquee, pixel lasso, quick-mask, or
   image-derived source tools.
2. Select one visible, unlocked raster layer as the output target.
3. Choose **Fill pixel layer** in **Selection Sources**.

The source selection remains active after the fill, so another colour pass can
reuse it. The fill is one document mutation and therefore one undo entry. It
does not flatten vector content, silently rasterize an image, or overwrite the
source selection.

## Research register

Research was checked on 2026-09-13 before implementation.

| Source | Applicable version/date | Finding | Uncertainty | Decision |
| --- | --- | --- | --- | --- |
| [Krita Fill Tool](https://docs.krita.org/en/reference_manual/tools/fill.html) | Manual 5.3.0, accessed 2026-09-13 | A practical fill workflow separates current-selection fill from contiguous/similar-region detection, exposes reference scope, and treats grow/feather/gap closure as separate concerns. | Varve does not yet have a production bucket/flood tool or a complete line-art reference compositor. | Ship the reliable, bounded selection-fill slice first; do not label it as a bucket detector. |
| [Krita flat-coloring tutorial](https://docs.krita.org/en/tutorials/flat-coloring.html) | Manual page crawled 2026-09-13 | Anti-aliased linework can leave halos; grow/threshold choices affect the boundary and are not interchangeable with tolerance. | The recommended values are artwork-dependent. | Preserve soft selection coverage and document the need for an explicit selection source. |
| [GIMP Bucket Fill](https://docs.gimp.org/3.0/en_GB/gimp-tool-bucket-fill.html) | GIMP 3.0 manual, accessed 2026-09-13 | Sample-merged is a separate choice from the output layer; transparent/alpha-lock behaviour is a common source of visible fringes. | GIMP's exact pixel-selection policies are not Varve's contract. | Keep output target and selection source separate, use canonical source-over/alpha-lock tile math, and refuse ambiguous targets. |
| [MyPaint gap-closure issue #296](https://github.com/mypaint/mypaint/issues/296) | Issue opened 2015, accessed 2026-09-13 | Artists specifically complain about flood-fill spill through small line-art gaps and want bounded closure independent of colour tolerance. | The issue is historical and does not establish a universal algorithm. | Do not pretend that selection fill solves gap closure; defer a real bucket tool until its reference, closure, preview, and memory contract are implemented. |

The W3C compositing model and Varve's existing tile compositor were also
reviewed. The implementation stores straight-alpha RGBA tiles but performs
source-over calculations in premultiplied form, matching the existing brush
path rather than introducing a second blend implementation.

## Before-state diagnosis

Before this change, the editor had selection construction and persistence but
no working route from an area selection to a paint-layer flat. The existing
Inspector `FillSection` edits vector/object fills; it is not a raster bucket
operation. Artists could create a selection, but the final flat-colour pass
required a brush stroke or an unrelated mask command. That made the common
sketch/reference → selection → flats workflow incomplete.

Reproduced/static distinction:

- Confirmed by source tracing: `SelectionSourcesPanel` exposed selection
  sources, saved selections, and path/mask conversions, but no raster output
  action.
- Confirmed by source tracing: `compositeDabOnNode` was the canonical sparse
  tile mutation, but synthesizing a large brush dab would lose selection
  coverage semantics and inflate work.
- Not claimed: a full bucket-fill spill/gap defect was not reproduced because
  no production bucket tool existed to exercise.

## Implementation

Changed surfaces:

- `packages/scene/src/rasterLayer.ts`: `fillCoverageOnNode` applies one
  bounded coverage plane using the same source-over and alpha-lock semantics
  as brush compositing. It copies only touched tiles and never mutates the
  source node.
- `packages/editor/src/tools/selectionCoverage.ts`:
  `selectionCoverageForRasterNode` maps document-space selection coverage
  through the full node transform into a bounded raster-local mask, rejects
  singular transforms, and caps work at the existing 16,777,216-pixel
  selection budget.
- `packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx`:
  adds the existing-surface **Fill pixel layer** action with disabled reasons
  for missing selection, non-pixel target, hidden target, and locked target.
- Tests cover sparse tile creation, soft coverage, alpha lock, transformed
  selection mapping, singular-transform rejection, and the real Inspector
  mutation/history path.

No workspace configuration, scene schema, serialization version, or native
model/inference path changed.

## Verification record

Focused pure tests now pass despite the shared repository's concurrent Vite
and Vitest workers:

| Check | Command | Result |
| --- | --- | --- |
| Selection mapping and sparse raster mutation | `timeout 300s nice -n 10 pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/selectionCoverage.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --testNamePattern='fills only the covered pixels|uses soft coverage|selectionCoverageForRasterNode' --reporter=verbose` | Pass: 4 tests in 2 files; 30 unrelated tests skipped. Duration 218.08s under shared load. |
| Touched-file formatting/lint | `pnpm exec biome format --write packages/scene/src/__tests__/rasterLayer.test.ts` and `pnpm exec biome check packages/scene/src/rasterLayer.ts packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/selectionCoverage.ts packages/editor/src/tools/selectionCoverage.test.ts packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx packages/editor/src/components/Inspector/SelectionSourcesPanel.test.tsx tests/e2e/canvas/selection-fill.spec.ts apps/website/src/pages/features/strokes.astro apps/website/src/pages/docs/tools/strokes.astro` | Pass: 7 files checked after one formatting fix. |
| Scene package typecheck | `pnpm --filter @varve/scene typecheck` | Blocked by unrelated concurrent diagnostics in `src/__tests__/clone.test.ts`, `src/__tests__/depthMaskRecipe.test.ts`, and `../shared/src/typographyFeatures.ts`; no diagnostic named this slice. |
| Affected planner | `pnpm verify:plan` / `pnpm verify:affected` | Planner selected 376 shared-tree changes and required full escalation; affected exited at that mandated boundary with `FULL-SUITE ESCALATION: YES`. No full-gate pass is claimed. |

The Inspector integration test was launched separately with a 300-second
bound, but shared module compilation is still the limiting factor and its
result is recorded at handoff. The required browser validation must verify the
existing editor path, inspect before/after canvas images, exercise undo, and
cover save/reopen/export before this slice can claim end-to-end visual
acceptance. No visual pass is claimed merely because a screenshot was
generated.

## Limits and next slice

This is intentionally not a full bucket/flood-fill implementation. It does
not yet provide contiguous or similar-colour sampling, merged vector/group
reference sampling, gap closure, grow/shrink, drag-fill, or a live expensive
preview. The next P1 slice should add those only through a shared rasterized
reference contract with bounded memory and cancellation. Until then, the
truthful flat-colour workflow uses the existing Magic Wand/lasso/quick-mask to
define the region and **Fill pixel layer** to place the colour.

The marketing and tool-guide copy describes this exact boundary and does not
claim a bucket detector or automatic line-art closure.
