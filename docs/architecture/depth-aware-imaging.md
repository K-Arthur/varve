# Depth-aware imaging

Status: depth-mask workflow implemented on `master`; scalar contract, model
integrity, persistence, and browser workflow are covered by focused tests and
the depth-masking Playwright evidence dated 2026-09-13. Model/preprocessing
parity and low-end hardware performance remain explicit release gates.

This document records the repository audit and the contract for Varve's
depth-aware imaging foundation. It deliberately separates the user-facing
DepthMap concept from the model and inference runtime that creates it.

## Audit

### Existing infrastructure

- Model acquisition and verification are already centralized in
  `packages/engine/src/inference/`, with a manifest at
  `apps/desktop/public/models/manifest.json`, a bounded download manager, and
  an inference worker shared by depth, segmentation, denoise, and other model
  families.
- The depth candidate is an ONNX INT8 export of Depth Anything V2 Small. The
  manifest records a 518x518 RGB input, ImageNet normalization, relative-depth
  output, an Apache-2.0 source license, a pinned file hash, and the verified
  raw near/far convention. `validation.inferenceVerified` is true since
  2026-08-13, backed by `scripts/models/verify-depth-model.mjs` and the
  validation report in `apps/desktop/public/models/quantized/`.
- The reusable contract now lives in `packages/engine/src/depthMap.ts`.
  Runtime predictions are percentile-normalized into canonical `0 = near`,
  `1 = far` values, with validity, model provenance, source identity, and a
  versioned little-endian uint16 document payload. The inference adapter still
  needs a verified model-output parity fixture before the manifest can be
  promoted to a verified release state.
- `packages/engine/src/lensBlur.ts` builds several full-image Gaussian levels
  and chooses between them per pixel. This is useful as a prototype, but it is
  not sufficient for depth discontinuities: a foreground sample can bleed into
  a background sample across an occlusion boundary.
- Masks are already a distinct scene concept. Raster mask payloads are
  document-level PNG assets referenced by `RasterMaskData`; that representation
  is semantic coverage and is not suitable as a continuous depth field.
- Images use content-addressed `DocumentAsset` entries. This is the appropriate
  persistence boundary for depth payloads as well: large scalar data must not
  be embedded repeatedly in normal node JSON.
- Effects are typed scene values and are lowered through
  `sceneNodeToEngineNode` into the shared Canvas2D replay and export paths.
  Existing layer/background blur effects do not have access to a depth resource.
- The editor integration keeps generation in the existing “Depth Blur” panel,
  and exposes a separate “Depth Mask” section in the existing Adjustments
  surface. The latter can reuse a saved map, import a bounded `.vdepth.json`
  resource, inspect a valid-only heatmap/histogram, sample near/far values, and
  commit a source-aligned mask without enabling blur. Rendering and editing use
  the saved resource and resolved mask bytes; neither requires the model.
- A depth mask may target an image layer or a source-image-bound adjustment
  layer. The adjustment's scope still answers **what** is processed and its
  depth mask answers **where** the result is visible. The existing Mask section
  and `RefineMaskTool` remain the coverage-refinement owner.
- Browser inference is routed through the same worker abstraction. Saved
  raster/image assets already render without a model, so persisted depth must
  follow that rule; generation may remain capability-gated where the runtime is
  unavailable.

## Decision for the first vertical slice

Retain the existing ONNX worker as the first backend. It is the only candidate
already wired into the application, has a CPU/WASM-compatible path, and avoids
introducing a second tensor runtime before quality and parity data exist.

Candle plus safetensors remains a research candidate, not an implementation
dependency. Safetensors is a weight container, not an inference engine; a
Candle implementation would still require a maintained ViT/DPT graph,
preprocessing parity, and cross-runtime validation. No evidence in the current
repository justifies that maintenance cost yet.

The backend contract is model-independent:

