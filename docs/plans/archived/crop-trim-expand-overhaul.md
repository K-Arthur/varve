# Crop, Trim-to-Subject & Image-Bound Expansion Overhaul

## Executive Summary

Audit of the existing crop/trim/expand pipeline reveals a working but limited system:
- **Core geometry math is solid** — `commitImageCropExtended`, `computeImagePlacement`, and fill offset compensation are well-tested and correct.
- **Critical gaps**: `computeAlphaBounds` is O(W×H) DOM-dependent, no vector mask bounds, no dedicated inspector UI, `expandBounds` limited to crop mode, `window.prompt` for padding input.
- **Architecture is clean** — three-layer separation (Tool → Overlay → Document mutation) means we can enhance without breaking existing workflows.

## Milestone 1: Shared Visible-Bounds Abstraction

### 1.1 Create `packages/editor/src/imageBounds.ts`

New module providing `computeVisibleContentBounds(node, doc, options)`:

```
computeVisibleContentBounds(node, doc, opts?) → VisibleBounds | null

VisibleBounds = {
  local: { x, y, w, h }     // in node-local space
  source: { minX, minY, maxX, maxY }  // in source-image pixels
  method: 'raster-alpha' | 'vector-path' | 'clip-mask' | 'fallback'
}
```

Options:
- `alphaThreshold: number` (default 0) — minimum alpha for raster scan
- `maskSource: 'raster' | 'vector' | 'clip' | 'auto'` — which mask to use
- `padding: number | PaddingSides` — post-computation padding

Providers (private functions within the module):
- `computeRasterAlphaBounds(doc, node, threshold?)` → AlphaBounds | null
  - Refactored from `computeAlphaBounds` — accepts ImageBitmap | ImageData | OffscreenCanvas | dataURL
  - Tile-based scanning: divide into 64×64 tiles, skip fully transparent tiles early
  - Cancelable via AbortSignal
  - Cached by mask asset checksum
- `computeVectorMaskBounds(node, doc)` → Bounds | null
  - Reads `node.mask.vectorMask.points` (PathPoint[])
  - Uses `cubicBezierBBox` from `@varve/shared` for each segment
  - Composes bounds of all segments
  - Applies mask transform if `linked === false`
- `computeClipMaskBounds(node, doc)` → Bounds | null
  - Uses `sourceNodeId` to get the mask source node's world bounds
  - Intersects with the node's own bounds
- `computeSourceAlphaBounds(doc, node, threshold?)` → AlphaBounds | null
  - Uses the image fill's source pixels directly (no mask)
  - Same tile-based scan as raster alpha bounds

### 1.2 Refactor `computeAlphaBounds` in `imageCrop.ts`

- Keep the existing function for backward compatibility
- Add deprecation notice pointing to `computeVisibleContentBounds`
- The new function delegates to the raster provider internally

### 1.3 Test Coverage

New test file: `packages/editor/src/imageBounds.test.ts`
- Raster alpha bounds: opaque, transparent, partially transparent, fully transparent, edge pixels
- Vector mask bounds: single segment, compound path, transformed mask, open path
- Clip mask bounds: source node exists, source node missing, nested containers
- Source alpha bounds: no mask present
- Padding: uniform, per-side, zero
- AbortSignal cancellation
- Cache hit/miss behavior

## Milestone 2: Optimize Raster-Mask Bounds Computation

### 2.1 Tile-Based Alpha Scanning

Replace the linear O(W×H) scan with a hierarchical approach:

```
Phase 1: Divide image into 64×64 tiles
Phase 2: For each tile, check if ANY pixel has alpha > threshold
  - Use ImageData sampling: check corners + center (5 samples)
  - If all transparent, skip entire tile
Phase 3: For tiles with potential content, do full pixel scan
Phase 4: Tighten bounds from tile AABB to actual pixel AABB
```

Expected speedup: 10-50x for images with large transparent regions (common in bg-removed images).

### 2.2 Cached Decoded Masks

```
interface MaskCacheEntry {
  assetId: string
  checksum: string
  alphaBounds: AlphaBounds | null
  decodedAt: number
}
```

- LRU cache, max 50 entries
- Invalidated when `RasterMaskAsset.checksum` changes
- Shared between `trimToSubject` and `computeVisibleContentBounds`

### 2.3 Worker/OffscreenCanvas Path

For images > 4MP, use an OffscreenCanvas in a dedicated Web Worker:
- Transfer the mask ImageBitmap to the worker
- Worker performs tile scan and returns AlphaBounds
- Main thread shows progress indicator
- Cancellation via AbortSignal

### 2.4 Test Coverage

