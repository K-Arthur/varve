# ADR-0225: Effect Studio integrates the existing effect pipeline

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Varve already has a shared adjustment/filter pipeline, node-local Object
Filters, scoped Adjustment Layers, appearance effects, native and GPU
accelerators, and raster export fallbacks. A new gallery-specific model would
duplicate document state and make preview, export, and undo diverge.

## Decision

1. Effect Studio is a discovery/editor surface over the existing `Adjustment`
   and `FilterIR` contracts.
2. `effectRegistry.ts` is the canonical catalog for raw Effect Studio primitive
   metadata. It derives definitions from the existing stable adjustment kinds,
   defaults, effect contracts, and capability properties.
3. Object Filters remain node-local; Adjustment Layers remain scoped scene
   nodes; appearance effects remain a separate appearance-stage model.
4. The persisted stack is the execution order. Reordering is a document
   operation and is undoable; transient candidate previews are not saved.
5. Canvas2D/CPU remains the correctness fallback. Native and WebGPU paths are
   accelerators only and cannot change serialized semantics.
6. Looks are ordered, validated recipes, not raster snapshots or executable
   imports.
7. **surfacePresets.ts** owns named, outcome-oriented Studio treatment recipes.
   Those recipes may compose shared primitives without promoting photographic
   correction controls into the Studio's primary discovery vocabulary.
8. A persisted Studio treatment carries bounded identity and direct-control
   metadata on its Object Filter members. The metadata does not affect
   rendering; it lets the Studio tune a named recipe and report when advanced
   edits have made that recipe customized.
9. The Appearance & Effects workspace is the single full Studio/Object Filter
   editor. Properties retains compact navigation and adjustment-layer creation;
   Adjustments owns Image Tuning and selected Adjustment Layer editing.
10. Filter-entry identity, Studio treatment provenance, and Adjustment Layer
    scope remain separate persisted concerns. Creation, duplication, and Look
    application mint fresh appropriate ids instead of using a stack index as
    identity.

## Consequences

- The expanded UI can present a curated treatment gallery while sharing the
  existing Inspector editors and history.
- Adding an effect requires catalog metadata plus the existing engine/render
  wiring; it does not require another menu list or renderer.
- Preview and export can be tested against the same semantic render graph.
- The registry is a compatibility surface and must be tested for complete
  coverage of **ADJUSTMENT_KINDS**.
- Users can combine curated and raw work without losing provenance: advanced
  edits remain editable but cannot masquerade as an untouched named treatment.

## Component and render flow

```mermaid
flowchart TD
  Registry[Canonical effect registry] --> Library[Effect Library]
  Library --> Preview[Transient preview transaction]
  Preview --> Stack[Object Filter / Adjustment Layer stack]
  Stack --> Contract[Adjustment -> FilterIR]
  Contract --> Replay[CPU / Canvas2D replay]
  Contract --> Accel[Native or WebGPU accelerator]
  Replay --> Export[Full-quality export]
```

## Rejected alternatives

- A separate gallery-only filter model: duplicates persistence and rendering.
- Making every treatment an Adjustment Layer: loses object-local semantics.
- GPU-only preview: unavailable on the primary WebKitGTK environment and not
  a safe correctness boundary.
- Persisting preview state: risks autosave and stale-target mutations.