```text
DepthEstimationBackend
  capabilities()
  load()
  estimate(image, options, cancellation)
  unload()

DepthPrediction
  width, height, values, validRegion
  depthType = relative | metric
  unit = normalized | metres | unknown
  nearFarConvention
  modelMetadata, preprocessingMetadata
```

The selected v1 semantics are relative normalized depth with `0 = near` and
`1 = far`. Downstream effects consume this canonical convention and never rely
on the raw sign or range emitted by a particular model.

## Target architecture

```text
Image asset + source revision
        |
        v
Depth estimation backend (lazy, cancellable, bounded)
        |
        v
Persisted DepthMap resource (float16/uint16-equivalent scalar field)
        |
        +--> Depth Blur effect
        +--> Depth Range -> Mask
        +--> future atmospheric/lighting/parallax consumers
```

Depth maps will be stored as a document-level resource with source identity,
model/preprocessing provenance, normalized near/far semantics, dimensions, and
an encoded scalar payload. The model is a creation/regeneration dependency, not
a render dependency. A missing or corrupt resource must produce a controlled
warning and a regeneration action, never prevent a document from opening.

Depth Blur is non-destructive and uses the existing depth-aware
gather/composite strategy with premultiplied alpha. Depth-range masking does
not reuse blur focus or blur inversion: it evaluates the shared coverage
kernel and commits through the existing raster-mask owner.

## Implemented contract

- `DepthMapResource.schemaVersion` is currently `1`; scalar data is persisted
  as uint16 little-endian values encoded in base64, with an optional validity
  payload and optional metric measurement payload. Unsupported or corrupt
  resources are reported and the last resolved raster coverage remains
  available where one was saved, so the renderer can fail soft and keep source
  pixels visible.
- `depthBlur` is a scene effect with a `depthMapId`, focal depth, focus range,
  blur strength, falloff, inversion, edge protection, and visibility. Scene
  normalization clamps numeric fields, while engine lowering attaches the
  document resource only when it is present.
- The Canvas2D replay path resizes the resource to the compositor surface and
  applies a premultiplied-alpha depth-aware gather with explicit occlusion
  rules (see below). The Inspector preview calls the same canonical gather
  with the same near-is-low map and options, rather than adapting through the
  legacy 8-bit lens-blur API. Model-space letterbox padding is removed before
  the map is aligned to the source image. The focus picker uses a robust local
  median, not a single potentially noisy model pixel.
- Replay decodes persisted maps through a small LRU bounded by both entry count
  and decoded byte size; resource identity includes payload metadata so a
  regenerated map cannot reuse stale decoded samples.
- Depth Range → Mask is implemented as a non-destructive layer mask: the
  existing Adjustments surface evaluates near/far endpoints, independent
  depth-domain transitions, valid-only inversion, and soft Replace,
  Intersect, Union, or Subtract coverage through the shared kernel. It commits
  a `RasterMaskAsset` through the same `commitRasterMask` path used by
  background removal, so masks participate in existing immutable-asset and
  undo semantics.
- The mask keeps a `RasterMaskData.depthRecipe` beside its resolved PNG. The
  recipe records the accepted map id, source node/fill identity, range,
  transitions, inversion, combine mode, algorithm version, and a correction
  asset when a later coverage edit is made. Changing the range does not rerun
  inference; Replace intentionally starts a fresh range, while a combine mode
  can rebase against the saved correction.
- Removing Depth Blur no longer removes an accepted map: explicit resource
  deletion owns pruning, so a map referenced by a mask recipe remains
  available. Duplicate/paste remap source, map, mask, and recipe ids together.
  Document closure includes map references from effects and recipes.
- The compact generic Effects picker does not create an empty `depthBlur`
  placeholder. Depth Blur is entered through the image workflow, where a
  validated DepthMap resource is generated or loaded before the effect is
  saved.

## Depth mask workflow

The supported workflow stays inside existing editor surfaces:

1. Select an image and open **Adjustments → Depth Mask**, or select an
   adjustment layer and choose its bound source image.
