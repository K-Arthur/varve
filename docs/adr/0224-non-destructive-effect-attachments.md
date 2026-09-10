# ADR-0224: Separate Object Filter attachments from Adjustment Layer scopes

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Varve already represents non-destructive colour and raster effects with the
`Adjustment` parameter union and portable `FilterIR`, but the product has two
different authoring intentions: changing one rendered object, and changing a
resolved backdrop of several objects. Treating those as one attachment model
would either make a local filter unexpectedly affect siblings or make a
backdrop adjustment impossible to order and scope in the scene tree. Parallel
lists of effect kinds in the scene package and editors also made future kinds
liable to drift.

Image nodes already retain an original asset reference separately from their
scene placement, crop, transforms, masks, and effects. A Photoshop-style Smart
Object abstraction would imply linked/embedded nested documents and relinking
semantics that the current document model does not implement.

## Decision

1. **Use one canonical filter language.** `ADJUSTMENT_KINDS`, `Adjustment`,
   `adjustmentToFilter()`, `FilterIR`, the effect contract, and the CPU
   reference compositor are shared. Optional native and WebGPU paths are
   accelerators with CPU fallback, not alternate serialised semantics.

2. **Keep Object Filters node-local.** Persist entries on renderable nodes in
   the existing `smartFilters` field and expose them in product UI as **Object
   Filters**. The persistence name remains stable for documents and callers.

3. **Keep Adjustment Layers as scene nodes.** An `AdjustmentNode` carries an
   `AdjustmentScope` (`image-local`, `explicit-targets`,
   `container-descendant`, or `document`) and optionally a spatial mask. It
   cannot target itself or a parent that contains it.

4. **Use shared cropped-mask replay.** Live canvas and export project mask
   geometry from document/device coordinates into the cropped adjustment
   surface using its region origin. This preserves mask alignment away from
   document origin and gives both paths the same masking semantics.

5. **Do not add Smart Content yet.** Existing image asset references provide
   non-destructive raster placement and effects. Introduce a dedicated content
   source abstraction only when nested editable documents, external linking,
   relinking, or independent embedded-source editing is an explicit product
   requirement.

## Consequences

- Users can distinguish a local Object Filter from a scene-scoped Adjustment
  Layer without learning an implementation term.
- All effect kinds have one validation and editor catalogue, eliminating a
  class of unsupported-but-selectable or serialisable-but-uneditable effects.
- Adjustment scope remains deterministic, serialisable, and safe across
  deletion, copy/paste repair, and malformed hand-authored documents.
- Raster, SVG, and PDF export retain one structured replay semantic before
  choosing the smallest supported raster fallback.
- Per-entry masks and Smart Content are consciously deferred rather than
  silently approximated by a different persistence model.

## Follow-up gates

- Before adding a filter kind, cover its alpha/colour contract, effect-bound
  expansion, CPU fallback, and export classification.
- Before adding Smart Content, approve a separate ADR covering provenance,
  nested-document ownership, link recovery, lifecycle, cache identity, undo,
  and export.
- Any change to scope or mask replay must exercise live browser canvas and
  structured export with a non-origin cropped target.