- Performance benchmark: 4000×3000 fully-transparent image with 200×200 opaque region
- Cache hit returns instantly
- Cache invalidation on checksum change
- Worker path returns correct bounds
- Cancellation mid-scan

## Milestone 3: Vector and Clipping-Mask Bounds

### 3.1 Vector Mask Bounds (`computeVectorMaskBounds`)

Uses existing `cubicBezierBBox` from `@varve/shared`:

```typescript
function computeVectorMaskBounds(
  points: PathPoint[],
  closed: boolean,
  fillRule: 'nonzero' | 'evenodd',
  maskTransform?: Affine
): Bounds | null {
  if (points.length === 0) return null;
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  for (const pt of points) {
    // Anchor point
    minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
    
    // Handle control points (extend bounding box)
    if (pt.handleIn) {
      const bb = cubicBezierBBox({ p0: pt, p1: pt.handleIn, p2: pt.handleIn, p3: pt });
      minX = Math.min(minX, bb.x); maxX = Math.max(maxX, bb.x + bb.w);
      minY = Math.min(minY, bb.y); maxY = Math.max(maxY, bb.y + bb.h);
    }
    if (pt.handleOut) {
      const bb = cubicBezierBBox({ p0: pt, p1: pt.handleOut, p2: pt.handleOut, p3: pt });
      minX = Math.min(minX, bb.x); maxX = Math.max(maxX, bb.x + bb.w);
      minY = Math.min(minY, bb.y); maxY = Math.max(maxY, bb.y + bb.h);
    }
  }
  
  // Apply mask transform if unlinked
  if (maskTransform) {
    return transformRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, maskTransform);
  }
  
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

### 3.2 Clip Mask Bounds (`computeClipMaskBounds`)

For structural masks (sourceNodeId), the mask source's world bounds define the visible region:

```typescript
function computeClipMaskBounds(
  node: SceneNode,
  doc: Document,
  worldBoundsFn: (id: NodeId) => Bounds | null
): Bounds | null {
  const mask = node.mask;
  if (!mask || !('sourceNodeId' in mask) || !mask.sourceNodeId) return null;
  
  const sourceBounds = worldBoundsFn(mask.sourceNodeId);
  if (!sourceBounds) return null;
  
  // Clip mask intersects the source bounds with the node's own bounds
  const nodeBounds = worldBoundsFn(node.id);
  if (!nodeBounds) return sourceBounds;
  
  return intersectBounds(nodeBounds, sourceBounds);
}
```

### 3.3 Test Coverage

- Vector mask: single line, L-shape, closed rect, compound path with holes
- Transformed mask (translate, rotate, scale)
- Empty vector mask → null
- Clip mask: source node exists, source missing, nested containers
- Fill rule difference (nonzero vs evenodd) — affects interior, not bounds
- Stroke inclusion: vector mask bounds include stroke width when mask type requires it

## Milestone 4: Trim-to-Subject and Expand Semantics

### 4.1 Enhanced `trimToSubject`

Update signature:
```typescript
interface TrimOptions {
  padding?: number;
  paddingSides?: { top?: number; right?: number; bottom?: number; left?: number };
  source?: 'mask' | 'alpha' | 'combined';  // NEW: what to trim to
  alphaThreshold?: number;                   // NEW: minimum alpha
  centerFrom?: 'center' | 'current';        // NEW: transform anchor
  signal?: AbortSignal;                      // NEW: cancellation
}
```

Source modes:
- `'mask'` — trim to raster mask alpha bounds (current behavior, default)
- `'alpha'` — trim to source image alpha bounds (no mask)
- `'combined'` — trim to intersection of mask and source alpha

### 4.2 Enhanced `expandBounds`

Update signature:
```typescript
interface ExpandOptions {
  padding?: number;
  paddingSides?: { top?: number; right?: number; bottom?: number; left?: number };
  fromCenter?: boolean;     // NEW: expand symmetrically
  mode?: 'crop' | 'convert'; // NEW: behavior for non-crop modes
}
```

For non-crop modes (fill/fit/stretch):
- `mode: 'crop'` (default) — silently convert to crop mode, then expand
- `mode: 'convert'` — convert to crop, show info toast, then expand

The conversion preserves the current visual result by:
1. Computing the current effective display rect from `computeImagePlacement`
2. Setting fit to 'crop' with the current scale and offset
3. Then applying the expansion

### 4.3 Empty Mask Handling

When mask is fully transparent:
- `trimToSubject` → return original doc (no-op, not zero-sized)
- Log warning: "Subject mask is fully transparent; trim has no effect"
- Show toast notification in UI

### 4.4 Test Coverage

- Trim with mask source, alpha source, combined
- Trim with padding (uniform, per-side)
- Trim with alpha threshold
- Expand from center
- Expand non-crop mode with convert
- Empty mask → no-op
- Full-frame mask → no-op
- Undo/redo round-trip
- Save/reopen preserves trim/expand result
- Multi-selection trim (all eligible nodes)

## Milestone 5: Dedicated Inspector UI

### 5.1 New Section: `ImageCropSection`

Create `packages/editor/src/components/Inspector/sections/ImageCropSection.tsx`

Register in `sectionRegistry.ts`:
```typescript
{
  id: 'image-crop',
  title: 'Crop & Bounds',
  defaultExpanded: true,
  canHide: true,
  essential: false,
  order: 265,  // between appearance (250) and image-placement (270)
  category: 'advanced',
  isAvailable: (ctx) => isSingleSelection(ctx) && isImageNode(ctx.selectedNodes),
}
```

Controls (progressive disclosure):

**Basic (always visible):**
- **Edit Crop** button → activates CropTool (same as Object > Crop Image)
- **Fit Mode** segment control (Fill/Fit/Crop/Stretch/Tile) — syncs with ImagePlacementSection
- **Content X / Y** NumberFields — fill offset, synced with ImagePlacementSection
- **Content Scale** NumberField — fill scale, synced with ImagePlacementSection

**Trim section (disclosure):**
- **Trim to Subject** button → calls `trimToSubject()`
- **Trim Source** selector (Mask / Alpha / Combined) — only when both mask and source alpha exist
- **Alpha Threshold** slider 0-255 — for alpha-only trim
- **Trim Padding** NumberField with per-side toggle

**Expand section (disclosure):**
- **Expand Bounds** — linked padding NumberField + per-side toggle
- **From Center** checkbox
- **Expand** button

**Reset section (disclosure):**
- **Reset Crop** button → enters crop mode with full-frame viewport
- **Reset Bounds** button → `resetToSourceBounds()`
- **Restore Source Bounds** → same as Reset Bounds (clearer label)

### 5.2 Progress & Cancellation for Async Trim

```typescript
// In ImageCropSection:
const [trimProgress, setTrimProgress] = useState<'idle' | 'computing' | 'done'>('idle');
const abortRef = useRef<AbortController | null>(null);

