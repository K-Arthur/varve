# Illustration selection-fill slice — 2026-09-13

## Scope and product boundary

This slice rounds out the existing illustration workflow without adding a
workspace, route, project type, document format, or second paint system. It
adds a selection-to-flats operation to the existing **Selection Sources**
Inspector section and the existing sparse raster tile compositor.

The supported paths are:

1. Build a selection with the existing marquee, pixel lasso, quick-mask, or
   image-derived source tools. The existing Magic Wand can now sample a
   selected pixel layer in contiguous or global mode.
2. Refine the active selection through the existing Edit → Pixel Selection
   commands or the command palette. Grow/Shrink/Smooth/Threshold remain
   bounded coverage operations; Grow and Shrink are fixed at 1 px in this
   surface.
3. Select one visible, unlocked raster layer as the output target.
4. Choose **Fill pixel layer** in **Selection Sources**.

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
| [Krita Contiguous Selection Tool](https://docs.krita.org/en/reference_manual/tools/contiguous_select.html) | Krita manual 5.3.0, accessed 2026-09-13 | A Magic Wand is a contiguous similar-colour selection; threshold, reference scope, anti-aliasing, grow, feather, and gap closure are separate controls. | Varve's existing options expose tolerance/mode/edge feather, but not Krita's reference-layer or gap-closure contract. | Add raster-layer sampling without claiming merged line-art reference or gap closure; keep those as explicit follow-up work. |
| [GIMP Fuzzy Select and Select by Colour](https://docs.gimp.org/3.0/en_GB/gimp-tool-fuzzy-select.html) and [Select by Colour](https://docs.gimp.org/3.0/en_GB/gimp-tool-by-color-select.html) | GIMP 3.0 manual, accessed 2026-09-13 | Fuzzy Select is contiguous while Select by Colour is global; both depend on the clicked seed and have explicit transparency/sample-merged choices. | GIMP's drag-to-change-threshold and diagonal-neighbour options are not in this slice. | Reuse the existing contiguous/global mode contract, reject transparent seeds, and never silently sample merged/vector content. |
| [MyPaint gap-closure issue #296](https://github.com/mypaint/mypaint/issues/296) | Issue opened 2015, accessed 2026-09-13 | Artists specifically complain about flood-fill spill through small line-art gaps and want bounded closure independent of colour tolerance. | The issue is historical and does not establish a universal algorithm. | Do not pretend that selection fill solves gap closure; defer a real bucket tool until its reference, closure, preview, and memory contract are implemented. |
| [Adobe community: contiguous Magic Wand edge case](https://community.adobe.com/t5/photoshop-ecosystem-discussions/how-does-contiguous-work/m-p/15527954/highlight/true) | User report, 2025 thread, accessed 2026-09-13 | A user reported incorrect contiguous/intersection results even when visible segments shared the same colour and tolerance changes did not help. | Anecdotal and version-specific; it is not a conformance test. | Keep contiguous and global paths explicit and add separated-region regression coverage so a mode cannot silently become “select everything”. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | W3C Recommendation, accessed 2026-09-13 | The compositing model defines source-over as an explicit alpha operation rather than a colour-only replacement. | Varve's supported blend-space and colour-depth limits remain those of the existing compositor. | Reuse the established premultiplied source-over calculation and keep selection coverage as an independent multiplier. |
| [React Strict Mode](https://react.dev/reference/react/StrictMode) and [keeping components pure](https://react.dev/learn/keeping-components-pure) | React 19 documentation, accessed 2026-09-13 | Development Strict Mode intentionally calls state updater functions twice and requires them to be pure; ref mutations inside an updater can therefore duplicate history entries. | Production does not double-call these functions, but the duplicated development behavior exposed a real ordering defect in the editor. | Move selection-history ref mutations out of the state updater and exercise one UI command through the real browser path. |

The W3C compositing model and Varve's existing tile compositor were also
reviewed. The implementation stores straight-alpha RGBA tiles but performs
source-over calculations in premultiplied form, matching the existing brush
path rather than introducing a second blend implementation.

## Before-state diagnosis

Before these changes, the editor had selection construction and persistence
but no working route from an area selection to a paint-layer flat. The
existing Inspector `FillSection` edits vector/object fills; it is not a raster
bucket operation. The existing Magic Wand decoded image-bearing shapes but
did not sample sparse pixel-layer tiles, so a raster sketch could not use the
same colour-range selection path. Artists could create a selection, but the
final flat-colour pass required a brush stroke or an unrelated mask command.
That made the common sketch/reference → selection → flats workflow incomplete.

Reproduced/static distinction:

- Confirmed by source tracing: `SelectionSourcesPanel` exposed selection
  sources, saved selections, and path/mask conversions, but no raster output
  action.
- Confirmed by source tracing: `compositeDabOnNode` was the canonical sparse
  tile mutation, but synthesizing a large brush dab would lose selection
  coverage semantics and inflate work.
- Reproduced in the real editor before the raster extension: selecting a
  `RasterLayerNode`, activating Magic Wand, and clicking a rendered paint mark
  announced that an image was required. The raster node was not a Magic Wand
  target and the canvas hit-test could return no raster hit at the visible
  mark, so the explicit selected-layer fallback is part of the fix.
- Not claimed: a full bucket-fill spill/gap defect was not reproduced because
  no production bucket tool existed to exercise.
- Reproduced in the browser while adding selection refinement coverage: one
  Grow command could create two area-history entries because the history ref
  was mutated inside a React state updater. A later Fill transaction also
  cleared the selection stack, so consecutive Undo commands could remove the
  original paint instead of restoring the pre-grow selection. The failure was
  captured in `pixel-selection-refinement` before the repair; it was not
  inferred from the unit test alone.

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
- `packages/editor/src/tools/rasterColorSelection.ts` and
  `packages/editor/src/tools/MagicWandTool.ts`: sample one selected sparse
  raster layer into a bounded working plane, use existing OKLab contiguous or
  global colour-range selection, map the result through the full node
  transform, and preserve the existing selection-operation semantics. A
  click on the explicitly selected raster layer remains usable even when the
  generic canvas hit-test declines the pixel node.
- `packages/editor/src/context.tsx` and
  `packages/editor/src/actions/createActionHandlers.ts`: selection
  refinements use the existing undoable `commitAreaSelection` contract. Their
  history entries retain the document-stack depth at which they were made, so
  a later raster fill is undone first and the older selection refinement is
  undone second. Ref mutations happen outside React state updaters, avoiding
  Strict Mode duplicate entries.
- Tests cover sparse tile creation, soft coverage, alpha lock, transformed
  selection mapping, singular-transform rejection, and the real Inspector
  mutation/history path.
- `tests/e2e/canvas/pixel-selection-refinement.spec.ts` drives the registered
  Grow command through the existing command palette, fills through Selection
  Sources, verifies two ordered undos, then saves, exports, reloads, and
  reopens the document.

No workspace configuration, scene schema, serialization version, or native
model/inference path changed.

## Verification record

Focused pure tests and the real browser workflow pass despite the shared
repository's concurrent Vite, Vitest, and full-gate workers:

| Check | Command | Result |
| --- | --- | --- |
| Selection mapping and sparse raster mutation | `timeout 300s nice -n 10 pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/selectionCoverage.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --testNamePattern='fills only the covered pixels|uses soft coverage|selectionCoverageForRasterNode' --reporter=verbose` | Pass: 4 tests in 2 files; 30 unrelated tests skipped. Duration 218.08s under shared load. |
| Raster Magic Wand selection helper | `test_tmp=$(mktemp -d /var/tmp/varve-raster-wand-unit.XXXXXX); trap 'rm -rf "$test_tmp"' EXIT; TMPDIR="$test_tmp" timeout 180s pnpm exec vitest run packages/editor/src/tools/rasterColorSelection.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --reporter=verbose` | Pass: 3 tests covering contiguous connected regions, global separated matches, and transparent seed rejection. |
| Touched-file formatting/lint | `pnpm exec biome format --write tests/e2e/canvas/selection-fill.spec.ts` and `timeout 60s pnpm exec biome check tests/e2e/canvas/selection-fill.spec.ts` | Pass. The complete owned-surface check also passed earlier; the final E2E fixture check is recorded here after its visual assertions were added. |
| Scene package typecheck | `pnpm --filter @varve/scene typecheck` | Blocked by unrelated concurrent diagnostics in `src/__tests__/clone.test.ts`, `src/__tests__/depthMaskRecipe.test.ts`, and `../shared/src/typographyFeatures.ts`; no diagnostic named this slice. |
| E2E typecheck | `timeout 180s pnpm typecheck:e2e` | Blocked by unrelated concurrent diagnostics in engine colorization dispatch and WebGPU circle-parity metrics; no diagnostic named `selection-fill.spec.ts`. |
| Real Chromium workflow | `timeout 540s env TMPDIR="$test_tmp" VARVE_E2E_PORT=1756 VARVE_E2E_OUTPUT_DIR=selection-fill-e2e-final19 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 pnpm exec playwright test tests/e2e/canvas/selection-fill.spec.ts --project=chromium --reporter=list` | Pass: 1 test, 2.0m wall time. The UI created a print-intent document, resized it through Page Print to a bounded 640×480 fixture, painted, selected, filled, undid, redid, saved, exported, reloaded, and reopened it. |
| Real Chromium raster Magic Wand workflow | `test_tmp=$(mktemp -d /var/tmp/varve-raster-wand-e2e.XXXXXX); trap 'rm -rf "$test_tmp"' EXIT; timeout 540s env TMPDIR="$test_tmp" VARVE_E2E_PORT=1777 VARVE_E2E_OUTPUT_DIR=raster-magic-wand-e2e-final12 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 pnpm exec playwright test tests/e2e/canvas/raster-magic-wand.spec.ts --project=chromium --reporter=list` | Pass: 1 test, 1.3m wall time. Real paint, selected raster target, Magic Wand click, existing Selection Sources fill, Ctrl+S, PNG export, Home-library reopen, and screenshot capture all completed. |
| Real Chromium selection-refinement workflow | `test_tmp=$(mktemp -d /var/tmp/varve-refine-e2e5.XXXXXX); trap 'rm -rf "$test_tmp"' EXIT; timeout 420s env TMPDIR="$test_tmp" VARVE_E2E_PORT=1794 VARVE_E2E_OUTPUT_DIR=pixel-selection-refinement-final2 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 pnpm exec playwright test tests/e2e/canvas/pixel-selection-refinement.spec.ts --project=chromium --reporter=list` | Pass: 1 test in 1.9m. Grow was dispatched through the existing command palette, Fill pixel layer ran on the existing raster target, two ordered undos restored the pre-grow selection without deleting the source stroke, and save/export/reload/reopen completed. |
| Export content invariant | Same Chromium run; PNG decoded with `pngjs` | Pass: PNG signature, 640×480 dimensions, and more than 5,000 opaque black pixels. The saved PNG was inspected both with transparency and composited over a neutral background. |
| Documentation/emoji/token audits | `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` | Pass: docs clean (796 docs, 401 links, 174 ADRs indexed), emoji clean (4,546 files), and all 153 theme token pairs pass across three themes. |
| Affected planner/full gate | `pnpm verify:plan`, `pnpm verify:affected`, and `VARVE_FULL_GATE_REASON='Final shared-master illustration integration gate; planner escalated because concurrent workspace/toolchain/validation changes broadened the affected closure' timeout 900s pnpm verify:full` | Planner required full escalation. Affected stopped at that mandated boundary. The full gate timed out under shared load and reported unrelated concurrent lint/architecture failures; no full-gate pass is claimed. |
| Website build | `timeout 300s pnpm --filter @varve/website build` | Pass: Astro check completed with 0 errors and the static build generated 100 pages. The existing five unused-import hints remain non-blocking; the two stroke pages are included in the generated routes. |

The browser evidence is under
`test-results/selection-fill-e2e-final19/canvas-selection-fill-sele-512bb-ction-Sources-and-undoes-it-chromium/`:

- `selection-fill-after.png` shows the black flat inside the dashed selection
  while the original stroke remains visible.
- `selection-fill-undo.png` shows the flat removed while the selection outline
  and original stroke remain.
- `selection-fill-redo.png` restores the flat in the same target.
- `selection-fill-reopened.png` shows the saved stroke and flat after reload
  and Home-library reopen; the test waits for a fresh authoritative frame
  before capture.
- `selection-fill.png` is the 640×480 transparent PNG export. Its black
  artwork is visible when composited over a neutral background because the
  transparent remainder is correctly encoded as zero-alpha pixels.

The raster Magic Wand screenshots and export are under
`test-results/raster-magic-wand-e2e-final12/canvas-raster-magic-wand-r-ea64f-e-existing-flat-fill-action-chromium/`:

- `raster-magic-wand-selection.png` was inspected and shows the painted mark
  still present with the selected pixel layer active after the Magic Wand
  gesture.
- `raster-magic-wand-filled.png` was inspected and shows the existing
  **Selection Sources** panel with **Fill pixel layer** enabled and the
  completed fill path still on the same canvas/document.
- `raster-magic-wand.png` was decoded and verified as a 640×480 PNG with
  non-empty opaque artwork; `raster-magic-wand-reopened.png` was inspected
  after Home-library reopen and shows the persisted stroke on a fresh canvas.

The selection-refinement screenshots and export are under
`test-results/pixel-selection-refinement-final2/canvas-pixel-selection-ref-f6b94-d-exports-the-restored-fill-chromium/`:

- `pixel-selection-before-refine.png` was inspected with the empty dashed
  selection and source stroke visible.
- `pixel-selection-grown-fill.png` was inspected with the larger black flat
  inside the expanded selection and the existing **Fill pixel layer** control
  visible.
- `pixel-selection-restored-fill.png` was inspected with the smaller
  pre-grow selection refilled while the source stroke remained.
- `pixel-selection-restored-reopened.png` was inspected after reopening from
  Home; the selection overlay is absent, but the saved stroke and flat remain.
- `pixel-selection-restored.png` is a 640×480 transparent PNG. It contains
  15,336 opaque black pixels and 291,288 zero-alpha pixels; it was also
  composited over a neutral background and visually inspected to confirm the
  stroke and flat are present without a background halo.

Earlier browser attempts were useful regression discovery, not acceptance
evidence: a concurrent engine parse error blocked one startup; an open
marquee-options popover covered one gesture; selecting the page group instead
of its child raster layer correctly disabled the operation; and the first
export locator searched for a sibling Download button inside the format group.
The test now drives the real Tool options, target row, and Download PNG
controls. The Page Print fixture setup also emits existing history warnings
from that separate resize path; no selection-fill mutation warning remains
after routing the operation through its persistent transaction.

## Limits and next slice

This is intentionally not a full bucket/flood-fill implementation. Raster
Magic Wand now provides contiguous and global OKLab colour selection on one
pixel layer, with a bounded 4,194,304-pixel working plane. The existing
selection refinement commands now have an ordered undo path, but Grow/Shrink
use a fixed 1 px amount and the soft/compound paths still use the bounded
raster refinement implementation. The workflow does not yet provide merged
vector/group/reference sampling, gap closure, diagonal neighbours, drag-fill,
or a live expensive preview. Transparent seeds are rejected rather than
turning hidden RGB into a selection. The next P1 slice should add those only
through a shared rasterized reference contract with bounded memory and
cancellation. Until then, the truthful flat-colour workflow selects a raster
layer, uses Magic Wand/lasso/quick-mask/refinement to define the region, and
uses **Fill pixel layer** to place the colour.

The marketing and tool-guide copy describes this exact boundary and does not
claim a bucket detector, merged reference sampling, or automatic line-art
closure.
