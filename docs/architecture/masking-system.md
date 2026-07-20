# Masking System Architecture

## Overview

Strata's masking subsystem provides three mask types (clip, alpha, luminance) applied to
container nodes (FrameNode, GroupNode, AdjustmentNode). The architecture follows the
Section 0 mandate to extend existing rendering/content-model/colour/effects infrastructure
rather than introducing parallel systems.

## Design Principles

1. **Non-destructive**: Masks are properties on containers, not permanent pixel modifications.
   The mask source node (if any) remains independently editable.
2. **Figma-like visibility model**: Mask sources render visibly by default (contributing both
   to the mask effect and to the visible output), matching professional design tool conventions.
   `hideMaskSource` provides Photoshop-like behavior when needed.
3. **Three mask types from a single taxonomy**: clip (vector), alpha (raster channel),
   luminance (perceptually-weighted brightness).
4. **Container ownership**: Only FrameNode, GroupNode, and AdjustmentNode can own masks.
   ShapeNode and TextNode cannot own masks directly (they participate as mask sources
   inside containers).
5. **Child-based or self-contained mask source**: Masks may reference a child node by
   `sourceNodeId`, or carry self-contained `VectorMaskData` for resolution-independent
   vector masks. Both may be present: the vector path provides geometry, the source node
   provides optional visual content.
6. **Mask graph cycle prevention**: `addMask()` checks for cycles before committing any
   mask change. `detectMaskCycles()` detects self-referencing and mutual mask references
   via depth-first search.

## Architectural Inheritance (Section 0)

This system extends existing architecture rather than introducing parallel representations:

| Existing System | How Masking Inherits |
|----------------|---------------------|
| Canvas2D rendering backend | All mask compositing (alpha, luminance, clip inversion) uses Canvas2D `save/restore/clip/destination-in` primitives through the existing `replaySubtreeToCtx` / `replayIr` pipeline |
| Scene graph + immutable Document pattern | Mask CRUD operations follow the existing `updateDoc` pattern from `packages/scene/src/masks.ts` |
| `ManagedColor` / colour pipeline | Luminance mask conversion uses proper linear-RGB maths (IEC 61966-2-1) routed through `packages/engine/src/maskCompositing.ts` — not a separate ad-hoc formula |
| Effects architecture | Masks compose before group isolation / blend mode compositing. Effects on the masked container apply to the composited (masked) result. This ordering is consistent with existing `sceneCompositing.ts` rules |
| Existing `Mask` type in types.ts | Extended with `hideMaskSource` rather than introducing a separate mechanism |
| `renderAlphaMask` / `renderEnhancedMask` | All alpha/luminance compositing builds on these existing primitives |

## Mask Data Model (v1.9)

```typescript
type MaskType = 'clip' | 'alpha' | 'luminance';
type MaskFillRule = 'nonzero' | 'evenodd';

interface VectorMaskData {
  points: PathPoint[];              // control points in mask-local coordinates
  closed: boolean;                  // whether last point connects back to first
  fillRule: MaskFillRule;           // fill rule for interior vs exterior
}

interface Mask {
  type: MaskType;
  sourceNodeId?: NodeId;            // child node providing the mask (optional for vector masks)
  vectorMask?: VectorMaskData;      // self-contained vector path (overrides sourceNodeId for geometry)
  visible: boolean;                 // toggle mask on/off
  fillRule?: MaskFillRule;          // nonzero (default) or evenodd for clip/vector masks
  inverted?: boolean;               // invert the mask effect
  feather?: number;                 // Gaussian blur radius on mask alpha (world-space px)
  density?: number;                 // overall mask strength 0-1
  linked?: boolean;                 // mask transforms with content (default true)
  transform?: Affine;               // independent mask transform when unlinked
  hideMaskSource?: boolean;         // hide the mask source from direct rendering
}
```

`sourceNodeId` is now optional. When `vectorMask` with non-empty points is provided,
the mask geometry comes from the path data rather than from a child node. When both
are present, `vectorMask` defines the clipping geometry and `sourceNodeId` provides
optional visual content (rendered if `hideMaskSource` is false).

## Mask Types

### Clip Mask (`type: 'clip'`)
Uses the mask source's geometric outline as a clipping region. Children inside the
clip region are visible; children outside are hidden.

- Inverted clip masks use offscreen canvas compositing: children render to an offscreen
  canvas, then the mask source shape is filled with `destination-out` to punch the clip
  region out (keeping content outside the clip).
