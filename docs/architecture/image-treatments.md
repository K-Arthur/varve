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
| Fine local texture | Fine Texture | `microDetail` |
| Medium local structure | Local Contrast | `definition` |
| Broad local depth | Atmospheric Depth | `atmosphere` |
| Atmospheric-veil recovery | Dehaze | `dehaze` |
| Edge lighting | Vignette | `edgeFalloff` |
| Highlight diffusion | Highlight Glow | `softBloom` |

The names describe the photographic result, not an external product's
terminology or layout. Product research informed the compact grouping,
neutral-centered sliders, advanced disclosure, and non-destructive bypass;
it did not supply a copied UI, preset collection, or implementation.

## 1. Existing capability matrix

| Capability | Curated Image Tuning | Object Filters | Adjustment Layer | Canvas/export | Save/undo | Alpha | Web + desktop |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exposure, contrast, shadows/highlights | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Temperature, tint, vibrance, saturation | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Fine Texture | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Local Contrast | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Atmospheric Depth | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Dehaze | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Vignette | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Grain | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |
| Highlight Glow | Yes | Yes | Yes | Shared CPU compositor | Yes | Preserved | Yes |

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
`updateNodes()` document update and one history transaction. This is a
discoverability choice, not a raster-only limitation: **Object Filters** can
apply every treatment to any compatible rendered object, including a vector
rectangle, text, frame, or group. For the common vector cases, Appearance →
Object Filters begins with an **Object Finishing** quick-add row for Grain,
Vignette, and Highlight Glow. An adjustment layer can use exactly the same
kind and parameters when the user needs scope, an adjustment mask, explicit
targets, or document-wide compositing.

There is no per-image-fill treatment attachment. An Object Filter receives the
fully rendered node result: image placement, crop, frame clipping, fills, and
node masks have already contributed to that result. Users who need ordered
duplicates, per-entry blend/opacity, group semantics, or an advanced stack use
**Object Filters** instead of the quick tuner.

## 3. Choosing and using a treatment

Choose the surface based on the result's scope, then choose the operator based
on the photographic or material result you want:

| Goal | Treatment | Start with | Notes |
| --- | --- | --- | --- |
| Bring out or soften the smallest visible texture | Fine Texture | Fine Texture | Negative values soften; **Smooth-Area Protection** prevents nearly flat areas from becoming noisy. |
| Give medium-sized surfaces more separation | Local Contrast | Local Contrast | Use **Detail Size** to choose the scale; lower it before using Fine Texture for a less crunchy result. |
| Shape broad depth without treating it as haze removal | Atmospheric Depth | Atmospheric Depth | This is broad local contrast, not a synonym for Dehaze. |
| Cut through real atmospheric veil or washed-out distance | Dehaze | Dehaze | It estimates a local veil and reconstructs bounded transmission; protect skies and lamps with **Highlight Protection**. |
| Darken or brighten an object's edges | Vignette | Vignette Amount | Negative amounts darken edges; positive amounts lighten them. Adjust Midpoint, Feather, Shape, and Centre only when needed. |
| Make a digital object or photo feel less sterile | Grain | Grain Amount | **Grain Size** sets feature size, **Grain Roughness** changes fine-versus-clustered structure, and **Pattern Variation** chooses a repeatable pattern. |
| Add a soft halo around bright parts | Highlight Glow | Glow Amount | Lower **Highlight Threshold** for mid-tone material; increase **Glow Size** before raising amount for a gentler result. |

For a 50%-opacity gray vector rectangle, select the rectangle, open
**Appearance → Object Filters**, and use **Object Finishing → Grain**. This
adds a node-local filter; it does not flatten the rectangle or change its fill
or object opacity. Tune Grain Amount first, then Grain Size and Grain
Roughness. The same quick-add row offers Vignette and Highlight Glow. All
treatments remain available through **Add Object Filter** when a less common
operator is intentional; photo-local controls can simply have little or no
visible effect on a uniform flat fill.

Use Object Filters when an effect belongs to one object, including order,
per-entry opacity, blend mode, and repeated entries. Use an Adjustment Layer
when the same effect must be scoped across several objects or masked over a
backdrop. In either route, turning a treatment off bypasses it without
discarding its values.

## 4. Parameter schemas and interaction

`packages/engine/src/imageTreatments/schema.ts` is the single schema for the
new treatment controls. It owns stable kind ids, display labels, descriptions,
neutral defaults, min/max range, normal/fine steps, units, and advanced status.
It is consumed by:

- adjustment defaults and `FilterIR` lowering;
- the document normaliser, which clamps malformed saved values to the schema;
- the Image Tuning control generator; and
- the advanced Object Filter / Adjustment Layer editor.

The Image Tuning groups are **Light**, **Color**, **Detail**, **Local Contrast
& Depth**, and **Finish**. Common controls stay visible. Each treatment owns
its own labelled control group and an **Advanced [treatment] settings**
disclosure, so Vignette controls never appear under Grain's advanced controls
and labels such as Grain Roughness retain their effect context.

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

