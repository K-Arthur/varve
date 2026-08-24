# Layers, compositing, and nondestructive editing audit — 2026-08-23

## Scope

This audit records the repository state inspected for the Layers workflow brief
and the stability work delivered in this pass. The brief is treated as
competitive capability research, not as a requirement to reproduce another
product's UI or implementation.

The current system already has a substantial Layers implementation. This pass
prioritizes document integrity and mutation safety because those are shared by
the Layers tree, canvas, export, persistence, masks, effects, and components.
Advanced workflows that do not yet have a complete editor command and UI path
remain explicitly deferred rather than being presented as complete.

## Initial audit

Already present in the repository:

- A single `Document.nodes` scene graph with stable node IDs and ordered
  `rootChildren`/container `children` arrays.
- Shape, text, path, frame, group, table, raster-layer, and adjustment nodes.
- Page content roots, global children, master/component structures, and
  selection sets.
- Pure scene operations for add, insert, move, arrange, reparent, group,
  ungroup, rename, delete, and duplicate workflows.
- A virtualized Layers tree with incremental flattening/search support,
  keyboard navigation, ARIA tree semantics, multi-selection, bulk actions,
  rename protection, thumbnails, filters, DnD drop intent, and relationship
  indicators.
- Canonical structural, vector, raster, live-matte, and effect-mask models.
  These are intentionally not collapsed into one generic “mask” flag.
- Canvas2D structural replay for masks, isolated groups, group opacity/blend,
  adjustment scopes, object filters, and live effects; export has separate
  capability/preflight and raster-fallback paths.
- Embedded source assets, nondestructive image crop/mask metadata, per-node
  export presets, codegen emitters, and print/PDF capability reporting.
- Regression coverage for Layers UI, masks, DnD, pages, adjustment placement,
  save/reopen, export, accessibility, and visual workflows.

Important gaps found during archaeology:

- The shared document validator used recursive reachability and cycle checks,
  so pathological deep documents could overflow before the persistence layer
  could diagnose them.
- `addChild` could leave a newly added node in `rootChildren` while also adding
  it to a container, violating the one-structural-parent invariant.
- Deletion cleaned ordinary structural mask sources but did not consistently
  clean live matte sources, effect-mask sources, adjustment scopes, selection
  sets, layer-state captures, component definitions, or global-root membership.
- Component instance validation treated `FrameNode.componentId` as if it were
  itself a node ID. Component IDs actually resolve through
  `Document.components`, whose definition then points to `masterRootId`.
- The repository had a sparse Layer State model under active development. Its
  export, document-boundary normalization, Layers entry point, and editor
  commands were completed during this pass; the remaining limitation is the
  intentionally sparse capture scope rather than document duplication.

## Capability matrix

Status means the end-to-end contract, not merely the presence of a field.

| Capability | Model | Commands/ops | Layers UI | Canvas2D | WebGPU | Save/load | Import | Export/preflight | Tests |
|---|---|---|---|---|---|---|---|---|---|
| Hierarchy/pages | Complete | Complete | Complete | Complete | Partial | Complete | Partial | Complete | Complete |
| Reorder/reparent | Complete | Complete | Complete | Complete | N/A | Complete | Partial | Complete | Complete |
| Visibility | Complete | Complete | Complete | Complete | Partial | Complete | Partial | Complete | Complete |
| Locking | Complete (node-level) | Partial across tools | Complete | Partial policy-dependent | N/A | Complete | Partial | Complete | Complete |
| Opacity | Complete | Complete | Inspector | Complete | Partial | Complete | Partial | Complete | Complete |
| Blend modes | Complete catalog | Complete | Inspector | Complete with fallback paths | Partial | Complete | Partial | Partial, preflighted | Complete |
| Group isolation/pass-through | Complete | Complete | Complete | Complete | Partial | Complete | Partial | Partial | Complete |
| Structural/vector/raster masks | Complete | Complete | Complete | Complete | Partial | Complete | Partial | Partial, capability-driven | Complete |
| Clipping relationships | Complete | Complete | Complete | Complete | Partial | Complete | Partial | Partial | Complete |
| Adjustment scopes | Complete | Complete | Inspector | Complete | Partial | Complete | Partial | Partial, preflighted | Complete |
| Live effects/filter stacks | Complete | Partial for all stack actions | Partial disclosure | Complete for supported effects | Partial | Complete | Partial | Partial, preflighted | Complete |
| Source-preserving images | Embedded source + transforms/crop | Partial | Partial | Complete | Partial | Complete | Partial | Partial | Partial |
| Selection sets | Complete | Complete | Complete | Session selection | N/A | Complete | Partial | N/A | Complete |
| Layer States | Partial: sparse stable-ID model | Complete capture/apply/rename/duplicate/delete/recapture commands | Complete entry point and section | Complete as pure document application | N/A | Complete after normalization | N/A | N/A | Unit, component, and workflow coverage |
| Solo View | Complete node flag + hierarchical effective visibility | Complete | Complete row toggle and exit affordance | Complete through render-pipeline document projection | Partial | Complete | Partial | Complete Canvas2D path | Unit + workflow coverage |
| Selection Paint / saved area selections | Complete analytical/raster selection model | Complete quick-mask, save/restore/delete, path conversion, alpha/luminance source actions | Partial command-palette/menu path; dedicated panel remains optional | Complete area-selection overlay and mask consumers | N/A | Complete bounded serialization | Partial | N/A | Unit coverage; E2E pending |
| Per-node export presets | Complete | Complete | Complete in Spec/Export UI | Complete | Partial | Complete | Partial | Complete/preflighted | Complete |
| Developer handoff/codegen | Complete for supported emitters | Complete | Complete in Codegen panel | N/A | N/A | Complete | Partial | Complete with warnings | Complete |
| Reveal Through/Punch Through | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred |

