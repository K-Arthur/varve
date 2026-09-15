# Painting & Drawing System Design Specification

> **Status:** Approved architecture  
> **Drivers:** Principal Graphics Engineer, Staff Software Engineer, QA Lead  
> **Platforms:** Linux (CachyOS/Wayland), Browser (Chromium)  
> **Workflow:** Freehand sketching and illustration with full raster painting

## Overview

Add a full raster painting layer system to the existing vector design tool. Uses tile-based raster storage (128x128px), connected brush pipeline, One Euro stabilization, and proper document integration. All existing vector tools and document types remain unchanged.

## Architecture

### RasterLayerNode — New Scene Node Kind

```typescript
interface RasterLayerNode extends NodeBase {
  kind: 'rasterLayer';
  width: number;     // canvas width in pixels
  height: number;    // canvas height in pixels
  pixelMode: boolean; // pixel-art constraint
  tiles: Map<string, RasterTile>; // serialized tile data
}
```

- Leaf node (no children), occupies rectangular area
- Lives alongside ShapeNode, FrameNode, GroupNode in scene tree
- Transformable (position, rotation, scale) like any other node
- Supports opacity, blendMode, visible, locked, masks

### RasterTile — Storage Unit

```typescript
interface RasterTile {
  key: string;         // "{col}:{row}" — 128x128px grid index
  pixels: Uint8ClampedArray; // RGBA pixel data, 128*128*4 bytes
  version: number;     // Monotonic version for cache invalidation
}
```

- Lazily allocated: only tiles with painted content exist
- Serialized as base64-encoded RGBA in document JSON
- 128x128 chosen as balance between Krita (64px) and modern engines (256px)
- Texture atlas packing for GPU rendering

### Brush Preset Pipeline (Connect Existing Infrastructure)

The existing `BrushPreset` model in `packages/scene/src/brush.ts` provides:
- 30 fields: shape, radius, opacity, flow, hardness, spacing, angle, roundness
- Jitter: position, size, opacity, rotation
- Dynamics mappings: pressure/tilt/speed/direction → target attributes via cubic bezier
- `generateDabs()` — spacing-based dab placement with dynamics evaluation
- `smoothStrokePoints()` — exponential moving average smoothing

These are **not used by any tool today**. The PaintTool connects them end-to-end.

### PaintTool — New Generic Painting Tool

```typescript
class PaintTool extends BaseTool {
  preset: BrushPreset;            // Current brush preset
  stroke: BrushStroke | null;     // Active stroke (for undo/commit)
  sourcePoint: { x, y } | null;   // Clone source anchor

  onPointerDown(ctx): Point capture + beginTransaction
  onPointerMove(ctx): Sample → stabilize → generateDabs → paint to tiles
  onPointerUp(ctx): Commit stroke + endTransaction
}
```

### Stroke Pipeline

```
Raw Input → getCoalescedEvents() → resample → 
  One Euro filter (stabilize) → 
  generateDabs(BrushPreset, sampled points) →
  for each dab: apply brush mask → composite color + opacity + blend → 
    tile lookup/create → blend pixels → mark tile dirty →
  schedule tile re-render
```

### One Euro Filter — Stabilization

```typescript
function oneEuroFilter(
  x: number, y: number, t: number,
  prev: { x, y, dx, dy, t },
  minCutoff = 1.0, beta = 0.007, dCutoff = 1.0
): { x, y, dx, dy }
```

- Low-pass filter with adaptive cutoff based on velocity
- High smoothing at low speed (precision work)
- Low smoothing at high speed (reduce lag)
- Industry consensus for drawing stabilization (3-parameter, ~15 LOC math)

### Raster Rendering Pipeline

Two-tier rendering:
1. **Interactive**: Composite dirty tiles to intermediate canvas, blit to screen
2. **Final/Export**: Full resolution compositing of all tiles

RasterLayerNode in render tree:
- Generate tile bitmap from stored tile data
- Composite into scene at node's world-space transform
- Apply opacity/blendMode before compositing with underlying vector content

### Eraser

The eraser is a **mode of PaintTool** (brushPreset.eraser = true), not a separate tool:
- Erase mode: brush paints transparent (RGBA 0,0,0,0) using Porter-Duff `destination-out`
- Alpha lock toggle: constrain erasing to opaque pixels
- Mask painting: eraser paints black onto layer mask

### Existing Tool Preservation

| Tool | Action |
|------|--------|
| CloneStampTool | Keep — special-purpose raster tool |
| HealingBrushTool | Keep — special-purpose raster tool |
| SpotHealTool | Keep — special-purpose raster tool |
| PatchTool | Keep — special-purpose raster tool |
| RefineMaskTool | Keep — mask refinement tool |
| TrimapEditTool | Keep — bg removal tool |
| PencilTool | **Improve** — add stabilization + pressure + error mapping |
| PenTool | Keep — vector Bezier tool |
| All shape tools | Keep — existing vector tools unchanged |

### UI / Front-End

- **Toolbar**: Add PaintTool button (brush icon), Eraser tool/mode button
- **Inspector properties**: Add BrushSection — brush preset selector + size/opacity/flow/hardness/spacing controls
- **Brush Preset Library**: Searchable preset browser (phased — basic preset list first, full browser later)
- **Smoothing controls**: Numeric input for stabilization strength (0-100%)
- **Pressure toggles**: Per-attribute pressure enable/disable
- **Pixel mode toggle**: Constrain brush to pixel grid

