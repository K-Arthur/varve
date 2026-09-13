# Depth-aware masking implementation plan

Status: core implementation complete on `master`; source-bound crop/fit
placement and preserving combine defaults are covered by the final replay
regression slice. Model-parity, real-photo
edge-quality, and low-end-platform gates remain explicitly deferred. This plan
was intentionally sliced so each commit left the existing editor usable. It is based on the research record
in [`docs/research/depth-aware-masking-2026-09-13.md`](../research/depth-aware-masking-2026-09-13.md).

## Ownership and boundaries

| Lane | Owner | Files/surfaces | Acceptance gate |
|---|---|---|---|
| Contract and kernel | depth integration owner | `packages/engine/src/depthMap.ts`, shared range/combine helpers and tests | Exact scalar/validity/coverage assertions; no second stored depth type |
| Scene persistence | same integration owner | `packages/scene/src/types.ts`, mask validation/codec, reachability/clone/import | Recipe survives save/reopen, map survives blur removal, corrupt resources fail soft |
| Editor workflow | editor owner | existing `AdjustmentsPanel`/Mask/Selection surfaces, a leaf depth-mask section, source mapper | Model-free saved-map edit; pointer picker, keyboard controls, combine/refine workflow |
| Inference lifecycle | inference owner | `inferenceWorkerHost`, model adapter/verifier | Cancel one owner without terminating unrelated jobs; exact model provenance |
| Import/export | import/export owner | existing import/resource services and canonical codec | Supported profile only; bounded decode; numeric map and coverage export remain distinct |
| Website/docs | documentation owner | depth architecture, masking docs, website feature/tool pages, changelog | Copy reflects implemented/verified limits and does not imply metric/3D/matte parity |
| Validation | validation owner | engine/scene/editor tests, Playwright visual evidence and reports | Semantic + scalar + real UI evidence; save/reopen/export inspection |

All changes that touch dirty shared files must be selectively staged. No
worktree is created: the requested integration branch is the existing
`master` branch.

## Dependency-aware slices

### Slice 0 — evidence and regression fixtures

- Keep the research record and this plan current.
- Add rights-cleared scalar fixtures: constant-valid, all-invalid, hard
  boundary, slope, disconnected equal-depth regions, invalid hole, and
  transparent/source-alpha cases.
- Add a baseline report for the existing model adapter and do not promote the
  current sign self-consistency claim to a product guarantee.

### Slice 1 — canonical contract, coverage math and lifecycle safety

- Extend the existing depth resource metadata with explicit normalization
  provenance, source-to-map transform, validity policy and import/generation
  provenance while retaining v1 decode compatibility.
- Validate dimensions, lengths, finite scalar metadata and validity bytes
  before allocating/processing. Preserve constant-valid maps; reject all-
  invalid inference instead of manufacturing a successful mid-plane.
- Replace silent crossed-handle swapping with a shared range domain policy;
  expose float coverage plus the existing byte-mask adapter.
- Add independent near/far depth-domain transitions and spatial-feather
  parameters to the shared kernel. Use valid-only inversion and documented
  soft algebra (`replace`, product intersection, probabilistic union,
  `a*(1-b)` subtract).
- Add an owner-aware cancellation/discard path to the existing inference host;
  closing a panel may discard its result but may not dispose shared work.

### Slice 2 — reusable resources and re-editable mask recipes

- Add optional `RasterMaskData.depthRecipe` to the existing raster-mask owner;
  the recipe references a depth map, range/falloff, inversion, refinement and
  combine policy, coordinate binding, algorithm version and last-good asset.
- Keep resolved mask PNG bytes for fast/offline replay. A recipe is not
  inferred from a PNG's `method` or model metadata.
- Centralize depth-map references across blur effects, mask recipes, history
  snapshots and pending leases. Extend node removal, document closure,
  duplicate/paste and imported-resource remapping without deleting shared maps.
- Define replacement/crop/retouch/source-hash staleness. A failed replacement
  leaves the accepted map, resolved mask and manual correction intact.

### Slice 3 — standalone editor workflow

- Add a depth-mask section to the existing Photo/Adjustments/Mask flow, not a
  workspace. The ordered UI is map source → inspect → pick range → refine or
  combine → target → preview/commit.
- Provide model-free reuse of saved resources, explicit import status, source
  identity, relative/metric label, valid histogram, legend and coverage stats.
- Fix heatmap contain layout and pointer mapping; use the existing image
  coordinate mapper for canvas picks and reject clicks outside the displayed
  source.
- Reuse existing mask painting/lasso/segmentation/matting primitives with an
  explicit “Correct depth” versus “Refine coverage” target. Range changes do
  not erase correction strokes.
