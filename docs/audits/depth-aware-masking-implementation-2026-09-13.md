# Depth-aware masking implementation audit — 2026-09-13

Status: implementation slice complete on `master`; focused scalar, ownership,
browser, persistence, and visual evidence are recorded below. This audit
covers the reusable depth resource, range-mask workflow, adjustment
integration, persistence, and the existing Depth Blur consumer. It does not
claim metric reconstruction or perfect matting.

## User outcome

The existing Inspector now supports this sequence without adding a workspace:

1. Select an image source, or select an Adjustment Layer and explicitly choose
   its image source.
2. Generate and save a reusable map from Depth Blur, or import a canonical
   `.vdepth.json` scalar resource.
3. Inspect the contained heatmap, valid-only histogram, status, and near/far
   sample controls.
4. Set numeric near/far endpoints and independent depth-domain transitions.
5. Choose Replace, Intersect, Add/Union, or Subtract, then apply to the
   existing layer or adjustment mask.
6. Continue refining coverage with the existing Mask/Selection/Refine tools.
7. Save, reopen, undo/redo, remove Depth Blur, export a scalar map, or copy
   the resource through the existing document/clipboard paths.

Applying a depth mask does not enable blur, alter source pixels, or rerun
inference. A saved accepted map is sufficient for editing and export.

## Root-cause and ownership matrix

| User task / finding | Evidence and root cause | Implemented owner and result | Gate |
| --- | --- | --- | --- |
| Select a depth range without blur | The old path was surfaced through the Depth Blur panel and committed a generic quick raster mask. | `DepthMaskSection` reuses `Document.depthMaps`, the shared engine kernel, and `commitRasterMask`; no blur effect is created. | Unit + browser workflow |
| Preserve existing masks | A depth operation can silently replace a vector/live mask or multiply alpha twice if it invents its own Boolean path. | Existing non-raster masks require explicit Replace confirmation; existing raster masks default to Intersect and all combinations use shared soft coverage algebra. Source alpha remains separate. | Scene/commit tests |
| Localize an adjustment | Adjustment scope and image placement are different coordinate contracts; a full-source mask drawn into a cropped fill shifts coverage. | `DepthMaskRecipe` binds the map to an image source in source-image pixels; replay uses the exact fill crop/fit/transform placement and leaves zero coverage at the original adjustment result. | Replay/scene + browser |
| Reopen without model or blur | A map referenced only by a blur effect was at risk of being pruned or unavailable to a standalone mask. | Recipes and depth resources participate in codec closure, pruning, clipboard remapping, and offline resolved-mask fallback. Removing blur retains the resource. | Codec/import tests |
| Keep hand corrections | Recomputing a range must not erase painted coverage. | Existing refine commits become a recipe correction asset with revision/target; range edits can Replace or explicitly rebase through combine operations. | Commit/refine tests |
| Prevent stale inference commits | A panel closing must not dispose the shared host or let an old result overwrite a new source. | Request cancellation detaches only the owning request; generation checks source/node/resource identity before commit and retains the last accepted result. | Worker + UI source guards |
| Avoid preview picker errors | `putImageData` does not scale; contain bars and independent preview dimensions previously made clamped sampling plausible. | A shared contained layout draws the full map and maps CSS coordinates back to map pixels, returning no sample in bars. | Geometry tests + screenshot |
| Import safely | Opaque grayscale, pseudocolor, HDR gain maps, and nominal “16-bit” files do not establish a scalar contract. | The bounded first importer accepts only validated Varve `.vdepth.json`, checks schema, exact payload length, canonical ordering, validity, registration, and byte length. | Import tests |

## Canonical data contract

`packages/engine/src/depthMap.ts` is the model-independent owner. A map is a
continuous scalar field plus a 0/1 validity field; it is not a mask, heatmap,
alpha channel, confidence probability, or metric measurement by implication.

- Persisted scalar values are little-endian `uint16` canonical normalized
  values, with `0 = near` and `1 = far`. Metric inputs additionally retain a
  little-endian float32 calibrated payload and declared units.
- Validity excludes non-finite, transparent, missing, and unregistered
  samples. Valid constant planes are distinct from all-invalid prediction.
- Normalization records source range, percentiles/explicit metric range,
  input convention, and valid count. It is computed once from valid source
  content and is not recomputed for viewports, thumbnails, or range changes.
- Registration records source/map dimensions, top-left orientation, pixel
  coordinate space, and source-to-map affine data. Alignment uses valid-only
  sampling and does not clamp outside the registered map to an edge sample.
- Colorized previews are generated from scalar values and never become the
  authoritative resource.

## Mask and recipe semantics

