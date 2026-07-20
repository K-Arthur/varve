# Clipping Mask and Advanced Blend Audit — 2026-07-19

## Scope and authority

This audit traces scene schema, parenting, affine transforms, Canvas replay,
native/WASM wire contracts, layers/actions, persistence, duplication, SVG/PDF/raster
export, and current tests. The compositing authority is W3C Compositing and
Blending Level 1. Product behavior was compared with current Adobe Illustrator,
Adobe Photoshop, and Sketch documentation.

The intended semantics are:

- clipping remains a persisted container/source relationship; source and content
  stay independently editable;
- only closed vector outlines supported by every active renderer are accepted as
  clipping paths;
- a default group is pass-through; Normal or a creative group mode establishes a
  compositing boundary;
- blend functions operate on straight colors, followed by source-over coverage;
- unsupported preview/export behavior is rejected or reported, never silently
  changed to Normal.

References:

- <https://www.w3.org/TR/compositing-1/>
- <https://html.spec.whatwg.org/multipage/canvas.html#compositing>
- <https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/create-clipping-masks.html>
- <https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html>
- <https://www.sketch.com/docs/designing/shapes/masking-shapes/>

## Existing foundations

- `@strata/scene` already persists clip, alpha, luminance, vector, and raster masks.
  Clipping groups use one direct child as the source and retain any number of content
  children.
- `CanvasArea` and structured raster export traverse the scene graph and apply masks,
  clipping, group opacity, and creative group modes.
- SVG codegen emits `clipPath`/`mask` definitions. PDF preflight rejects most structural
  mask/blend cases instead of silently changing appearance.
- `@strata/engine` contains a strict blend catalog and canonical W3C separable and
  non-separable formulas.
- Undo/redo uses document snapshots; the shared subtree clone correctly remaps masks.

## P0 defects confirmed

1. Clipping creation stored a world transform as a nested local transform, computed
   content locals without ancestor transforms, and baked rotation while retaining the
   old rotation field. Create/release/replace therefore drifted or double-rotated nodes.
2. Editor duplication and page duplication retained the original mask source ID.
3. Open paths, groups, and live text were advertised as clip sources although the
   Canvas outline tracer could not create a valid closed outline for them.
4. Compound-path hole rings were not traced, and source-node clipping ignored the
   persisted fill rule.
5. Disabled clip masks were excluded from structural identification and could not be
   released or repaired.
6. `CompositeCanvas` had regressed to a duplicate, incorrect partial-alpha formula;
   it omitted uncovered source contribution and a test encoded the wrong result.
7. Rust used lowercase blend enum IDs and snake_case node/effect fields while the
   TypeScript contract is camelCase, silently defaulting non-normal modes.
8. Clipping creation/release methods existed in editor context but had no action,
   command-palette, menu, or keyboard entry point.

## Corrected in the first milestone

- World-space invariance now holds across clipping create, release, and replacement,
  including transformed/rotated/skewed parents. Reparenting stores one composed local
  affine and resets the separately stored rotation to prevent double application.
- Object and page duplication remap internal mask and slot references.
- Creation accepts closed shape outlines and frames; unsupported open paths, groups,
  and live text must be outlined/combined first.
- Compound rings and `evenodd`/`nonzero` rules flow through interactive and structured
  Canvas clipping.
- Disabled clipping relationships remain structurally recognizable and releasable.
- Create/Release Clipping Mask are registered actions, Object-menu commands, command
  palette entries, and `Ctrl+7` / `Ctrl+Alt+7` shortcuts. The topmost compatible
  selected object is the deterministic mask source.
- Software pixel composition delegates to the canonical W3C compositor. Unknown and
  legacy unsupported modes throw instead of falling back to Normal.
- Rust scene, engine IR, and bridge fields use TypeScript-compatible `blendMode` and
  camelCase enum values, with non-normal round-trip tests.

## Remaining high-priority work

- Drag/drop-to-mask intent, target highlighting, Escape cancellation, extreme-zoom
  targeting, image replacement/relink, fit/original/custom positioning, and a dedicated
  clip edit/isolation experience are not implemented.
- Hit testing and visible export bounds are not yet clipped to mask geometry. Layer rows
  need explicit source/content identification and mask-aware reorder affordances.
- Structural mask repair is not called during document decode. SVG import and PSD masks
  remain unsupported.
- Normal versus Pass Through group boundaries, frame subtree compositing, bounded
  offscreens, WebGPU eligibility/order, raster-brush formulas, effect ordering, and
  adaptive contrast text remain incomplete.
- Structured alpha/luminance export, SVG blend/opacity/isolation, PDF structural masks,
  the raster-mask PDF fallback, video export, and cross-renderer pixel parity need
  artifact-level tests and explicit compatibility paths.
- Browser E2E visual fixtures, desktop WebDriver verification, many-mask/blend
  performance tests, and platform coverage beyond Linux remain outstanding.

This audit deliberately does not mark either program complete. The first milestone
repairs data-integrity and wire-contract failures that would make higher-level UX work
unsafe to build on.