- Expose Replace/Intersect/Add/Union/Subtract with a safe preserving default,
  before/after/bypass/reset, Escape/cancel, keyboard range controls and
  accessible disabled reasons.

### Slice 4 — import, adjustment/selection integration and export

- Add a bounded, self-describing scalar import profile through the existing
  import service. The delivered first profile accepts only Varve's versioned
  16-bit little-endian payload; no unverified grayscale fallback is exposed,
  and browser `ImageData` is never presented as a generic 16-bit decoder.
- Require near/far convention, direct/inverse meaning, units, no-data policy,
  dimensions/orientation and source alignment before acceptance. Keep camera
  depth/EXR routes deferred until actual decoders and calibration paths exist.
- Use existing adjustment mask semantics to localize adjustments; zero depth
  coverage preserves the original scoped result. Selection conversion uses the
  same coverage kernel.
- Export appearance from a stable accepted revision without inference. Export
  coverage and numeric depth separately, with declared precision/validity and
  registration metadata.

### Slice 5 — quality, model and platform gates

- Re-run the exact pinned checkpoint with official/reference preprocessing and
  the shipped worker preprocessing. Change preprocessing or convention only
  when parity and real-photo boundary evidence support the change.
- Measure WASM/CPU/provider capability, model-sized memory, cold/warm latency,
  p50/p95 slider-to-preview, refinement, save/export and repeated
  generate/cancel/reopen leak behaviour on Linux desktop and browser targets.
- Evaluate guided/joint-bilateral refinement against no-refinement and simple
  baselines on hair, foliage, wires, texture and occlusion fixtures; no model
  replacement without verified licenses, hashes and quality evidence.

## Acceptance matrix

| Outcome | Semantic assertion | Numeric/geometry oracle | Actual UI/evidence |
|---|---|---|---|
| A: range → persistent mask | Node owns a depth recipe + resolved raster asset; source fill bytes unchanged | Boundary/feather/inversion/validity values match kernel | Picker, refine, apply, undo, save/reopen, inspect/export screenshot |
| B: localized adjustment + existing mask | Adjustment mask and node mask keep separate ownership and combine policy | Zero coverage is source identity; alpha is not multiplied twice | Existing-mask preservation and adjustment preview recording |
| C: model-free reopen/revise | No model/blur reference required; correction survives range change | Reopened coverage equals accepted precision bounds | Remove model, reopen project, revise/undo, screenshot |
| D: offline import | Profile and source/map transform persist; unsupported input is rejected visibly | Scalar round-trip and orientation/alignment fixtures | Import dialog status + offline apply/export evidence |
| E: shared resource lifetime | Blur removal/duplication/paste leaves referenced map and recipes reachable | Reachability graph and deterministic IDs | Duplicate, remove blur, replace source, save/reopen/export |

## Validation policy for this plan

The existing worktree already contains broad unrelated changes, so every
depth commit will run the affected planner and focused checks while preserving
unrelated staged entries. Because the depth recipe is a shared scene-schema
extension, the planner may escalate to the full gate; when it does, the
explicit reason will be recorded rather than silently omitting it.

Delivered focused evidence includes engine scalar tests, scene
codec/reachability tests, editor integration tests, a real Playwright pointer
workflow, a saved/reopened document, and independently parsed scalar export
bytes. The final run's inspected artifacts are recorded in
`reports/depth-aware-masking-2026-09-13/` and the implementation audit. A
normal-width contained heatmap and applied-canvas capture passed visual
inspection; narrow Inspector, Linux WebKitGTK, physical 4 GB/ARM, real-photo
boundary, and guided-filter comparisons remain release gates rather than being
claimed by this slice. Visual generation is not verification: each captured
artifact was opened and inspected for aspect ratio, full-map visibility,
source alignment, changed coverage, and preserved source pixels.

## Final delivery status

Implemented and verified: one canonical depth/validity contract; bounded
Varve scalar import/export; source-bound map alignment; shared range coverage
and soft combination; crop-aware standalone image and adjustment masks; existing Mask
refinement ownership; re-editable recipes with resolved last-good coverage;
save/reopen, undo/redo, duplicate/paste remapping, blur-independent reuse, and
owner-aware cancellation. Marketing and user guidance are limited to
relative-depth, depth-aware image editing and call out unsupported camera,
metric, arbitrary-image, video, matte, and 3D claims.

Deferred or unsupported: official Depth Anything preprocessing parity with the
worker transform; generated metric depth; arbitrary PNG/EXR/HEIC/camera-depth
decoding; full continuous-depth correction; video/frame reuse; guided or joint
bilateral quality evaluation; physical low-end measurements; and full matte or
3D reconstruction workflows.
