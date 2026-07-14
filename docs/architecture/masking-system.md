# Masking System Architecture

## Overview

Strata's masking subsystem provides three mask types (clip, alpha, luminance) applied to
container nodes (FrameNode, GroupNode, AdjustmentNode). The architecture follows the
Section 0 mandate to extend existing rendering/content-model/colour/effects infrastructure
rather than introducing parallel systems.

## Design Principles

1. **Non-destructive**: Masks are properties on containers, not permanent pixel modifications.
   The mask source node remains independently editable.
2. **Figma-like visibility model**: Mask sources render visibly by default (contributing both
   to the mask effect and to the visible output), matching professional design tool conventions.
   `hideMaskSource` provides Photoshop-like behavior when needed.
3. **Three mask types from a single taxonomy**: clip (vector), alpha (raster channel),
   luminance (perceptually-weighted brightness).
4. **Container ownership**: Only FrameNode, GroupNode, and AdjustmentNode can own masks.
   ShapeNode and TextNode cannot own masks directly (they participate as mask sources
   inside containers).
5. **Child-based mask source**: The mask source must be a child of the container (except for
   AdjustmentNode, which can reference arbitrary nodes).

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

## Mask Data Model

```typescript
interface Mask {
  type: 'clip' | 'alpha' | 'luminance';
  sourceNodeId: NodeId;             // child node providing the mask
  visible: boolean;                 // toggle mask on/off
  inverted?: boolean;               // invert the mask effect
  feather?: number;                 // Gaussian blur radius on mask alpha (world-space px)
  density?: number;                 // overall mask strength 0-1
  linked?: boolean;                 // mask transforms with content (default true)
  transform?: Affine;               // independent mask transform when unlinked
  hideMaskSource?: boolean;         // hide the mask source from direct rendering
}
```

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
| `addMaskToSelected(type)` | Add a mask using the first child as source |
| `removeMaskFromSelected()` | Remove the mask (source node preserved) |
| `toggleMask()` | Toggle mask visibility on/off |
| `invertMask()` | Toggle mask inversion |
| `setMaskFeather(radius)` | Set feather radius |
| `setMaskDensity(density)` | Set mask strength (0-1) |
| `setMaskHideSource(hidden)` | Toggle mask source visibility |
| `setMaskLinked(linked)` | Toggle mask-content transform linking |
| `setMaskType(type)` | Change mask type |
| `setMaskSourceNode(id)` | Change which child provides the mask |

## Document Validation

Masks are checked by `validateMasks()` which finds dangling references to non-existent
source nodes. When a node is removed via `removeNode()`, any masks referencing it are
automatically cleared (`clearMaskSource()`). Deep clone remaps mask `sourceNodeId` values.

## SVG/PDF Export Implications

- **SVG**: Clip masks map to `<clipPath>`. Alpha masks map to `<mask mask-type="alpha">`.
  Luminance masks map to `<mask mask-type="luminance">`. Luminance masking uses the SVG
  default (`mask-type="luminance"` is the SVG default).
- **PDF**: Clip masks map to PDF clipping path operators. Alpha/luminance masks require
  soft-mask (SMask) in PDF 1.4+/X-4. PDF/X-1a cannot express soft masks — must flatten.
- **Raster export (PNG/JPEG)**: Masks are always correctly composited in the rendering
  pipeline — export simply captures the rendered result.

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
| Empty path as mask source | Clip mask with empty path hides all content |
| Fully transparent mask source | Alpha mask hides all masked content |
| Fully opaque mask source | Alpha mask reveals all masked content |
| Mask source not a child | `resolveMask()` returns null, mask is ignored |
| Inverted clip with no children | Mask source `destination-out` path has no effect |
| Zero-size offscreen canvas | `renderEnhancedMask` returns early (no-op) |
| Masks on invisible containers | Container visibility check happens before mask check |
| Deeply nested masks | Each container's mask is resolved independently per render pass |
| Cross-origin images in mask | `getImageData` may fail (tainted canvas); falls through to basic `destination-in` |

## Future Mask Types

To add a new mask type:
1. Add to `MaskType` union in `types.ts`
2. Add branch in `renderEnhancedMask` or clip mask render path
3. Add to `VALID_MASK_TYPES` in `masks.ts`
4. Add UI selector in `MaskSection.tsx`
5. Add SVG/PDF export mapping
6. Add tests