- Canvas2D `clip()` is used for the non-inverted case (fast, hardware-accelerated).
- No feather support for clip masks (feather uses alpha compositing which requires
  rasterisation).

### Alpha Mask (`type: 'alpha'`)
Uses the mask source's alpha channel as a per-pixel opacity modulator. Where the mask
source is transparent, the masked content is hidden; where opaque, content is visible.

- Implemented via `renderEnhancedMask()` which uses offscreen canvas double-buffering
  with `destination-in` compositing.
- Supports inversion, feather (3-pass box blur approximating Gaussian), and density.

### Luminance Mask (`type: 'luminance'`)
Like alpha mask, but converts the mask source's RGB values to luminance using perceptually
correct linear-RGB math (IEC 61966-2-1: linearize sRGB, then apply ITU-R BT.709
coefficients: L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin).

- Same compositing pipeline as alpha masks.
- Uses the same inversion, feather, density, and unlinked transform support.

## Rendering Order

1. Check for mask on container node
2. If mask exists and is visible:
   a. For alpha/luminance: render mask source to offscreen canvas → post-process
      (luminance conversion → feather → invert → density) → composite content
      with `destination-in` → draw result
   b. For clip: trace mask source outline → `clip()` (or offscreen `destination-out`
      for inverted) → render non-mask-source children → render mask source on top
      (unless `hideMaskSource`)
3. Render frame clipping (`clipContent`)
4. Render group isolation (blend mode, opacity, effects)
5. Recurse into children

## Editor Context Methods

| Method | Description |
|--------|-------------|
| `addMaskToSelected(type)` | Add a mask using the first child as source (or vector mask if no children) |
| `removeMaskFromSelected()` | Remove the mask (source node preserved) |
| `toggleMask()` | Toggle mask visibility on/off |
| `invertMask()` | Toggle mask inversion |
| `setMaskFeather(radius)` | Set feather radius |
| `setMaskDensity(density)` | Set mask strength (0-1) |
| `setMaskHideSource(hidden)` | Toggle mask source visibility |
| `setMaskLinked(linked)` | Toggle mask-content transform linking |
| `setMaskType(type)` | Change mask type |
| `setMaskSourceNode(id)` | Change which child provides the mask |
| `setMaskFillRule(fillRule)` | Set fill rule (nonzero/evenodd) for clip/vector masks |
| `setMaskVectorPath(points, closed)` | Set vector mask path data (independent of child node) |

## Quick-Mask Mode

Quick-mask is a transient editor state for selection editing. It is NOT persisted
to the document model.

```typescript
interface QuickMaskState {
  active: boolean;
  color: [number, number, number, number];  // overlay RGBA
  coverage: Uint8Array | null;               // per-pixel coverage (0=protected, 255=selected)
  width: number;
  height: number;
}
```

| Method | Description |
|--------|-------------|
| `enterQuickMask()` | Activate quick-mask mode, allocate coverage buffer |
| `exitQuickMask(convertToMask?)` | Deactivate, optionally convert coverage to raster mask |
| `setQuickMaskCoverage(coverage, w, h)` | Replace coverage buffer |
| `paintQuickMask(x, y, radius, value)` | Paint circular dab in coverage buffer |
| `fillQuickMask(value)` | Fill entire coverage buffer with value |
| `invertQuickMask()` | Invert all coverage pixels (255 - v) |
| `isQuickMaskActive()` | Return whether quick-mask mode is active |

Quick-mask state is cleared on document close and is not part of undo/redo history.

## Mask Graph Safety

Masks form a directed graph from containers to their source nodes. The system
prevents cycles:

- `detectMaskCycles(doc)` — depth-first search that returns an array of cycle paths.
  Empty array when no cycles exist.
- `addMask()` rejects masks that would create a cycle, returning the document
  unchanged.
- `removeNode()` automatically clears mask references to removed nodes.

Helper functions:
- `getAllMaskSourceIds(doc)` — collect all source node IDs referenced by any mask.
- `hasVectorMask(mask)` — true if mask has non-empty vector path data.
- `hasSourceNode(mask)` — true if mask references a child node.

## Vector Masks

Vector masks carry self-contained `PathPoint[]` data rather than referencing a
child node. They are:

- Resolution-independent (editable vector paths)
- Rendered via `traceVectorMaskPoints()` in CanvasArea.tsx, which handles bezier
  handles (`handleIn`/`handleOut`) as cubic bezier curves