const handleTrim = useCallback(async () => {
  abortRef.current = new AbortController();
  setTrimProgress('computing');
  try {
    await ctx.trimToSubject(padding, { signal: abortRef.current.signal });
    setTrimProgress('done');
  } finally {
    setTrimProgress('idle');
  }
}, [ctx, padding]);

const handleCancelTrim = useCallback(() => {
  abortRef.current?.abort();
}, []);
```

### 5.3 Inspector ↔ Canvas Synchronization

The section reads from the same document state as the CropTool. When CropTool is active:
- Inspector shows "Crop Active" state with Done/Cancel buttons
- Crop controls are read-only (controlled by CropTool)
- When CropTool commits, inspector updates via document state change

### 5.4 Multi-Selection Behavior

- Single image selected → full controls
- Multiple images selected → show common properties (fit mode), disable trim/expand/crop
- Mixed selection (image + non-image) → section hidden

### 5.5 CSS

Add to `inspector.css`:
```css
.insp-crop-section__trim-progress { ... }
.insp-crop-section__trim-actions { ... }
.insp-crop-section__expand-controls { ... }
.insp-crop-section__reset-group { ... }
```

### 5.6 Test Coverage

- Section renders for single image node
- Section hidden for non-image nodes
- Trim button calls trimToSubject
- Expand button calls expandImageBounds
- Reset button calls resetImageBounds
- Fit mode change syncs with ImagePlacementSection
- Crop mode shows "Crop Active" state
- Multi-selection disables crop-specific controls
- Progress indicator shows during async trim
- Cancel aborts trim operation

## Milestone 6: Authoritative Crop Preview

### 6.1 Keep `<img>` Overlay (Justified)

After analysis, the `<img>` overlay is the correct approach for interactive crop:
- `computeImagePlacement()` produces identical math for both paths
- Test at `imageCrop.test.ts:139` verifies preview-commit parity
- Canvas re-render at 60fps during drag adds 4-8ms latency
- The overlay is already positioned identically to committed output

### 6.2 Add Visual Parity Tests

New test file: `packages/editor/src/cropPreview.test.ts`
- Normal zoom: preview and committed render produce same pixel region
- Extreme zoom (1%): verify no precision loss in coordinate math
- High zoom (1000%): verify handle positions are sub-pixel accurate
- Rotation: verify preview tracks rotated node bounds
- Flipping: verify mirror behavior

### 6.3 Known Limitation: Tile Mode Preview

The `<img>` overlay cannot perfectly preview `tile` mode (repeated image).
- Add a badge "Tile mode — preview is approximate"
- Committed render is always authoritative
- This is acceptable because tile mode crop is rare

## Milestone 7: Persistence, Export & Migration

### 7.1 Document Persistence

Already handled by the immutable document model:
- `shape.w/h` — persisted
- `transform` — persisted
- `fills[].image.{x, y, scale, fit}` — persisted
- `mask.rasterMask` — persisted via `rasterMaskAssets`
- `mask.vectorMask` — persisted inline

No new persistence fields needed. Crop state is ephemeral (CropTool local state).

### 7.2 Export

Already handled:
- SVG export: `codegen/src/svg.ts` uses `computeImagePlacement` for image positioning
- PDF export: `strata-print` uses engine IR which includes image fill data
- PNG/WebP export: canvas snapshot includes committed crop result

### 7.3 Legacy Migration

The existing v2.3 migration handles `backgroundRemoval` → `rasterMask` conversion.
No new migration needed for crop/trim/expand — these operations are stateless.

### 7.4 Test Coverage

- Save document with cropped image → reopen → verify shape.w/h, transform, fills match
- Save document with trimmed image → reopen → verify crop applied correctly
- Save document with expanded bounds → reopen → verify padding preserved
- Export cropped image to SVG → verify viewBox matches crop bounds
- Export to PDF → verify image positioned correctly

## Milestone 8: Keyboard Shortcuts & Commands

### 8.1 New Shortcuts

| Shortcut | Action | Category |
|----------|--------|----------|
| `Ctrl+Shift+T` | Trim to Subject | Object |
| `Ctrl+Shift+E` | Expand Bounds (opens dialog) | Object |
| `Ctrl+Shift+R` | Reset Image Bounds | Object |

Add to `ShortcutManager.ts` SHORTCUT_DEFS.

### 8.2 Object Menu Updates

Replace `window.prompt` for Expand Bounds with a proper modal dialog:
- Small popover with padding NumberField + per-side toggle + Expand/Cancel buttons
- Similar to the Frame Presets section pattern

### 8.3 ActionRegistry Updates

Update existing registrations with new keywords and descriptions.

## Milestone 9: Performance & Verification

### 9.1 Performance Benchmarks

New test file: `packages/editor/src/imageBounds.perf.test.ts`
- 4000×3000 opaque image → alpha bounds in < 50ms
- 4000×3000 with 10% subject → tile scan in < 20ms
- 4000×3000 fully transparent → tile scan in < 5ms
- Vector mask with 1000 points → bounds in < 1ms
- Cached mask → bounds in < 0.1ms

### 9.2 E2E Tests

New spec: `tests/e2e/canvas/crop-trim.spec.ts`
- Load image → press C → crop overlay appears
- Drag handles → crop preview updates
- Press Enter → crop committed
- Object > Trim to Subject → image trimmed
- Object > Expand Bounds → padding added
- Inspector: change fit mode → canvas updates
- Inspector: trim with padding → image trimmed with padding
- Undo/redo round-trip
- Save/reopen preserves state

### 9.3 Visual Regression

- Screenshot comparisons at normal and extreme zoom
- Pixel-diff images for crop preview vs committed output
- Mask overlay visualization for trim diagnostics

## Implementation Order

1. **Milestone 1** (Shared Visible-Bounds) — foundation for everything else
2. **Milestone 2** (Raster Optimization) — performance improvement, enables async trim
3. **Milestone 3** (Vector/Clip Bounds) — completes the bounds abstraction
4. **Milestone 4** (Trim/Expand Semantics) — uses the new bounds abstraction
5. **Milestone 5** (Inspector UI) — user-facing controls
6. **Milestone 6** (Crop Preview) — verification and polish
7. **Milestone 7** (Persistence/Export) — verification pass
8. **Milestone 8** (Shortcuts/Commands) — UX completion
9. **Milestone 9** (Performance/E2E) — final verification

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Tile-based alpha scan misses edge pixels | Validate against full scan for test fixtures |
| Vector mask bounds don't match visual output | Cross-validate with rasterized mask bounds |
| Non-crop mode expansion breaks fill math | Test with all 5 fit modes before/after |
| Inspector and CropTool get out of sync | Both read from document state; no separate state |
| Worker alpha scan not available in jsdom | Graceful fallback to main-thread scan |
| Concurrent agents modify crop files | Check git status before each commit; small focused commits |
