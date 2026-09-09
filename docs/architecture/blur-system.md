# Varve blur system

**Status:** canonical CPU reference implemented; spatial Inspector controls,
Canvas2D/WASM replay, and transform-safe authoring overlays wired (2026-09-08)

This document is the product and renderer contract for blur. It is intentionally
Varve-specific; Photoshop Blur Gallery is a behavioural reference, not a pixel
compatibility target.

## Public meanings

| Effect | Meaning | Authored geometry |
|---|---|---|
| Gaussian Blur | Uniform normalized Gaussian convolution over rendered content | `sigmaX`/`sigmaY` in source pixels |
| Layer Blur | Compatibility alias for a uniform content blur | Legacy `radius`, interpreted as 3σ support |
| Background Blur | Blur of already-rendered backdrop clipped by the owner | Legacy `radius`, separate backdrop stage |
| Field Blur | Continuous blur-radius field interpolated from value pins | Owner-local normalized pins; radii in source pixels |
| Iris Blur | Rotated elliptical focus region with a smooth outer falloff | Normalized center/radii and inner/feather ratios |
| Tilt-Shift Blur | Oriented sharp band with a smooth fade on either side | Normalized center, angle, sharp width, feather |
| Path Blur | Motion integration along an arc-length-sampled path | Stable path/point IDs and source-pixel motion amount |
| Spin Blur | Angular integration about a saved pivot inside a feathered ellipse | Normalized ellipse/pivot plus angle |
| Depth Blur | Occlusion-aware gather from a persisted relative depth field | `DepthMap` resource and focal interval |

Layer/background/depth blur remain distinct compatibility concepts. A backdrop
effect samples pixels behind the owner; a content effect samples the owner's
already-painted result. The Inspector may present them in one stack, but the
renderer retains the backdrop/content/appearance stage boundary.

## Coordinate and persistence contract

Spatial geometry uses `coordinateSpace: "owner-normalized"`: `x` and `y` are
fractions of the unpadded owner surface, and may be outside `0..1` for pins or
paths that intentionally control an off-canvas fade. Blur distances are in
owner/source pixels and are not scaled by viewport zoom or device-pixel ratio.

Every spatial entry carries a stable `id`, `visible`, `algorithmVersion`, and
stable IDs for pins, paths, points, and regions. No camera, DPR, proxy size,
worker job, hover state, or backend cache value is serialized. Scene
normalization clamps non-finite values, bounds array counts, repairs missing
defaults, and leaves unknown future effect types available to the compatibility
loader rather than allocating from untrusted input.

The Rust scene enum mirrors the wire variants and retains spatial geometry as
JSON at the native scene boundary. This keeps native open/save/bridge paths
forward-compatible while the TypeScript/WASM Canvas2D reference owns the
algorithm until a native parity implementation is verified.

## Math and color

The reference executor uses linear-light, premultiplied RGBA internally and
converts to/from the document's 8-bit Canvas2D surface once per effect. Gaussian
support is three standard deviations per axis and weights are normalized. A
zero axis is identity; fractional values are valid; non-finite and excessive
values are clamped before kernel creation.

Field Blur uses deterministic inverse-distance-squared interpolation. A pin is
exact at its authored position, results stay within the authored pin range and
`maxRadius`, and the `zero` outside-hull policy uses the pins' convex hull;
coincident pins resolve by the first exact stable sample. Iris
and Tilt-Shift evaluate smooth scalar fields; overlapping regions use the
maximum applicable radius, so the result is order-independent.

Path Blur samples the first non-empty path by arc length, not point index. Spin
Blur samples rotations around the authored pivot, scales the sweep by its
motion amount, and blends only inside the feathered ellipse. Both use
deterministic sample counts and return identity at zero motion. The current CPU
reference uses bounded nearest-source samples for motion integration; adaptive
quality tiers, multi-path blending, and restored grain remain future work.

## Footprints and execution

`spatialBlurSupport()` is the shared support-footprint authority for spatial
content effects. Replay allocates a padded surface from it, applies effects in
their content-stage order, then composites the result. Scene flatten bounds,
visual bounds, export capability planning, and group replay include the same
effect family. Masks are applied after each effect to the effect result using
the existing effect-mask contract.

The canonical executor is safe on Canvas2D, HTML-canvas fallback, worker replay,
export replay, and native/WebView environments without WebGPU or OffscreenCanvas.
Acceleration may change quality tier or speed only after parity fixtures are
available; it must not change authored meaning.

## Current limits and verification

The spatial blur family is authored through the Effects Inspector and direct
on-canvas controls. Field pins, Iris center/radius/rotation handles,
Tilt-Shift center/angle/feather handles, Path points, and Spin center/pivot/
radius/angle handles all use the same owner-local transform contract. Handles
are keyboard-nudgable and one pointer gesture is one history transaction.
Low-cost proxy scheduling, bokeh, restored grain, adaptive motion quality,
multi-path blending, and depth-map refinement remain future work. Depth Blur
remains the only blur with a full model-acquisition workflow; spatial controls
do not imply a downloaded model.

Focused mathematical coverage lives in
`packages/engine/src/spatialBlur.test.ts`; Gaussian threshold, fractional,
alpha, and DPR-sensitive compositor coverage lives in `blur.test.ts` and
`compositeCanvas.test.ts`. Browser visual validation must inspect the actual
Inspector/canvas result and export paths before promoting these controls to a
full release claim.