2. Choose a generated/saved resource, or import Varve's self-describing
   `.vdepth.json` file. A resource must declare canonical near-is-low ordering,
   dimensions, precision, validity, and (when present) source registration.
3. Inspect the contained heatmap, valid-sample histogram, legend, and constant/
   invalid status. **Sample near** and **Sample far** read the displayed map,
   not the viewport or image luminance; clicks in contain bars are ignored.
4. Set numeric near/far endpoints and separate near/far depth transitions.
   Crossed endpoints are visibly rejected. Apply with Replace, Intersect,
   Add/Union, or Subtract. Applying never enables Depth Blur and never changes
   source image pixels.
5. Use the existing **Mask** surface and `RefineMaskTool` to paint coverage.
   A coverage correction is retained independently enough for supported range
   edits. Correcting depth itself remains a separate future correction layer;
   the shipped workflow does not pretend that painting coverage edits the
   continuous field.

Only `.vdepth.json` is currently accepted by the scalar import control. PNG,
EXR, HEIC portrait metadata, Android Dynamic Depth, and arbitrary grayscale
images are not silently interpreted as depth because the required sample
precision, no-data, orientation, calibration, and registration contracts are
not implemented for those inputs. Exporting a scalar resource is distinct from
exporting a colorized heatmap or a binary/soft coverage mask.

## Model verification (2026-08-13)

The pinned artifact is `depth_anything_v2_small_int8.onnx` (27,258,801 bytes,
SHA-256 `01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001`)
from `onnx-community/depth-anything-v2-small` (Apache-2.0, converted from the
official Depth-Anything-V2-Small checkpoint, also Apache-2.0).

`scripts/models/verify-depth-model.mjs` is the reproducible gate. It verifies
the checksum, introspects the ONNX contract, and runs deterministic fixtures
through the same documented preprocessing (letterbox 518x518, ImageNet
normalization, NCHW). Results are recorded in
`apps/desktop/public/models/quantized/depth-anything-v2-small-validation-report.json`.

Verified facts:

- Input tensor is `pixel_values`; output tensor is `predicted_depth` with dims
  `[1, 518, 518]`. The manifest's contract now records exactly this; the
  editor reads the last two output dims so `[1, 1, H, W]` exports also work.
- The raw near/far convention of this export is **nearIsHigh** on the
  two-plane and portrait fixtures, but the perspective-corridor fixture
  measures **nearIsLow**. The current adapter records the raw convention as
  provenance and canonicalizes using the verified production adapter choice; it
  does not claim that a self-consistency score can infer a correct per-photo
  sign. Users have an explicit range inversion control when the estimate needs
  review. This remains a model-quality/review limitation, not a reason to
  silently flip saved maps.
- Outputs are NaN/Inf-free across the corpus; a flat uniform input yields a
  finite, stable mid-plane.
- The checked-in report records 264,582 ms cold, 279,404 ms warm p50, and
  361,144 ms warm p95 for its three-fixture CPU run, while older prose in that
  report says 9.8/13.6/20.2 s. The two records conflict; no product latency
  claim is based on either until the report is regenerated with a known ORT
  version. A single model run is still treated as heavyweight, worker-backed,
  and cancellable; map editing/import/reopen/export remain model-free.
- Fixture metrics are deliberately modest (Spearman rho 0.31 on the two-plane
  fixture, 0.27 on the corridor): synthetic flat-color scenes are a pessimistic
  case for a model trained on real imagery. The gate thresholds target
  regressions (NaN, sign flips, degenerate output, contract drift), not peak
  synthetic accuracy.

## Depth Blur compositor

`applyDepthBlur` in `packages/engine/src/lensBlur.ts` is a depth-aware gather
with two occlusion rules at depth discontinuities:

1. A sample farther than the center pixel never contributes — its light path
   is blocked by the center pixel's own (nearer) surface. This prevents the
   halos produced by choosing independent Gaussian levels per pixel.
