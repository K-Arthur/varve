# Image Treatments

**Status:** current · **Related:** [Non-Destructive Effects](non-destructive-effects.md), [Render Pipeline](render-pipeline.md), [Colour Management](colour-management.md), [Image Geometry](image-geometry.md)

Image Treatments is Varve's compact, non-destructive photographic-adjustment
workflow. It deliberately builds on the existing `Adjustment` / `FilterIR`
contract rather than adding a separate photo document or a second raster
pipeline.

The product language is intentionally independent from serialised identifiers:

| Product surface | User-facing term | Stable internal identifier |
| --- | --- | --- |
| Feature family | Image Treatments | shared `Adjustment` / `FilterIR` pipeline |
| Curated inspector | Image Tuning | `image-tuning` section id |
| Fine local texture | Micro Detail | `microDetail` |
| Medium local structure | Definition | `definition` |
| Broad local depth | Atmosphere | `atmosphere` |
| Edge lighting | Edge Falloff | `edgeFalloff` |
| Highlight diffusion | Soft Bloom | `softBloom` |

The names describe the photographic result, not an external product's
terminology or layout. Product research informed the compact grouping,
neutral-centered sliders, advanced disclosure, and non-destructive bypass;
it did not supply a copied UI, preset collection, or implementation.

## 1. Existing capability matrix

| Capability | Curated Image Tuning | Object Filters | Adjustment Layer | Canvas/export | Save/undo | Alpha | Web + desktop |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exposure, contrast, shadows/highlights | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Temperature, tint, vibrance, saturation | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Micro Detail | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Definition | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Atmosphere | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Edge Falloff | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Grain | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Soft Bloom | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |

The first two rows existed before Image Treatments. The curated UI makes the
common global tone/colour operators discoverable beside the new local and
finishing treatments; it does not duplicate their implementation.

## 2. One model, two attachment semantics

`Adjustment` is the serialised parameter union. `ADJUSTMENT_KINDS` is lowered
through `adjustmentToFilter()` into portable `FilterIR`, and
`applyFilterWithCompositing()` is the authoritative Canvas2D CPU path.

```text
Image Tuning / Object Filters / Adjustment Layer editor
                         │
                         ▼
                 Adjustment (serialised intent)
                         │
                         ▼
                      FilterIR
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
NodeBase.smartFilters          AdjustmentNode.adjustments
object-local result             scoped backdrop result
          └──────────────┬──────────────┘
                         ▼
              shared software compositor
                         ▼
                 Canvas preview / export
```

Image Tuning is a deliberately curated object-local surface. It appears only
when every selected node is an image shape; mixed image/vector/text selections
do not silently apply a treatment to a subset. A batch edit emits one
`updateNodes()` document update and one history transaction. An adjustment
layer can use exactly the same kind and parameters when the user needs scope,
an adjustment mask, explicit targets, or document-wide compositing.

There is no per-image-fill treatment attachment. An Object Filter receives the
fully rendered node result: image placement, crop, frame clipping, fills, and
node masks have already contributed to that result. Users who need ordered
duplicates, per-entry blend/opacity, group semantics, or an advanced stack use
**Object Filters** instead of the quick tuner.

## 3. Parameter schemas and interaction

`packages/engine/src/imageTreatments/schema.ts` is the single schema for the
new treatment controls. It owns stable kind ids, display labels, descriptions,
neutral defaults, min/max range, normal/fine steps, units, and advanced status.
It is consumed by:

- adjustment defaults and `FilterIR` lowering;
- the document normaliser, which clamps malformed saved values to the schema;
- the Image Tuning control generator; and
- the advanced Object Filter / Adjustment Layer editor.

The Image Tuning groups are **Light**, **Color**, **Detail**, **Presence**, and
**Finish**. Common controls stay visible; secondary radius, protection,
position, character, seed, and threshold controls live in the group's
**Advanced** disclosure.

Every row supplies a labelled range input, a keyboard-operable numeric field,
an explicit Reset button, and a text On/Off bypass button. Reset affects only
that parameter, so resetting Shadows does not overwrite Highlights. A new
treatment entry is created only after a non-neutral change. An absent neutral
treatment is functionally enabled; explicitly turning it off stores an
invisible neutral entry so bypass always preserves intent. If a stack contains
multiple entries of the same kind, the quick control is disabled with a clear
message rather than guessing which ordered entry to mutate.

Pointer and range-keyboard gestures use `beginTransaction()` /
`commitTransaction()` so a scrub is one undo item. Escape or pointer
cancellation calls `abortTransaction()`. `NumberField` retains its established
typed-expression validation and keyboard transaction behavior. The Inspector's
selection lock guard prevents mutation for a locked selection.

## 4. Treatment algorithms

All new kernels operate on straight RGBA8 `ImageData`; their neutral defaults
are byte-identical identity operations.