## 5. Treatment algorithms

All new kernels operate on straight RGBA8 `ImageData`; their neutral defaults
are byte-identical identity operations.

| Treatment | Independent algorithm | Neutral / alpha behavior |
| --- | --- | --- |
| Fine Texture | Small alpha-weighted local-luminance residual with a noise floor and edge mask | Amount `0` is identity; visible-pixel RGB only |
| Local Contrast | Difference between small and medium alpha-weighted local averages; highlight and large-edge protection limit halos | Amount `0` is identity; visible-pixel RGB only |
| Atmospheric Depth | Broad local-luminance residual, tapered in nearly flat gradients and highlights | Amount `0` is identity; visible-pixel RGB only |
| Dehaze | Alpha-weighted local dark-channel veil estimate with bounded atmospheric-light inversion and a transmission floor | Amount `0` is identity; visible-pixel RGB only |
| Vignette | Smooth, aspect-aware elliptical edge weighting with midpoint, feather, roundness, centre, and highlight protection | Amount `0` is identity; visible-pixel RGB only |
| Grain | Seeded integer hash plus fractal noise; Grain Roughness blends fine noise with clustered structure | Amount `0` is identity; visible-pixel RGB only |
| Highlight Glow | Compact wrapper over Varve's existing linear-light bright-pass, soft-knee, pyramid-blur Bloom kernel | Amount `0` is identity; original alpha and hidden RGB are restored |

Fine Texture, Local Contrast, and Atmospheric Depth intentionally manipulate
local luminance rather than relabelling a global contrast or generic blur
control. Negative Fine Texture and Local Contrast reduce their local component;
negative Atmospheric Depth softens broad depth. Dehaze is separate: it models
a local atmospheric veil and never claims to be the broad-depth operator.
Vignette uses negative Vignette Amount to darken and positive amount to
lighten. Grain is monochrome, deterministic, and seeded; Grain Roughness
changes structure rather than only amplitude.

## 6. Coordinate, crop, and bounds rules

Temporary filter surfaces are not semantic coordinate systems. The renderer
passes an `ImageTreatmentSpace` with a pixel-to-treatment affine transform,
semantic bounds, and raster density:

- direct Object Filters map capture pixels into the rendered object's local
  coordinates, including its affine transform and rotation;
- scoped Adjustment Layers map capture pixels into document coordinates;
- radii are expressed in treatment units and multiplied by raster density, so
  preview zoom and export density preserve the intended scale;
- Vignette normalises against semantic object/scope bounds, never viewport
  bounds; and
- Grain samples the stable mapped point, never frame time, viewport pixels, or
  `Math.random()`.

Consequently panning and zooming do not make Grain crawl or Vignette move.
Export supplies `quality: 'export'` through structured replay and the same
treatment-space mapping as preview. Filters with neighbourhood sampling
register their expansion in the adjustment pipeline so cropped structural
surfaces reserve room before filtering.

## 7. Colour, alpha, and platform policy

The current shared adjustment backend is a Canvas2D software compositor using
straight-alpha RGBA8 image data. Fine Texture, Local Contrast, Atmospheric
Depth, Dehaze, Vignette, and Grain compute their perceptual luminance
operation in the current encoded-sRGB-style raster domain. Highlight Glow's
bright-pass and diffusion use the established linear-light Bloom
implementation. This is deliberate rather than a claim of a new wide-gamut or
HDR pipeline.

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

## 8. Verification contract

Focused tests cover:

- neutral identity, finite/range safety, alpha preservation, hidden-RGB
  protection, deterministic Grain, Dehaze veil recovery, rotated Vignette, and density-stable
  radii in `imageTreatments/kernels.test.ts`;
- kind/default/lowering and persistence normalisation in engine and scene
  tests;
- Image Tuning batching, Mixed values, parameter-local reset, bypass, and
  transaction cancellation in the inspector tests;
- adjustment-layer reachability through the common stack editor; and
- actual Chromium workflows that prove a photographic treatment and a
  50%-opacity vector Object Finishing treatment change canvas pixels, bypass
  cleanly, and preserve the source object's editable state.

The browser workflow writes ignored review captures under
`reports/ui-review/image-tuning/`. Review the fitted-photo capture, not a
zoomed-in centre crop: it visibly exercises the semantic image edges. Layer-row
thumbnails remain intentionally simplified by the broader thumbnail subsystem;
they do not claim full structural adjustment-layer parity.

## 9. Extension rules

- Add a future treatment once: schema, `Adjustment` union/defaults, `FilterIR`,
  software dispatch, effect contract/expansion metadata, normalisation, UI,
  and focused tests.
- Never add a separate Image Lab document model or a CSS-only preview.
- Preserve Object Filter order, entry visibility, opacity, and blend mode;
  Image Tuning must continue to defer ambiguous/repeated stacks to Object
  Filters.
- A future accelerated backend must match these semantic operators and pass
  alpha/coordinate/export golden tests before becoming a rendering path.