The matrix deliberately distinguishes Canvas2D from WebGPU. WebGPU is an
opt-in backend/scaffold with explicit capability boundaries; unsupported
compositing must not silently become normal blending.

## Delivered stability work

### Scene graph and persistence invariants

- Reachability validation is iterative rather than recursive.
- Parent-cycle detection uses the existing explicit-stack traversal for both
  direct callers and the complete document validator.
- Deep malformed containers are diagnosed instead of causing a validator crash.
- Root arrays and container child arrays detect duplicate IDs, missing IDs, and
  root/child double ownership.
- Mask validation now checks both structural and live matte node references and
  reports invalid direct-child relationships for container masks.
- Component validation resolves component definitions and their master roots,
  rather than assuming component IDs are scene node IDs.

### Mutation safety

- `addChild` now adopts an existing root/nested node atomically, removing its
  old structural membership and rejecting self/descendant cycles.
- `reparentNode` and `removeNode` clean global-root membership as well as page
  roots.
- `removeNode` traverses descendants iteratively and releases deleted-node
  references from masks, live mattes, effect masks, adjustment scopes, slots,
  selection sets, saved Layer State captures, and invalid component instances.
- Component definitions whose master root is deleted are removed, and their
  remaining instances are detached rather than left broken.

### Layer States

Layer States use stable IDs and sparse maps for visibility, transforms, and
appearance. They do not clone the document. Applying a stale state skips IDs
that no longer exist; document normalization filters malformed or duplicate
state entries. The model is persisted and included in canonical document key
ordering. The Layers panel now exposes capture, apply, rename, duplicate,
delete, and recapture actions; it remains Partial because capture is currently
sparse and does not yet offer per-category inclusion controls or a conflict
report for large document changes.

### Solo View and selection workflows

Solo is a reversible node flag. The render pipeline projects effective
visibility without mutating stored visibility, preserves the ancestor path of
soloed descendants, and keeps soloed containers traversable. The Layers panel
shows the active state and provides a single exit affordance.

Area selection now also has a registered Selection Paint tool, bounded image
alpha/luminance sources, path conversion, and named saved selections. Raster
payloads are validated and size-bounded at the document boundary; the
selection model remains separate from node Selection Sets.

## Competitive-reference translation and IP safeguards

| Reference problem | Varve interpretation | Decision |
|---|---|---|
| Saved layer configurations | Sparse Layer States keyed by node ID | Adapted independently; no document duplication |
| Smart filters | Existing ordered Live Effects/Object Filters | Reused canonical effect stack; no parallel filter system |
| Layer/vector/raster masks | Existing mask union and effect-mask binding model | Preserved; not collapsed into one type |
| Asset generation | Existing per-node export presets and preflight | Reused structured export metadata |
| Copy CSS/code | Existing Codegen panel and emitters | Reused supported targets; no CSS-only special case |
| Knockout/punch-through | Explicit future compositing capability | Deferred until semantics and backend parity are defined |
| Multi-image compositing | General image stacking, masks, solo/compare, and alignment workflows | No portrait-specific feature added |

No proprietary source code, UI artwork, documentation prose, fonts, or
branded assets were copied. The implemented work uses standard scene-graph,
mask, compositing, and accessibility concepts and remains expressed through
Varve's existing architecture and design system. Legal questions about any
unusually specific future interaction remain a legal-review item rather than
an engineering claim.

## Remaining limitations and next milestones

- A mask-only diagnostic view should be added as session/viewport state; Solo
  is now implemented as a reversible persisted node flag with a non-mutating
  render projection.
- Lock inheritance/partial capabilities need one shared policy consumed by all
  tools; the current contract is primarily node-level locking.
- WebGPU blend/mask/effect support needs an explicit backend matrix and pixel
  fixtures before being advertised as parity.
- Layer States still need per-category capture controls, conflict reporting,
  and dedicated visual/E2E coverage beyond the combined layer workflow spec.
- Linked external assets are intentionally deferred; embedded source data is
  preserved today, but missing-file/relink semantics are not yet a product
  contract.
- Reveal Through/Punch Through remains deferred until isolation, masks,
  effects, opacity, and export semantics can be specified together.

These are product/architecture follow-ups, not reasons to weaken the current
document integrity guarantees.
