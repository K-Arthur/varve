# Effect Studio

**Status:** current architecture · **Date:** 2026-08-29

Effect Studio is Varve's discovery surface for object-local creative effects.
It is a Filter Gallery-style way to explore, preview, and apply designed
visual treatments. It is not a second renderer, a second effect model, or a
replacement for the advanced Object Filters stack.

## Product boundary

Varve has four related surfaces with different jobs:

| Surface | Scope | Catalog | Raster behavior | Vector behavior |
| --- | --- | --- | --- | --- |
| Effect Studio | Object-local creative treatment | Illustrative, Mark Making, Optics & Shift, Drawing & Graphic, Light & Signal, Print & Material | Processes the rendered image object while preserving source fill, placement, and crop | Uses a temporary effect surface; geometry, fill, and text remain editable |
| Image Tuning | Image-local photographic correction | Light, Color, Detail, Local Contrast & Depth, Finish | Tunes image pixels with source and placement preserved | Not offered; use Object Filters or Effect Studio |
| Adjustment Filters | Backdrop-scoped tonal and colour correction | Correction operators and print-safe tonal tools | Applies to rendered content below the adjustment layer and its scope/mask | Applies after vector content is rendered into the backdrop; geometry remains editable |
| Object Filters | Advanced ordered object-local stack | Full `ADJUSTMENT_KINDS` escape hatch | Filters the selected rendered result with order, opacity, blend, and mask controls | Filters the rendered vector result while source geometry remains editable |

The same operator can intentionally appear in more than one surface when its
scope changes. For example, Contrast belongs in Image Tuning for image-local
photo work and in Adjustment Filters for a shared backdrop correction. It does
not make the surfaces equivalent. Effect Studio excludes photographic
correction controls and the Image Tuning workflow from its primary discovery
catalog. A Studio recipe can still compose a shared primitive such as Grain or
Highlight Glow when that primitive is needed to create a material result on a
rendered raster or vector object; the recipe does not expose that primitive as
an image-development control.

## Architecture

```mermaid
flowchart LR
  ES[Effect Studio] --> OF[Object Filter stack]
  IT[Image Tuning] --> OF
  AL[Adjustment Filters] --> AN[Adjustment Layer]
  OF --> A[Adjustment entries]
  AN --> A
  A --> IR[adjustmentToFilter / FilterIR]
  IR --> CPU[CPU reference compositor]
  IR --> GPU[Optional WebGPU accelerator]
  IR --> Native[Optional native provider]
  CPU --> Canvas[Canvas2D replay]
  CPU --> Export[Raster export fallback]
```

`packages/engine/src/effectRegistry.ts` owns the shared definition metadata.
`packages/engine/src/surfacePresets.ts` owns the three discovery recipe
families. The scene owns attachment, order, identity, and persistence. The
renderer owns execution. No UI surface creates a parallel effect list.

## Effect Studio catalog

Effect Studio exposes 34 named treatment recipes across six outcome-oriented
families. The labels intentionally describe the result rather than reproduce a
generic filter-menu taxonomy:

| Family | Treatments | What it helps a designer do |
| --- | --- | --- |
| Illustrative | Palette Cut, Pigment Wash, Inked Paper, Screen Print | Turn an object into a limited-palette illustration, wash, or print response. |
| Mark Making | Dry Ink, Crosshatch, Ink Wash, Sprayed Stroke | Build drawn marks, hatching, ink, and loose sprayed media. |
| Optics & Shift | Glass Shift, Ocean Ripple, Refracted Light, Prism Flare | Refract, split, ripple, or optically scatter the rendered result. |
| Drawing & Graphic | Relief Study, Chalk Field, Pencil Poster, Stamp Cut, Graphic Pen, Dot Study, Paper Copy, Contour Dither | Produce graphic drawing studies without pretending the source has become destructive pixels. |
| Light & Signal | Chromatic Bloom, Cinema Shafts, Neon Phosphor, Light Leak, Aperture Star, Laser Streak, Solar Shift, Terminal Glow | Add luminous, cinematic, electronic, or surreal light behaviour. |
| Print & Material | Analog Signal, Newsprint, Riso Ink, Water Paper, Worn Tape, Reticulation | Give an object a printed, fibrous, weathered, taped, or irregular surface language. |

Each card represents an ordered recipe of two or more editable effects. The
card art is a category cue rather than a pre-rendered promise: the canvas
Preview command is the authoritative visual result for the selected object.
Apply appends the full recipe in one batch update; it does not flatten artwork
or alter source geometry.

The gallery has search, category filters, saved treatments, recent treatments,
preview/keep/cancel, and Compare View. A collapsed **Individual creative
effects** section retains the thirteen raw Studio primitives for users who
already know the operator they want. It explicitly directs parameter editing,
order, masks, and blending to Object Filters instead of creating a second
stack editor.

## Treatment identity and direct controls

A Studio treatment is more than a coincidental sequence of operators. Each
recipe member persists a bounded **studioTreatment** record containing its
treatment id, instance id, recipe index, and intent-level control values. The
renderer ignores that record; it exists so the Studio can find an applied
recipe without making a user hunt through a long raw stack.

The owner still keeps the executable truth: every Object Filter has its own
stable filter id and occupies one position in the ordered `smartFilters`
array. Studio grouping uses the **pair** of treatment id and instance id, so
an imported or legacy instance-id collision cannot merge unrelated named
treatments. Applying a Look gives every filter a fresh id and every treatment
instance a fresh instance id. Copying one raw member deliberately clears its
Studio provenance; it becomes an ordinary independent filter.

