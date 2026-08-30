# Effects surfaces audit

**Date:** 2026-08-29
**Status:** implementation follow-through recorded in `e13d39248`, the
follow-up preview transaction change, and the curated Studio catalog in
`cdcff9556` / `be5257604`

## Scope

This audit investigates the overlap between Effect Studio, Image Tuning,
Object Filters, and Adjustment Filters. It covers catalog ownership, preset
intent, raster/vector behavior, frontend discovery, persistence, and preview
semantics.

## Findings before the repair

The repository already had one shared `AdjustmentKind` and one renderer, which
was the right technical foundation. The product surfaces were not separated
enough at discovery time, however:

- `ADJUSTMENT_KINDS` was effectively presented as the menu vocabulary for
  Object Filters and Adjustment Layers.
- Effect Studio's first registry also described the complete adjustment
  vocabulary, so a user could encounter photographic corrections beside
  creative treatments without a clear reason.
- Image Tuning was curated in code, but its boundary was communicated mostly
  by placement rather than an explicit engine-owned surface contract.
- Preview and Compare View used ordinary document updates. A cancelled
  preview could therefore dirty state or be observed by persistence before it
  was restored.
- Raster and vector behavior was not consistently explained at the point of
  discovery.

## Product decision

The surfaces now have these responsibilities:

| Surface | Primary job | Default audience | Raster behavior | Vector behavior |
| --- | --- | --- | --- | --- |
| Effect Studio | Explore creative visual language | Designers exploring a look | Render the image object into the effect pipeline; retain source fill, placement, crop, and alpha | Render a temporary surface; retain editable geometry, fill, text, and transform |
| Image Tuning | Correct and finish photographs | Photo and general design workflows | Operate on image-local pixels in a batch-friendly workflow | Hidden for vector selections; do not imply photo controls are vector geometry edits |
| Object Filters | Control one object's ordered effect stack | Advanced users and precise object finishing | Render selected result with per-entry order, opacity, blend, and mask | Render vector result while retaining source geometry and object editing |
| Adjustment Filters | Correct a backdrop or scoped group | Tonal and colour correction across content | Process content below the layer using scope and mask | Composite after vector content enters the backdrop; source vectors remain editable |

Some operator overlap is intentional. Contrast can be a photo-local control,
a backdrop correction, or an advanced object filter depending on scope. That
is different from duplicating every creative effect in every menu.

## Implemented catalog split

`packages/engine/src/effectRegistry.ts` now owns these explicit sets:

- `EFFECT_STUDIO_KINDS`: creative object-local effects such as Duotone, Color
  Halftone, Dither, Bloom, Lens Flare, CRT, and VHS.
- `IMAGE_TUNING_KINDS`: photographic globals plus the seven image-treatment
  operators.
- `ADJUSTMENT_LAYER_KINDS`: backdrop correction operators and Halftone; the
  image-only finishing family is no longer offered as a new layer correction.
- `OBJECT_FILTER_KINDS`: the full `ADJUSTMENT_KINDS` advanced escape hatch.

`packages/engine/src/surfacePresets.ts` keeps recipes in the engine so the
frontend cannot accidentally make three independent preset catalogs. The
families are:

- 34 creative Studio treatments, each combining at least two effects and
  grouped as Illustrative, Mark Making, Optics & Shift, Drawing & Graphic,
  Light & Signal, or Print & Material;
- four photographic Image Tuning recipes; and
- four backdrop correction recipes.

The frontend now renders those families in their respective sections and
applies them through the existing scene mutation paths. Existing entries are
updated rather than duplicated by Image Tuning when a preset targets an
unambiguous existing kind. Ambiguous repeated entries are left for Object
Filters, where order and identity are visible.

## Frontend behavior

