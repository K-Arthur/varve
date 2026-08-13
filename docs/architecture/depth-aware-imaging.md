# Depth-aware imaging

Status: vertical slice implemented; model integrity, contract, and inference
ordering verified (2026-08-13); final visual gate pending E2E/visual review

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
- The editor integration is now a “Depth Blur” panel. It can download/load the
  local model, generate and inspect a reusable map, pick a focus value from the
  depth preview, and save a typed effect plus document-level resource. Rendering
  uses the saved map and does not require the model. Source hashes invalidate a
  saved map when the underlying image asset changes.
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

Depth Blur will be non-destructive and will use a depth-aware gather/composite
strategy with premultiplied alpha. The implementation must include explicit
foreground/background boundary fixtures; a clean Gaussian level blend is not a
substitute for occlusion handling.

## Implemented contract

- `DepthMapResource.schemaVersion` is currently `1`; scalar data is persisted
  as uint16 little-endian values encoded in base64, with an optional validity
  payload. Unsupported or corrupt resources are left in the document so the
  renderer can fail soft and keep the source pixels visible.
- `depthBlur` is a scene effect with a `depthMapId`, focal depth, focus range,
  blur strength, falloff, inversion, edge protection, and visibility. Scene
  normalization clamps numeric fields, while engine lowering attaches the
  document resource only when it is present.
- The Canvas2D replay path resizes the resource to the compositor surface and
  applies a premultiplied-alpha depth-aware gather with explicit occlusion
  rules (see below). The Inspector preview remains a bounded image preview.
  The focus picker is intentionally explicit about sampling the depth
  preview, not promising a camera-space 3D measurement.
- Depth Range → Mask is implemented as a non-destructive layer mask: the
  Inspector converts a depth range (near/far/feather/invert) into a
  `RasterMaskAsset` through the same `commitRasterMask` path used by
  background removal, so masks participate in the document's existing
  immutable-asset and undo semantics.
- Removing the Depth Blur effect drops depth resources that are no longer
  referenced by any node effect.

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
- The raw near/far convention of this export is **nearIsHigh** (nearer pixels
  have higher raw values). `normalizeDepthPrediction` is called with
  `nearFarConvention: 'nearIsHigh'` and every persisted map is canonical
  nearIsLow (0 = near, 1 = far). The manifest records the raw convention so a
  future model swap cannot silently invert the field.
- Outputs are NaN/Inf-free across the corpus; a flat uniform input yields a
  finite, stable mid-plane.
- Measured on the verification machine (Intel workstation, 8-core, CPU-only,
  under unrelated load): ~9.8 s cold first pass, ~13.6 s warm p50, ~20.2 s
  warm p95 for a three-fixture pass at 518x518. A single 518x518 pass is the
  dominant cost of one DepthMap generation; generation is worker-backed and
  cancellable, so it does not block editing.
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

Sources above ~0.5 MP are gathered at a reduced scale (premultiplied bilinear
round trip) so full-resolution renders stay bounded: the occlusion rules are
scale-invariant because they operate on normalized depth. Spatial weights are
precomputed per frame rather than recomputed per sample.

Fixtures in `lensBlur.test.ts` cover: uniform-plane drift, far-plane rejection
at a near edge, sharp-subject-into-background rejection, foreground bokeh
allowance, background-into-foreground rejection, alpha-edge transparency, and
the downscaled path.

## Known release gates

The remaining gates before claiming the backend is production-ready: CPU/WASM
measurements in the shipped runtime, depth-edge visual fixtures on real
photos, transparent PNG fixtures, save/reopen without the model, export
parity, cancellation/stale-job E2E, and browser/mobile-sized Inspector
screenshots. Marketing copy says "relative depth" and "depth-aware" rather
than implying metric 3D or optical-lens equivalence.

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

## Planned commit sequence

1. `test(depth): add depth-map fixtures and backend contracts`
2. `feat(depth): add normalized reusable DepthMap resources and cache keys`
3. `feat(effects): add non-destructive depth-aware blur compositor`
4. `feat(editor): add Depth Blur generation, focus picker, and preview`
5. `feat(depth): verify model integrity, contract, and inference ordering`
6. `test(depth): add visual, E2E, and performance coverage`
7. `docs(depth): document runtime, persistence, limitations, and workflow`
8. `feat(website): market depth-aware effects with verified claims`
