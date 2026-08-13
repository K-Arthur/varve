# Depth-aware imaging

Status: vertical slice implemented; model parity and final visual gate pending (2026-08-13)

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
  output, an Apache-2.0 source license, and a pinned file hash. The manifest's
  `inferenceVerified` flag is currently false, so parity evidence remains a
  release gate rather than an assumption.
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
  applies a premultiplied-alpha depth-aware gather. Samples farther than the
  center pixel plus the edge-protection threshold are rejected, preventing the
  most obvious background bleed across a foreground boundary.
- The Inspector preview remains a bounded image preview. The focus picker is
  intentionally explicit about sampling the depth preview, not promising a
  camera-space 3D measurement. A future canvas-integrated picker can reuse the
  same canonical `sampleDepth` contract.

The first slice does not claim metric depth, calibrated optical behavior, or
verified model quality. Those claims remain release gates.

## Known release gates

Before claiming the backend is production-ready, the following evidence is
required: trusted-upstream parity on multiple images, verified checksum and
provenance, CPU/WASM measurements, depth-edge visual fixtures, transparent PNG
fixtures, save/reopen without the model, export parity, cancellation/stale-job
tests, and browser/mobile-sized Inspector screenshots. Marketing copy must say
“relative depth” and “depth-aware” rather than imply metric 3D or optical-lens
equivalence.

## Planned commit sequence

1. `test(depth): add depth-map fixtures and backend contracts`
2. `feat(depth): add normalized reusable DepthMap resources and cache keys`
3. `feat(effects): add non-destructive depth-aware blur compositor`
4. `feat(editor): add Depth Blur generation, focus picker, and preview`
5. `test(depth): add visual, E2E, and performance coverage`
6. `docs(depth): document runtime, persistence, limitations, and workflow`
7. `feat(website): market depth-aware effects with verified claims`