### Document Integration / Persistence

```typescript
// Existing Document type extended:
interface Document {
  // ...existing fields...
  brushPresets?: Record<string, BrushPreset>; // document-level presets
}
```

Serialization:
- `RasterLayerNode.tiles`: Serialized as `Record<string, string>` (tileKey → base64)
- Tiles stored directly in node JSON (not external files)
- Document composition threshold: 50MB before tile compression
- Brush presets serialized as JSON alongside document

### Undo/Redo

- Per-stroke undo unit: beginTransaction on pointer down, commit on pointer up
- Tile-based undo: store pre-modified tile data in transaction snapshot
- Maximum 50 undo steps (same as existing system)
- Stroke cancellations (Escape) abort transaction, restore tiles

### Export

RasterLayerNode composite into export canvas:
- PNG/JPEG/WebP: rasterize all layers (vector + raster tiles) to flat image
- SVG: export raster layer as `<image>` with embedded base64 PNG or `<canvas>` pixel data
- PDF: embed raster layer as image XObject
- Native format: full tile data preserved

### Performance Targets

- Input-to-pixel latency: < 32ms (at 60fps target, 16ms internal budget)
- Brush stroke rendering: < 8ms per dab batch
- Tile lookup: O(1) via Map
- Memory: only painted tiles allocated (no 16K×16K initial allocation)
- Undo memory: tied to modified tile data, not full canvas

### Accessibility

- Keyboard-only: Tab to brush controls, arrow keys for size/opacity, Enter to paint click-by-click
- Screen reader: announce current brush, size, opacity, pressure state
- High contrast: cursor visible against any background
- Reduced motion: disable brush animation/jitter, skip preview dithering
- Nonvisual state: tool name + size in `aria-live` region

### Platform Notes

- **Linux Wayland**: Pointer Events pressure available in Chromium (tested). All tools work via mouse and supported styli.
- **Browser**: Pointer Events `getCoalescedEvents()` required for smooth strokes. Pressure varies by browser support — detect and clamp.
- **No platform-specific tablet API required**: Pointer Events abstraction sufficient for current scope.

## Implementation Phases

### Phase 1: RasterLayerNode + Tile Storage

- Add RasterLayerNode type to scene model
- Add to SceneNode union
- Tile storage (Map<key, Uint8ClampedArray>)
- Tile serialization (base64 in JSON)
- `makeRasterLayerNode()` factory
- Validation: width/height > 0, integer coordinates
- Tests: create, serialize round-trip, tile CRUD, bounds

### Phase 2: PaintTool + Brush Preset Wiring

- Wire BrushPreset from brush.ts into PaintTool
- Implement dab generation → tile painting
- Pressure sensitivity via Pointer Events
- Basic cursor preview (circle indicating brush size/hardness)
- Existing brush model integration (generateDabs, evaluateDynamics)
- Tests: paint stroke creates tiles, pressure modifies size, spacing affects dab count

### Phase 3: Stroke Stabilization

- Implement One Euro filter
- Connect to PaintTool stroke pipeline
- Provide stabilization strength slider (0=smooth, 100=direct)
- Tests: stabilization smooths wobble, fast strokes track more closely

### Phase 4: Brush Preset UI

- BrushSection in inspector panel
- Preset selector dropdown
- Size/opacity/flow/hardness controls
- Smoothing strength
- Pressure toggles per attribute
- Tests: controls render, values change brush output

### Phase 5: Eraser + Mask Painting

- Eraser mode (brushPreset.eraser = true)
- Alpha lock support
- Layer mask painting
- Tests: eraser removes pixels, alpha lock constrains, mask painting works

### Phase 6: Raster Rendering

- Tile atlas / dirty-tile compositing in rendering pipeline
- RasterLayerNode blends with vector scene
- Export: rasterize to PNG/PDF with vector overlay
- Tests: render matches paint output, export preserves appearance

### Phase 7: Performance

- Worker-thread dab generation for large brushes
- Dirty-rect tracking for incremental re-render
- Tile cache invalidation
- Profile and optimize bust paths
- Stress test: 16Kx16K canvas, 1000+ strokes

### Phase 8: Integration Verification

- Undo/redo stroke verification
- Save/reopen document with painted layers
- Copy/paste raster layers
- Cross-browser pointer event tests
- Wayland vs X11 comparison
- Keyboard-only workflow

## Non-Goals (Deferred)

- Wet-media / paint mixing simulation
- Physics-based bristle brushes
- Procedural texture generation
- Brush stroke replay (non-destructive paint)
- WebGPU compute shader brush rendering
- Collaborative painting
- CMYK raster layers
- TIFF/PSD import of raster layers
- Cloud brush library sync

## Edge Cases (Covered by Tests)

- Zero-size brush → no-op
- Very large brush (>1024px diameter) → worker processing
- Extreme opacity (0%, 100%)
- Zero flow → no paint
- High flow → full paint per dab
- Missing tiles → return transparent
- Pressure stuck at 0 or 1 → clamp to valid range
- No pointer capture → cancel stroke
- Tool switch mid-stroke → abort transaction
- Save during stroke → commits before save
- Undo after stroke → tiles restored
- 10,000+ dabs in single stroke → memory-bounded
- Both browser tab suspension during stroke → abort on restore