- Subject to `fillRule` (nonzero/evenodd)
- Able to be converted to SVG `<clipPath>` / `<mask>` elements on export
- Edited via the Pen/Pencil tools or NodeEditTool

## Document Validation & Migration

Masks are checked by `validateMasks()` which finds dangling references to non-existent
source nodes. When a node is removed via `removeNode()`, any masks referencing it are
automatically cleared (`clearMaskSource()`). Deep clone remaps mask `sourceNodeId` values.

v1.9 migration (from 1.8):
- Adds `fillRule: 'nonzero'` to existing clip masks without one
- Adds `fillRule: 'nonzero'` to existing vector masks without one
- Preserves all existing mask properties

## SVG/PDF Export Implications

- **SVG** (via `packages/codegen/src/svg.ts`):
  - Clip masks map to `<clipPath>` elements in `<defs>`
  - Alpha masks map to `<mask mask-type="alpha">`
  - Luminance masks map to `<mask mask-type="luminance">` (SVG default)
  - Inverted clip masks use `<mask>` with white rect + black clip shape
  - Vector masks are converted to SVG `<path d="..." />` with bezier handles
  - Feather maps to `feGaussianBlur` filter on the mask
  - Density maps to opacity compensation
  - `hideMaskSource` filters the source node from children
  - `fillRule="evenodd"` adds `clip-rule="evenodd"`
  - Unlinked masks use `maskUnits="userSpaceOnUse"` for independent transform
  - Pre-1.9 SVG export did NOT include scene-graph masks; this is new in v1.9
- **PDF (current)**: structural clip/alpha/luminance masks are rejected by preflight;
  the Rust writer does not yet emit clipping operators or PDF 1.4 soft masks. A raster
  fallback exists for raster masks but still requires artifact-level verification.
  PDF/X-1a cannot express soft masks and must use an explicit flattening strategy.
- **Raster export (PNG/JPEG/WebP)**: export uses the structural Canvas replay path. Clip
  masks share the editor's path tracing and fill-rule behavior; alpha/luminance export
  parity remains under active conformance testing.

## Performance Considerations

- Masked scenes always render on the main thread (worker path cannot access DOM canvas
  APIs for offscreen compositing).
- Feather uses 3-pass box blur (O(n)) approximating Gaussian — acceptable for interactive
  use at moderate radii.
- Offscreen canvases are created per masked container per frame — no persistent cache
  (potential future optimisation: LRU cache of mask surfaces keyed by content hash).

## Edge Case Handling

| Case | Behavior |
|------|----------|
| Empty/open path as mask source | Rejected for clipping-mask creation |
| Fully transparent mask source | Alpha mask hides all masked content |
| Fully opaque mask source | Alpha mask reveals all masked content |
| Mask source not a child | `resolveMask()` returns null, mask is ignored |
| Inverted clip with no children | Mask source `destination-out` path has no effect |
| Zero-size offscreen canvas | `renderEnhancedMask` returns early (no-op) |
| Masks on invisible containers | Container visibility check happens before mask check |
| Deeply nested masks | Each container's mask is resolved independently per render pass |
| Cross-origin images in mask | `getImageData` may fail (tainted canvas); falls through to basic `destination-in` |
| Vector mask with no child source | Mask is purely geometric; no visual content rendered |
| Both sourceNodeId and vectorMask present | Vector path provides geometry, source node provides visual content |
| Vector mask clip with evenodd fill rule | Path is rendered with `clip('evenodd')` via Path2D |
| Mask source deletion | Mask is automatically cleared by `removeNode()` |
| Mask cycle detection | `addMask()` rejects cycles; `detectMaskCycles()` finds them |
| Quick-mask active during tool switch | Quick-mask mode persists; user must explicitly exit |
| Quick-mask with no selection | Coverage buffer is null; paint/fill/invert are no-ops |
| Unlinked mask transform | Mask uses independent `transform` separate from content |
| SVG export of inverted clip masks | Uses `<mask>` with white rect + inverted black clip shape |

## Future Mask Types

To add a new mask type:
1. Add to `MaskType` union in `types.ts`
2. Add branch in `renderEnhancedMask` or clip mask render path
3. Add to `VALID_MASK_TYPES` in `masks.ts`
4. Add UI selector in `MaskSection.tsx`
5. Add SVG/PDF export mapping
6. Add tests