The shared `depthRangeToCoverage` kernel defines inclusive endpoints, finite
clamped coverage, explicit crossed-handle behavior, independent near/far
depth-domain transitions, and valid-domain-only inversion. `combineMaskCoverage`
uses soft product for intersection, probabilistic union for Add/Union, and
soft subtraction; it does not use a binary shortcut.

`RasterMaskData.depthRecipe` stores the depth-map ID, source binding and
identity, range/falloff, inversion, combination mode, algorithm version, and
optional correction dependency. Resolved raster coverage remains available
for fast offline display. An invalid recipe does not discard a valid resolved
mask; the codec warns and strips only the unusable live recipe.

Depth resources are reachable through depth effects, recipes, correction
assets, source bindings, copied fragments, and history snapshots. Removing a
single blur consumer therefore does not remove a shared map. Duplication and
paste remap map, node, fill, mask, and source-asset IDs together.

## Research and complaint-informed decisions

Research was performed 2026-09-13 and is recorded in
`docs/research/depth-aware-masking-2026-09-13.md`. Primary sources included:

- [Depth Anything V2 repository](https://github.com/DepthAnything/Depth-Anything-V2),
  [paper](https://arxiv.org/abs/2406.09414), and the exact upstream
  [preprocessing](https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/depth_anything_v2/util/transform.py)
  and [DPT head](https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/depth_anything_v2/dpt.py).
- The exact converted artifact's [model card](https://huggingface.co/onnx-community/depth-anything-v2-small/blob/main/README.md)
  and [ONNX files](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx).
- [Lightroom masking documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html),
  [CSS Masking](https://www.w3.org/TR/css-masking-1/),
  [Compositing](https://www.w3.org/TR/compositing-1/),
  [OpenCV GuidedFilter](https://docs.opencv.org/4.x/d73/classcv_1_1ximgproc_1_1GuidedFilter.html),
  and [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/).

Public user complaints reviewed included Lightroom users reporting that
Depth Range was unavailable or greyed out when a usable depth source was not
present ([Adobe community](https://community.adobe.com/questions-675/lightroom-8-update-problem-with-depth-range-mask-937311),
[Lightroom Queen](https://www.lightroomqueen.com/community/threads/depth-range-mask-always-greyed-out.37971/)),
Affinity users asking for an external depth map to drive blur
([Affinity forum](https://forum.affinity.serif.com/index.php?%2Ftopic%2F14825-is-it-possible-to-take-a-depth-map-from-3d-software-and-use-it-to-drive-a-lens-blur%2F=)),
and users describing destructive or weak mask-management workflows
([Affinity layer-management thread](https://forum.affinity.serif.com/index.php?%2Ftopic%2F175043-why-are-layer-management-tools-missing-in-develop-persona%E2%80%8B-%F0%9F%98%97%E2%80%8B%2F=),
[Blackmagic mask thread](https://forum.blackmagicdesign.com/viewtopic.php?f=21&start=0&t=219557&uid=16)).
The realistic fixes are explicit source/map status, an offline import/reopen
route, reuse independent of blur, non-destructive combine semantics, and a
visible distinction between depth-range coverage and semantic/matte selection.

## Model and runtime evidence

The checked-in artifact is
`apps/desktop/public/models/depth_anything_v2_small_int8.onnx`, 27,258,801
bytes, SHA-256
`01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001`.
The recorded report identifies ORT as unknown and records conflicting old/new
latency values; therefore this audit treats the model as a heavyweight,
cancellable relative-depth generator, not as a quality or speed guarantee.
The production adapter records the raw convention as provenance and converts
once to canonical `nearIsLow`; it does not silently infer a per-photo sign.
Official preprocessing parity, real-photo boundary quality, and physical
4 GB/ARM/Linux WebKitGTK measurements remain deferred gates.

## Validation evidence

The required evidence layers were exercised as follows:

1. semantic recipe/ownership assertions;
2. scalar, geometry, validity, and compositing oracles; and
3. actual Chromium interaction, screenshots, save/reopen, scalar download,
   and decoded export inspection.

Focused deterministic coverage (9 files, 100 tests) passed with:

```text
pnpm exec vitest run --pool=forks --maxWorkers=1 --no-file-parallelism \
  packages/engine/src/depthMap.test.ts \
  packages/editor/src/backgroundRemoval/__tests__/commitRasterMask.test.ts \
  packages/editor/src/tools/__tests__/RefineMaskTool.test.ts \
  packages/scene/src/__tests__/depthMaskRecipe.test.ts \
  packages/editor/src/depth/depthPreviewLayout.test.ts \
  packages/editor/src/depth/depthMaskWorkflow.test.ts \
  packages/editor/src/import/depthResourceMerge.test.ts \
  packages/editor/src/clipboard.test.ts \
  packages/editor/src/canvas/maskReplay.test.ts
```

`pnpm typecheck:e2e` also passed. The real browser workflow passed in a
source snapshot with HMR disabled so unrelated concurrent edits could not
change the page during the run:

```text
VARVE_DISABLE_HMR=1 node node_modules/vite/bin/vite.js --port 4192 --strictPort
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js \
  test tests/e2e/canvas/depth-masking.spec.ts --project=chromium \
  --reporter=list --config playwright.depth.local.config.ts
```

Result: `1 passed (2.7m)` on Linux Chromium, Playwright 1.62.1. The workflow
imported a 100 x 100 little-endian uint16 ramp, sampled both ends of the
contained preview, applied a hard 0–45 range, verified a changed authoritative
canvas frame, exported and parsed the `.vdepth.json`, switched to the existing
Mask owner, undid/redid, saved, reloaded Home, reopened the document, and
reopened the Depth Mask controls without model or blur generation.

Inspected artifacts are in the ignored evidence directory
`reports/depth-aware-masking-2026-09-13/`:

- `depth-map-heatmap.png` — the full 100 x 100 ramp is visible with the correct
  aspect ratio and no contain-bar samples; the legend/controls are tested in
  the surrounding Inspector screenshot context.
- `depth-mask-applied.png` — the source remains in the editor and the applied
  coverage changes the visible result without replacing the source artwork.

The first browser attempts deliberately retained failures: a persisted
safe-mode overlay raced the shared navigation helper, a range-picker test
assumed an exact CSS-rounded value, and a non-exact selector matched both the
Depth Mask disclosure and Apply button. Commit `d3da1254` fixes those test
workflow defects; the final isolated run passed. No generated screenshot is
treated as visual proof until it has been opened and inspected at full preview
and edge detail. No model claim is based only on finite outputs or synthetic
rank correlation.

The marketing surface was built and exercised separately from the editor:

```text
pnpm --filter @varve/website build
pnpm build:website:pages
VARVE_WEBSITE_E2E_PORT=4327 VARVE_WEBSITE_E2E_PORT_ROOT=4328 pnpm exec playwright test \
  apps/website/tests/e2e/depth-aware-effects.spec.ts --project=ghpages \
  --config playwright.website.config.ts --reporter=list
```

The Astro build produced 100 pages with zero errors, the pages build passed,
and the focused website workflow passed (`1 passed (2.7s)`). The feature and
guide were inspected at 1280px, and the guide was also inspected at 390px;
the mobile capture had no horizontal overflow. The inspected captures are
`reports/depth-aware-masking-2026-09-13/website/depth-aware-effects-feature-desktop.png`,
`depth-aware-effects-docs-desktop.png`, and
`depth-aware-effects-docs-mobile.png`.

The affected planner escalated because the shared scene/schema and validation
surface was dirty. The requested full checkpoint was attempted with
`VARVE_FULL_GATE_REASON` set. It did not pass: the current shared worktree
reported unrelated touched-file Biome diagnostics, an existing architecture
ratchet/import failure in `packages/scene/src/adjustmentScope.ts`, and
pre-existing `LutTransform` type errors in the LUT tests. None of those
failures were depth-specific, and the depth-focused tests, website build, and
website E2E remained green. The repository benchmark was started with one
worker but was interrupted after it discovered benchmark files under other
agents' `.worktrees`; it was not used as a depth performance claim.

The final depth integration records are the incremental commits
`272fb8eb1` (crop-aware placement and preserving combine defaults),
`ba16191c9` (cropped-placement regression), `e5be5c363` (documentation), and
`00e96ca87` (marketing-route E2E), on top of the earlier contract, recipe,
workflow, persistence, and cancellation commits listed in the architecture
record. The corresponding source, scalar, and UI changes remain on `master`;
no new branch or parallel depth subsystem was created.

## Boundaries

Implemented and verified are the model-free canonical resource workflow,
relative range selection, soft mask combination, source-bound adjustment
coverage, correction ownership, persistence/remapping, and existing editor
refinement entry points. Deferred are upstream/worker preprocessing parity,
real-photo boundary corpus quality, guided/joint-bilateral evaluation,
Linux WebKitGTK and low-end hardware measurements, and every RAW/retouch/warp
staleness variant. Unsupported are arbitrary PNG/EXR/HEIC/Android/iOS depth
decoding, generated metric depth, video frame reuse, full continuous-depth
painting, semantic subject selection by depth alone, color decontamination,
and 3D reconstruction.