Effect Studio provides a visual treatment gallery, searchable creative cards,
outcome-oriented category filters, saved and recent treatments, transient
preview, Compare View, direct treatment controls, an Applied treatments list,
and document Looks. Its expanded Drawing & Graphic and Light & Signal families
each contain at least eight distinct recipes. A collapsed Individual creative
effects section keeps the raw creative primitives available without presenting
them as a duplicate general-purpose filter menu.

Applied Studio recipe members carry bounded treatment identity metadata. The
Studio is the canonical place to tune named recipes, including Varve's
Reticulation (blue-noise clustered dither plus seeded material grain). The raw
Object Filters editor is now explicitly advanced and collapses for curated
recipes. Editing, reordering, hiding, or removing a recipe member marks that
recipe Customized; the user can restore just that coherent recipe or continue
with the advanced stack. Duplicated raw members become standalone entries.

Tracking remains data-led rather than UI-led: Object Filters retain individual
filter ids plus their ordered owner-local stack; Studio provenance groups
members by the pair of treatment id and instance id; applying a Look rebases
both filter and treatment-instance identities. Adjustment Layers retain a
separate scene-node identity, individually addressed correction entries, and a
serialised scope/mask. Their editor can reorder, bypass, duplicate, and remove
entries without losing which scoped correction the user is editing.

Properties no longer renders the full Object Filters editor. It keeps compact
navigation to Effect Studio and adjustment-layer creation; Appearance & Effects
is the sole full Studio/Object Filter home. Adjustments remains either the
raster-only Image Tuning surface or the selected Adjustment Layer editor.
Layer Effects is named separately for shadows, glows, and blur. The Object
menu, command palette, and **Ctrl/Cmd+Alt/Option+A** provide a direct Effect
Studio route; **New Adjustment Layer** continues to open Adjustments after
creation.

Image Tuning provides image-only groups, photo presets, batch updates, mixed
value handling, per-parameter reset, and bypass. It is intentionally not
rendered for mixed or vector selections.

Adjustment Filters provides correction presets above the existing scoped layer
controls and keeps its add menu limited to the correction catalog. Existing
unknown future entries remain visible and reorderable as unavailable entries;
they are not silently dropped during normalization.

## Preview and persistence finding

The editor transaction API now accepts `beginTransaction('preview')`.
Preview updates still enter React document state so the canvas can respond,
but they do not mark the document dirty, increment the document revision,
publish a mutation, or add an undo snapshot. Commit performs those actions once;
abort restores the exact snapshot. Effect Studio uses this for both effect
previews and Compare View.

## Research basis

The boundary follows established conventions while keeping Varve's own model:

- Adobe's [Filter Gallery overview](https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filter-gallery.html)
  describes a discovery gallery with preview, thumbnails, settings, and an
  applied-filter list across Artistic, Brush Strokes, Distort, Sketch,
  Stylize, and Texture categories.
- Adobe's [non-destructive editing overview](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html)
  separates adjustment layers, Smart Filters, and retouch layers by editing
  intent and persistence behavior.
- Adobe's [Smart Filters guidance](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)
  establishes editable, hideable, reorderable filter stacks and filter masks.
- Adobe's [adjustment-layer options](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html)
  treats tonal and colour correction as a separate family from creative
  filters.
- Lightroom's [Develop adjustments](https://helpx.adobe.com/ca/lightroom-classic/help/applying-adjustments-develop-module-basic.html)
  and [Develop tools](https://helpx.adobe.com/uk/lightroom-classic/help/develop-module-tools.html)
  support the Image Tuning boundary: global tone/colour, detail, vignette,
  and grain are photographic development controls with nondestructive
  before/after comparison.

These sources informed the separation of intent and interaction, not copied
labels, layouts, or implementation.

## Remaining validation boundary

The repository has focused unit and frontend tests for the catalog split,
preset recipes, surface discovery, unknown entries, preview cancellation, and
transaction ordering. Full cross-platform visual parity and screen-reader
verification still require the platform-specific gates listed in
`docs/quality/validation-strategy.md`.