The **Applied treatments** list is therefore the canonical place to tune a
named result. It exposes a small set of coherent controls rather than every
primitive parameter. Every recipe has Amount, and relevant treatments add at
most two safe outcome controls. For example, Varve's **Reticulation** is a
blue-noise clustered dither followed by seeded material grain. Its controls
are Amount, Cluster density, Tone steps, and Material grain. It is a
Varve-native irregular-tone/material treatment, not a claim to reproduce
another application's implementation.

The raw Object Filter stack remains fully editable, but it is an advanced
escape hatch:

- it is collapsed when an object has a named Studio recipe;
- a raw parameter, visibility, opacity, blend, reorder, or removal change
  marks every remaining member of that recipe **Customized**;
- the Applied treatments list continues to show that result honestly and can
  restore only that recipe to a coherent named form; and
- duplicating one raw member creates a standalone raw filter rather than
  pretending that a partial duplicate is a second named recipe.

This keeps freeform experimentation possible without silently relabelling a
user's modified stack as the original treatment.

Adjustment Layers use a separate identity domain. The `AdjustmentNode` owns a
sequential `adjustments` array whose entries each have a collision-resistant
id, while `scope` and any adjustment mask stay on the layer node. Reordering
therefore changes only correction execution order; changing scope changes only
which rendered backdrop is fed to the same stack. It never changes the source
object or turns an Adjustment Layer into an Object Filter.

## Shared rendering contract

The stack array is execution order: entry 0 runs first, then each later entry
receives the previous result. Object Filters and Adjustment Layers share the
`Adjustment`, `adjustmentToFilter()`, `FilterIR`, CPU compositor, bounds,
alpha, and export contracts. Their attachment semantics remain separate.

Preview quality may reduce resolution or sample count, but it uses the same
semantic FilterIR path as settled preview and export. Export requests full
quality and never consumes a thumbnail or interaction proxy.

All registered effects preserve source alpha. Neighbourhood and light effects
declare whether bounds expand, and the adjustment pipeline reserves that
space before filtering. Deterministic effects retain their stable seed and do
not sample frame time or viewport pixels.

## Preview and Compare View

Effect previews use a preview transaction. The document state can render the
candidate effect immediately, but preview updates do not mark the document
dirty, publish a remote mutation, or create undo history. Add/Enter commits one
undoable document edit; Cancel/Escape restores the exact pre-preview state.

Compare View uses the same preview transaction to temporarily bypass the
object stack. Showing the original therefore does not persist a
`smartFiltersEnabled` change and does not create an undo entry. Changing the
selection or leaving the surface cancels the transient comparison.

## Looks

Looks are document-local declarative recipes of stable effect IDs, ordered
parameters, enabled state, opacity, and blend mode. Applying a Look appends
new entries to Object Filters; it never stores a flattened image. A Look that
contains a named Studio treatment receives fresh treatment instance IDs on
every application, so two applications never merge into one Applied treatment
row. A missing or future definition remains an unavailable recipe entry, so an
older build does not silently delete content when it loads or reorders a newer
stack.

## Workflow homes and entry points

The UI deliberately separates a compact contextual entry point from the
full-sized editors:

| Surface | What is shown there | What is deliberately not duplicated |
| --- | --- | --- |
| **Properties** | Normal opacity/blend controls, **Open Effect Studio**, and **Add adjustment layer** for eligible selection | The Object Filter stack and Studio gallery |
| **Appearance & Effects** | Canonical Effect Studio gallery, Applied treatments, advanced Object Filters, and Layer Effects | Image-local Image Tuning and adjustment-layer editing |
| **Adjustments** | Image Tuning for raster selection, or the complete Adjustment Layer editor when an adjustment node is selected | Creative Studio treatments and an object-local raw stack |

**Object → Open Effect Studio** and the command palette open the canonical
Appearance & Effects workspace. **Ctrl/Cmd+Alt/Option+A** is the keyboard
route. **Object → New Adjustment Layer** (and **Alt/Option+N**) creates a
scoped Adjustment Layer and then opens Adjustments with the new layer
selected.

The desktop app can detach the Inspector as a whole. That preserves the
existing panel transfer/lifecycle contract while keeping Effect Studio active
in the detached Inspector tab. A separately detachable Studio window is
intentionally deferred until it has an independent panel definition, local
state codec, and auxiliary-window renderer; a second ad-hoc popup would make
selection synchronization and preview transactions unreliable.

## Raster and vector rules

Effect Studio, Object Filters, and Adjustment Filters operate on rendered
surfaces where the selected result requires it. This does not make a vector
node destructive: path geometry, text, fills, and transforms remain in the
scene model and can still be edited. A user who needs a filter to follow one
object chooses Object Filters or Effect Studio. A user who needs one correction
to affect several objects chooses an Adjustment Layer. A user editing a photo's
global tone, detail, or finishing balance chooses Image Tuning.

## Verification boundaries

Verified in the repository:

- surface catalogs and category IDs are engine-owned and tested;
- each surface has explicit raster/vector guidance;
- Studio treatments are non-empty, surface-specific, categorized, and include
  multi-effect recipes;
- Effect Studio, Image Tuning, Adjustment Filters, and Object Filters have
  focused frontend coverage for discovery, application, direct treatment
  tuning, customization/restoration, bypass, and unknown future entries; and
- preview and Compare View use the transaction contract without dirtying a
  cancelled preview.

Not claimed by this document: native Windows/macOS runs, screen-reader runs,
WebGPU availability on WebKitGTK, or cross-browser visual parity. Those need
the platform-specific gates in the validation strategy.