| Treatment | Independent algorithm | Neutral / alpha behavior |
| --- | --- | --- |
| Micro Detail | Small alpha-weighted local-luminance residual with a noise floor and edge mask | Amount `0` is identity; visible-pixel RGB only |
| Definition | Difference between small and medium alpha-weighted local averages; highlight and large-edge protection limit halos | Amount `0` is identity; visible-pixel RGB only |
| Atmosphere | Broad local-luminance residual, tapered in nearly flat gradients and highlights | Amount `0` is identity; visible-pixel RGB only |
| Edge Falloff | Smooth, aspect-aware elliptical edge weighting with midpoint, feather, roundness, centre, and highlight protection | Strength `0` is identity; visible-pixel RGB only |
| Grain | Seeded integer hash plus fractal noise; Character blends fine noise with clustered structure | Strength `0` is identity; visible-pixel RGB only |
| Soft Bloom | Compact wrapper over Varve's existing linear-light bright-pass, soft-knee, pyramid-blur Bloom kernel | Strength `0` is identity; original alpha and hidden RGB are restored |

Micro Detail, Definition, and Atmosphere intentionally manipulate local
luminance rather than relabelling a global contrast or generic blur control.
Negative Micro Detail and Definition reduce their local component; negative
Atmosphere softens broad depth. Edge Falloff uses negative Strength to darken
and positive Strength to lighten. Grain is monochrome, deterministic, and
seeded; `Character` changes structure rather than only amplitude.

## 5. Coordinate, crop, and bounds rules

Temporary filter surfaces are not semantic coordinate systems. The renderer
passes an `ImageTreatmentSpace` with a pixel-to-treatment affine transform,
semantic bounds, and raster density:

- direct Object Filters map capture pixels into the rendered object's local
  coordinates, including its affine transform and rotation;
- scoped Adjustment Layers map capture pixels into document coordinates;
- radii are expressed in treatment units and multiplied by raster density, so
  preview zoom and export density preserve the intended scale;
- Edge Falloff normalises against semantic object/scope bounds, never viewport
  bounds; and
- Grain samples the stable mapped point, never frame time, viewport pixels, or
  `Math.random()`.

Consequently panning and zooming do not make Grain crawl or Edge Falloff move.
Export supplies `quality: 'export'` through structured replay and the same
treatment-space mapping as preview. Filters with neighbourhood sampling
register their expansion in the adjustment pipeline so cropped structural
surfaces reserve room before filtering.

## 6. Colour, alpha, and platform policy

The current shared adjustment backend is a Canvas2D software compositor using
straight-alpha RGBA8 image data. Micro Detail, Definition, Atmosphere, Edge
Falloff, and Grain compute their perceptual luminance operation in the current
encoded-sRGB-style raster domain. Soft Bloom's bright-pass and diffusion use
the established linear-light Bloom implementation. This is deliberate rather
than a claim of a new wide-gamut or HDR pipeline.

Every new treatment preserves the original alpha channel. Fully transparent
pixels keep their hidden RGB, and alpha-weighted local sampling avoids a black
or white matte leaking in from transparent neighbours. Varve currently retains
embedded profile metadata but does not run these generic adjustments in an
ICC-managed floating-point working space; HDR/extended-range processing is not
claimed by Image Treatments.

The interactive web and desktop paths share this CPU reference implementation.
New treatments do not pretend to have native, WASM, WebGL, or WebGPU kernels;
when the compositor encounters filters it uses the Canvas2D island/reference
path on both platforms. This is functional parity, not a temporary visual
approximation.

## 7. Verification contract

Focused tests cover:

- neutral identity, finite/range safety, alpha preservation, hidden-RGB
  protection, deterministic Grain, rotated Edge Falloff, and density-stable
  radii in `imageTreatments/kernels.test.ts`;
- kind/default/lowering and persistence normalisation in engine and scene
  tests;
- Image Tuning batching, Mixed values, parameter-local reset, bypass, and
  transaction cancellation in the inspector tests;
- adjustment-layer reachability through the common stack editor; and
- an actual Chromium workflow that imports a photo, fits it to the viewport,
  applies Edge Falloff, checks a canvas change, bypasses it byte-for-byte, and
  verifies Micro Detail undo.

The browser workflow writes ignored review captures under
`reports/ui-review/image-tuning/`. Review the fitted-photo capture, not a
zoomed-in centre crop: it visibly exercises the semantic image edges. Layer-row
thumbnails remain intentionally simplified by the broader thumbnail subsystem;
they do not claim full structural adjustment-layer parity.

## 8. Extension rules

- Add a future treatment once: schema, `Adjustment` union/defaults, `FilterIR`,
  software dispatch, effect contract/expansion metadata, normalisation, UI,
  and focused tests.
- Never add a separate Image Lab document model or a CSS-only preview.
- Preserve Object Filter order, entry visibility, opacity, and blend mode;
  Image Tuning must continue to defer ambiguous/repeated stacks to Object
  Filters.
- A future accelerated backend must match these semantic operators and pass
  alpha/coordinate/export golden tests before becoming a rendering path.