2. A sample nearer than the center pixel contributes only when its own plane
   is out of focus (its blur radius is at least 1 px). An in-focus plane keeps
   its light on its own pixels, so a sharp subject does not smear into the
   blurred background; an out-of-focus near plane still produces foreground
   bokeh.

The gather is premultiplied-alpha; transparent samples never contribute
colour, and alpha edges interpolate in premultiplied space to avoid fringes.

Depth resampling renormalizes only valid neighbours, so missing model samples
cannot pull the field toward an arbitrary zero or mid-plane. Letterboxed model
outputs are unpadded using the worker's returned transform before source-space
resampling; stretching the padded square over a portrait or landscape image
would shift every focus boundary.

Sources above ~0.5 MP are gathered at a reduced scale (premultiplied bilinear
round trip) so full-resolution renders stay bounded: the occlusion rules are
scale-invariant because they operate on normalized depth. Spatial weights are
precomputed per frame rather than recomputed per sample.

Fixtures in `lensBlur.test.ts` cover: uniform-plane drift, far-plane rejection
at a near edge, sharp-subject-into-background rejection, foreground bokeh
allowance, background-into-foreground rejection, alpha-edge transparency, and
the downscaled path.

## Verified, deferred, and unsupported

Verified in the implementation slice: canonical scalar validation and
round-trip, valid-only range coverage and soft combination, contained preview
geometry, source-bound image and adjustment masks, recipe persistence and
correction ownership, owner-aware cancellation, duplicate/paste reference
remapping, model-free saved-map use, scalar export, and real Chromium UI
interaction. Deferred: official-vs-worker preprocessing parity, real-photo
boundary quality corpus, guided/joint-bilateral refinement evaluation,
Linux WebKitGTK and physical 4 GB/ARM measurements, and stale-resource
policies for every RAW/retouch/warp variant. Unsupported for now: arbitrary
PNG/EXR/HEIC/Android/iOS depth import, metric generated depth, video/frame
reuse, full continuous-depth correction, and 3D reconstruction.

Marketing copy says “relative depth” and “depth-aware” rather than implying
metric 3D, a perfect matte, or optical-lens equivalence.

## Known limitations

- Depth is **relative**, not metric. No effect should present values as
  physical distances. The DepthMap model marks `depthType: 'relative'` and
  `unit: 'normalized'` so no consumer can accidentally label raw values as
  metres.
- Monocular depth estimation struggles with transparent objects, reflections,
  mirrors, ambiguous scale, flat graphic artwork, unusual perspective, very
  fine geometry, and scenes with weak depth cues. Generated depth is a
  creative estimate, not ground truth 3D geometry.
- Depth range masks isolate geometry by distance; they are not semantic
  subject selection. "Select Subject" remains object-selection
  infrastructure, not monocular depth.
- The INT8 export is CPU-quantized; edge quality on very fine structures
  (hair, fur, thin wire) is weaker than the FP32 checkpoint, which the
  project traded for a ~27 MB download and bounded memory.
- The blur compositor is a gather approximation: far-plane bokeh that is
  partially occluded by a mid-plane object is suppressed rather than
  re-composited, which is the intended edge-protection behaviour but is not
  a full optical simulation.

## Implementation record

The depth-aware masking slice was delivered incrementally on `master`:

- `af8ea7501` — scalar contract, validity, normalization, range kernel, and
  serialization tests.
- `6b2f693c3` — recipe ownership, codec reachability, and owner-aware
  inference cancellation.
- `d1df45b8d` — reusable standalone range-mask workflow and editor surface.
- `e8d9331c7` — restoration of concurrent pen-tool files after the standalone
  workflow commit exposed an unrelated shared-index overlap.
- Follow-up commits record source registration/alpha validity, persistence and
  clipboard remapping, browser evidence, and the documentation/website copy.

The exact final commit list and validation results are recorded in
`docs/audits/depth-aware-masking-implementation-2026-09-13.md`. The workflow
is intentionally integrated into Mask/Selection/Adjustments and Depth Blur;
there is no separate Depth workspace or competing resource manager.
