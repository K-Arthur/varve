# Brush System Overhaul: Smudge, Grain, Predicted Events, Wet-Paint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete integration of smudge tool, image-based grain textures, predicted-event preview rendering, and persistent wet-paint state across the paint/smudge pipeline.

**Architecture:** Extends the existing brush engine (`BrushPreset` → `generateDabs` → `compositeDabOnNode`) with new compositing modes, texture sampling, preview layers, and wet simulation. All four features share the brush parameter model, input normalization layer, and tile-based raster rendering.

**Tech Stack:** TypeScript, Canvas2D, OffscreenCanvas, Pointer Events L3, existing brush tile system, existing ImageCache singleton.

---

## Architecture Overview

The existing pipeline is:
```
PointerEvent → getCoalescedEvents() → StrokePoint[] → smoothStrokePoints() → generateDabs() → BrushDab[] → compositeDabOnNode() → RasterLayerNode.tiles
```

This plan extends it to:
```
PointerEvent → getCoalescedEvents() + getPredictedEvents() → NormalizedInputEvent[] → StrokePoint[]
  → CONFIRMED PATH: smoothStrokePoints() → generateDabs() → compositeDabOnNode() (with grain + wet-paint compositing)
  → PREDICTED PATH: smoothStrokePoints() → generateDabs() → compositeDabOnPreviewCanvas() (transient overlay)
  → SMUDGE PATH: sampleUnderBrush() → compositeSmudgeDabOnNode() (with grain + wet-paint interaction)
```

### File Map

| Layer | Existing Files | New/Modified Files |
|---|---|---|
| **Data Model** | `scene/src/brush.ts` — BrushPreset, BrushDab, StrokePoint, generateDabs | Extend BrushPreset with grain + wet fields |
| **Data Model** | `scene/src/rasterLayer.ts` — compositeDabOnNode, createBrushMask | Add `compositeSmudgeDabOnNode`, grain-aware compositing |
| **Data Model** | `scene/src/types.ts` — RasterLayerNode, RasterTile | Add wet-paint properties to RasterLayerNode |
| **Input Pipeline** | `editor/src/tools/inputNormalizer.ts` — collectSourceEvents, inputToStrokePoint | Enable predicted events in buildToolCtx |
| **Paint Tool** | `editor/src/tools/PaintTool.ts` | Add predicted preview, OneEuro smoothing, wet-paint interaction |
| **Smudge Tool** | — | NEW: `editor/src/tools/SmudgeTool.ts` |
| **Grain System** | — | NEW: `engine/src/grainSampler.ts` |
| **Preview System** | — | NEW: `editor/src/tools/PreviewCanvas.ts` — transient preview overlay |
| **Wet-Paint** | — | NEW: `scene/src/wetPaint.ts` — wet buffer, drying simulation |
| **Toolbar UI** | `editor/src/components/FloatingToolbar/FloatingToolbar.tsx` | Add smudge button |
| **Brush UI** | `editor/src/components/Inspector/sections/BrushSection.tsx` | Add smudge/wet/grain controls |
| **Tool Type** | `editor/src/tools/types.ts` — ToolId | Add 'smudge' |
| **Shortcuts** | `editor/src/shortcuts/ShortcutManager.ts` | Add smudge shortcut |
| **State** | `editor/src/context/types.ts` — EditorState.brushSettings | Add grain/wet/smudge fields |
| **Canvas** | `editor/src/CanvasArea.tsx` — getToolManager, buildToolCtx | Register smudge, enable predicted events |
| **Menubar** | `editor/src/Menubar.tsx` | Add smudge to menu |

### Data Flow for Each Feature

**Smudge:**
1. Tool activated → cursor changes to brush ring
2. Pointer down → find/create raster layer, sample pixels under brush center → store as smudge source
3. Pointer move → collect coalesced events, for each: sample destination pixels, mix source toward destination with brush mask, write back to tiles, advance source
4. Pointer up → commit transaction, clear smudge source

**Grain Textures:**
1. BrushPreset gains: `grainId?`, `grainScale`, `grainRotation`, `grainOffsetX/Y`, `grainContrast`, `grainInvert`
2. On dab compositing, if `grainId` is set, load texture from ImageCache
3. Sample texture at dab position (canvas-space or brush-space)
4. Multiply sampled grain value by dab opacity to create textured edge
5. Procedural grain (hash-based) is the default when no grainId is set

**Predicted Events:**
1. `collectSourceEvents(ev, true)` includes predicted events
2. In `onPointerMove`, separate confirmed events from predicted events
3. Confirmed events: flush to tiles (existing path)
4. Predicted events: render to a transient preview canvas (offscreen overlay)
5. On next `onPointerMove` with confirmed events: clear preview, re-render preview with new predictions
6. On `onPointerUp`: clear preview, commit only confirmed data

**Wet-Paint:**
1. RasterLayerNode gets optional `wetProperties: { enabled, wetness, dryingRate, mixStrength, wetEdge }`
2. A `WetBuffer` map (separate from tiles) tracks per-pixel wetness and accumulated color
3. When a dab touches wet pixels: mix new paint with wet paint in proportion to mixStrength
4. Drying is time-based: `wetness -= dt * dryingRate` per pixel
5. The wet buffer is ephemeral (not persisted in documents) but deterministic from parameters
6. Explicit "Dry Layer" action removes all wetness from the layer

---

## Implementation Tasks

### Task 0: Audit and Shared Contracts

**Files:**
- Modify: `packages/editor/src/tools/types.ts` — add 'smudge' to ToolId
- Modify: `packages/editor/src/context/types.ts` — add smudge, grain, wet fields to brushSettings
- Modify: `packages/scene/src/brush.ts` — add grain and wet fields to BrushPreset
- Create: `packages/engine/src/grainSampler.ts` — grain sampling functions
- Create: `packages/scene/src/wetPaint.ts` — wet-paint types and simulation
- Create: `packages/editor/src/tools/previewCanvas.ts` — transient preview overlay manager

- [ ] **Step 1: Extend ToolId**

Read `packages/editor/src/tools/types.ts`, add `'smudge'` to the ToolId union type.

```typescript
// In ToolId type, add 'smudge' to the union:
export type ToolId =
  | 'select'
  | 'hand'
  // ... existing ...
  | 'paint'
  | 'eraser'
  | 'smudge';
```

- [ ] **Step 2: Extend brushSettings state**

Read `packages/editor/src/context/types.ts`, add smudge/wet/grain fields to brushSettings.

```typescript
brushSettings: {
  presetId: string;
  radius: number;
  opacity: number;
  flow: number;
  hardness: number;
  smoothing: number;
  spacing: number;
  // New fields:
  // Smudge
  smudgeStrength: number;   // 0-1, how much paint is dragged
  smudgeMode: 'sampling' | 'mixing' | 'fingerpaint';
  // Grain
  grainId: string | null;
  grainScale: number;
  grainRotation: number;
  grainContrast: number;
  grainInvert: boolean;
  // Wet
  wetEnabled: boolean;
  wetEdge: boolean;
  wetMixStrength: number;  // 0-1, how much new paint mixes with wet
  wetDryingRate: number;   // 0-1, how fast wet paint dries
};
```

- [ ] **Step 3: Extend BrushPreset**

Read `packages/scene/src/brush.ts`, add grain and wet fields to the `BrushPreset` interface and `defaultBrushPreset` function.

```typescript
// In BrushPreset interface, add after grainScale:
grainRotation: number;
grainContrast: number;
grainInvert: boolean;
wetEnabled: boolean;
wetEdge: boolean;
wetMixStrength: number;
wetDryingRate: number;
smudgeStrength: number;

// In defaultBrushPreset, add defaults:
grainRotation: 0,
grainContrast: 1,
grainInvert: false,
wetEnabled: false,
wetEdge: false,
wetMixStrength: 0.5,
wetDryingRate: 0.05,
smudgeStrength: 0.5,
```

- [ ] **Step 4: Create grainSampler.ts**

Create `packages/engine/src/grainSampler.ts` with procedural hash grain and image texture sampling.

```typescript
/**
 * Grain texture sampling for brush strokes.
 *
 * Supports two modes:
 * 1. Procedural grain — deterministic hash function (no external assets)
 * 2. Image-based grain — texture loaded via ImageCache, sampled with
 *    configurable scale/rotation/offset/contrast/invert
 *
 * Research basis: MyPaint brush grain, Procreate texture brushes.
 */

import { getImageCache } from './imageCache';

export type GrainAnchor = 'brush' | 'canvas' | 'stroke';

export interface GrainSampleParams {
  /** Position in the relevant coordinate space. */
  x: number;
  y: number;
  /** Scale factor (1.0 = texture at 1:1 with canvas pixels). */
  scale: number;
  /** Rotation in radians. */
  rotation: number;
  /** Offset relative to brush/canvas origin. */
  offsetX: number;
  offsetY: number;
  /** Contrast adjustment (1.0 = identity). */
  contrast: number;
  /** Invert grain (1 - value). */
  invert: boolean;
  /** Anchor mode. */
  anchor: GrainAnchor;
  /** Stroke progress (0-1) for stroke-anchored grain. */
  strokeT: number;
  /** Brush seed for deterministic hash-based grain. */
  seed?: number;
}

/**
 * Sample procedural grain at a given position.
 * Uses a hash function seeded by position + seed for deterministic output.
 */
export function sampleProceduralGrain(
  x: number,
  y: number,
  seed: number = 0,
): number {
  // Simple hash: mix position and seed, return 0-1
  let h = seed | 1;
  h = ((h + x * 7919) * (h + y * 6271)) ^ (h * 104729);
  h = ((h << 13) ^ h) >>> 0;
  return (h & 0xffff) / 65536;
}

/**
 * Sample image-based grain texture.
 * Returns 0-1 grain value, or -1 if texture not loaded.
 */
export function sampleImageGrain(
  texture: HTMLImageElement | ImageBitmap | OffscreenCanvas,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  const cx = texture.width / 2;
  const cy = texture.height / 2;
  const cosA = Math.cos(params.rotation);
  const sinA = Math.sin(params.rotation);

  // Apply scale, rotation, offset
  const sx = ((x + params.offsetX) / params.scale - cx) * cosA - ((y + params.offsetY) / params.scale - cy) * sinA + cx;
  const sy = ((x + params.offsetX) / params.scale - cx) * sinA + ((y + params.offsetY) / params.scale - cy) * cosA + cy;

  // Wrap to texture bounds
  const tx = ((sx % texture.width) + texture.width) % texture.width;
  const ty = ((sy % texture.height) + texture.height) % texture.height;

  // Sample via offscreen canvas or ImageData
  // For simplicity, use a canvas-based sampler
  const ctx = sampleCtx();
  if (!ctx) return 0.5;

  ctx.drawImage(texture, tx, ty, 1, 1, 0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const gray = data[0]! / 255;

  let result = params.invert ? 1 - gray : gray;
  result = Math.pow(result, 1 / params.contrast); // Contrast adjustment
  return Math.max(0, Math.min(1, result));
}

/** Shared offscreen canvas for grain sampling (avoids allocation churn). */
let _sampleCanvas: OffscreenCanvas | null = null;
let _sampleCtx: OffscreenCanvasRenderingContext2D | null = null;

function sampleCtx(): OffscreenCanvasRenderingContext2D | null {
  if (!_sampleCanvas) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    _sampleCanvas = new OffscreenCanvas(1, 1);
    _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return _sampleCtx;
}

/**
 * Resolve grain value — tries image texture first, falls back to procedural.
 */
export async function resolveGrainValue(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): Promise<number> {
  if (grainId) {
    const cache = getImageCache();
    const img = cache.getImage(grainId);
    if (img) {
      return sampleImageGrain(img, x, y, params);
    }
    // Not loaded yet — try loading
    try {
      const loaded = await cache.load(grainId);
      return sampleImageGrain(loaded, x, y, params);
    } catch {
      // Fall through to procedural
    }
  }
  return sampleProceduralGrain(x, y, params.seed ?? 0);
}

/**
 * Synchronous grain value — use when texture is guaranteed loaded or
 * procedural grain is acceptable.
 */
export function resolveGrainValueSync(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  if (grainId) {
    const cache = getImageCache();
    const img = cache.getImage(grainId);
    if (img) {
      return sampleImageGrain(img, x, y, params);
    }
  }
  return sampleProceduralGrain(x, y, params.seed ?? 0);
}
```

Run: `pnpm typecheck --filter @varve/engine` — should pass.

- [ ] **Step 5: Create wetPaint.ts**

Create `packages/scene/src/wetPaint.ts`.

```typescript
/**
 * Wet-paint simulation for brush strokes.
 *
 * Architecture:
 * - Wet state is an ephemeral per-layer buffer (not persisted in documents).
 * - Each pixel has: wetness (0-1), accumulated color (RGBA premultiplied).
 * - Drying is time-based: wetness -= dt * dryingRate.
 * - New paint mixes with existing wet paint based on mixStrength.
 * - Wet edge darkens edges of brush strokes.
 *
 * The wet buffer is reconstructed from layer parameters + stroke history
 * on save/load. Since it's not persisted, after reload the buffer is empty
 * (consistent with how real wet paint doesn't survive closing an app).
 */

export interface WetPixel {
  wetness: number;          // 0 = dry, 1 = fully wet
  r: number;                // Premultiplied accumulated color 0-1
  g: number;
  b: number;
  a: number;
}

export interface WetProperties {
  enabled: boolean;
  wetEdge: boolean;
  wetEdgeSize: number;      // Fraction of brush radius
  wetEdgeDarken: number;    // 0-1, how much darker wet edges are
  mixStrength: number;      // 0-1, how much new paint mixes with wet paint
  dryingRate: number;       // Per-second wetness decay
}

export const DEFAULT_WET_PROPERTIES: WetProperties = {
  enabled: false,
  wetEdge: false,
  wetEdgeSize: 0.15,
  wetEdgeDarken: 0.3,
  mixStrength: 0.5,
  dryingRate: 0.05,
};

/**
 * Wet buffer — per-pixel wet state for a single raster layer.
 * Stores pixels as a flat Uint8Array (RGBA, 0-255) + wetness Float32Array.
 */
export class WetBuffer {
  readonly width: number;
  readonly height: number;
  /** Premultiplied RGBA accumulated wet paint (0-255). */
  readonly pixels: Uint8ClampedArray;
  /** Wetness per pixel (0-1). */
  readonly wetness: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.wetness = new Float32Array(width * height);
  }

  /** Get wet state at pixel (x, y). Returns null if out of bounds. */
  get(x: number, y: number): WetPixel | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const idx = (y * this.width + x) * 4;
    return {
      wetness: this.wetness[y * this.width + x]!,
      r: this.pixels[idx]! / 255,
      g: this.pixels[idx + 1]! / 255,
      b: this.pixels[idx + 2]! / 255,
      a: this.pixels[idx + 3]! / 255,
    };
  }

  /** Set wet state at pixel (x, y). */
  set(x: number, y: number, pixel: WetPixel): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.wetness[y * this.width + x] = pixel.wetness;
    this.pixels[idx] = clamp255(pixel.r * 255);
    this.pixels[idx + 1] = clamp255(pixel.g * 255);
    this.pixels[idx + 2] = clamp255(pixel.b * 255);
    this.pixels[idx + 3] = clamp255(pixel.a * 255);
  }

  /** Add paint to a pixel. Mixes with existing wet paint if present. */
  addPaint(
    x: number,
    y: number,
    color: [number, number, number, number],
    amount: number,
    mixStrength: number,
  ): void {
    const existing = this.get(x, y);
    if (!existing) return;

    const r = color[0]! / 255;
    const g = color[1]! / 255;
    const b = color[2]! / 255;
    const a = color[3]! / 255;

    let newR: number, newG: number, newB: number, newA: number;

    if (existing.wetness > 0 && mixStrength > 0) {
      // Mix with existing wet paint
      const mix = Math.min(existing.wetness, mixStrength);
      newR = r * (1 - mix) + existing.r * mix;
      newG = g * (1 - mix) + existing.g * mix;
      newB = b * (1 - mix) + existing.b * mix;
      newA = a * (1 - mix) + existing.a * mix;
    } else {
      newR = r;
      newG = g;
      newB = b;
      newA = a;
    }

    // Accumulate wetness (cap at 1)
    const newWetness = Math.min(1, existing.wetness + amount);

    this.set(x, y, {
      wetness: newWetness,
      r: newR * newA,
      g: newG * newA,
      b: newB * newA,
      a: newA,
    });
  }

  /** Apply time-based drying to all pixels. */
  dry(dtSeconds: number, dryingRate: number): void {
    if (dryingRate <= 0) return;
    const decay = Math.min(1, dtSeconds * dryingRate);
    const len = this.wetness.length;
    for (let i = 0; i < len; i++) {
      const w = this.wetness[i]!;
      if (w <= 0) continue;
      const newW = Math.max(0, w - decay);
      this.wetness[i] = newW;
      if (newW <= 0) {
        this.pixels[i * 4] = 0;
        this.pixels[i * 4 + 1] = 0;
        this.pixels[i * 4 + 2] = 0;
        this.pixels[i * 4 + 3] = 0;
      }
    }
  }

  /** Reset all pixels to dry. */
  clear(): void {
    this.pixels.fill(0);
    this.wetness.fill(0);
  }
}

function clamp255(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/**
 * Get the wet edge darkening factor for a pixel at a given distance from
 * the brush center, as a fraction of brush radius.
 */
export function wetEdgeDarkening(
  distRatio: number,
  edgeSize: number,
  darkenAmount: number,
): number {
  if (distRatio < 1 - edgeSize) return 0;
  if (distRatio >= 1) return 0;
  return (1 - (1 - distRatio) / edgeSize) * darkenAmount;
}
```

Run: `pnpm test --filter @varve/scene` — verify existing tests still pass.

- [ ] **Step 6: Create previewCanvas.ts**

Create `packages/editor/src/tools/previewCanvas.ts`.

```typescript
/**
 * Transient preview canvas for brush stroke preview rendering.
 *
 * Renders predicted pointer events as a temporary overlay that is:
 * - Drawn on top of the main canvas
 * - Cleared when confirmed events arrive
 * - Never committed to document history
 * - Discarded on pointer up / cancel / tool switch
 *
 * Architecture:
 * - Uses an OffscreenCanvas matching the canvas dimensions
 * - Stamped with predicted dabs using the same compositing as the real path
 * - On each re-prediction, the canvas is cleared and re-drawn
 * - The preview is composited over the main canvas via the draft overlay
 */

export class PreviewCanvas {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;

  /** Ensure the canvas is sized to match the given dimensions. */
  ensureSize(w: number, h: number): void {
    if (this.width === w && this.height === h && this.canvas) return;
    this.width = w;
    this.height = h;
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(w, h);
      this.ctx = this.canvas.getContext('2d');
    }
  }

  /** Clear the preview canvas. */
  clear(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Get the preview canvas for compositing. */
  getCanvas(): OffscreenCanvas | null {
    return this.canvas;
  }

  /** Destroy and free resources. */
  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
  }
}
```

- [ ] **Step 7: Extend Export from scene/src/brush.ts**

Add the new fields to `BrushPreset` export, `defaultBrushPreset`, `validateBrushPreset`, `clampBrushPreset`, and `BUILT_IN_BRUSH_PRESETS`.

- [ ] **Step 8: Verify shared contracts**

Run: `pnpm typecheck` — verify all packages pass with the new types.

Run: `pnpm test` — verify existing tests still pass with extended types (new fields have defaults).

---

### Task 1: Smudge Tool Implementation

**Files:**
- Create: `packages/editor/src/tools/SmudgeTool.ts`
- Create: `packages/editor/src/tools/__tests__/SmudgeTool.test.ts`
- Modify: `packages/editor/src/CanvasArea.tsx` — register 'smudge' tool
- Modify: `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — add smudge button
- Modify: `packages/editor/src/Menubar.tsx` — add smudge to Tools menu
- Modify: `packages/editor/src/shortcuts/ShortcutManager.ts` — add smudge shortcut
- Modify: `packages/editor/src/components/Inspector/sections/BrushSection.tsx` — add smudge controls
- Modify: `packages/scene/src/rasterLayer.ts` — add `compositeSmudgeDabOnNode`
- Modify: `packages/scene/src/brush.ts` — add `smudgeStrength` to BrushPreset

- [ ] **Step 1: Add smudge compositing to rasterLayer.ts**

Add a function that reads pixels from a tile, smears them in the direction of motion, and writes back. The smudge effect: for each pixel under the brush mask, blend the source pixel toward the destination pixel at a displacement proportional to smudgeStrength.

```typescript
/**
 * Composite a smudge dab onto a raster layer.
 * Smudge "drags" existing pixels in the direction of motion:
 * - Samples the destination pixels at the dab position
 * - Displaces them by (dx * strength, dy * strength)
 * - Blends displaced pixels with original using brush mask
 *
 * @param node - The raster layer node
 * @param dab - The brush dab (position, radius, shape)
 * @param direction - Movement direction in radians
 * @param strength - Smudge strength (0-1)
 * @returns A new raster layer node with smudged tiles
 */
export function compositeSmudgeDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  direction: number,
  strength: number,
): RasterLayerNode {
  const brushShape = dab.shape ?? 'circle';
  const brushMask = createBrushMask(dab.radius, dab.hardness, brushShape, dab.angle, dab.roundness);
  const dabDiameter = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    dabDiameter,
    dabDiameter,
  );

  const newTiles = new Map(node.tiles);

  // Displacement vector
  const displacement = dab.radius * strength * 0.5;
  const dx = Math.cos(direction) * displacement;
  const dy = Math.sin(direction) * displacement;

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    const tile = newTiles.get(key);
    if (!tile) continue;

    const newPixels = new Uint8ClampedArray(tile.pixels);
    const tileOriginX = col * TILE_SIZE;
    const tileOriginY = row * TILE_SIZE;
    const localDabX = dab.x - tileOriginX;
    const localDabY = dab.y - tileOriginY;

    const size = Math.ceil(dab.radius * 2);
    const offsetX = Math.round(localDabX - dab.radius);
    const offsetY = Math.round(localDabY - dab.radius);

    for (let my = 0; my < size; my++) {
      const py = offsetY + my;
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let mx = 0; mx < size; mx++) {
        const px = offsetX + mx;
        if (px < 0 || px >= TILE_SIZE) continue;
        const maskValue = brushMask[my * size + mx]!;
        if (maskValue <= 0) continue;

        const srcIdx = (py * TILE_SIZE + px) * 4;

        // Source pixel
        const sr = newPixels[srcIdx]!;
        const sg = newPixels[srcIdx + 1]!;
        const sb = newPixels[srcIdx + 2]!;
        const sa = newPixels[srcIdx + 3]!;
        if (sa === 0) continue;

        // Displaced pixel (clamped to tile bounds)
        const sx = Math.round(px - dx);
        const sy = Math.round(py - dy);
        if (sx < 0 || sx >= TILE_SIZE || sy < 0 || sy >= TILE_SIZE) continue;

        const dstIdx = (sy * TILE_SIZE + sx) * 4;
        const dr = newPixels[dstIdx]!;
        const dg = newPixels[dstIdx + 1]!;
        const db = newPixels[dstIdx + 2]!;
        const da = newPixels[dstIdx + 3]!;

        // Blend displaced pixel into source position proportionally to mask
        const t = maskValue * strength;
        const invT = 1 - t;

        newPixels[srcIdx] = clampByte(sr * invT + dr * t);
        newPixels[srcIdx + 1] = clampByte(sg * invT + dg * t);
        newPixels[srcIdx + 2] = clampByte(sb * invT + db * t);
        newPixels[srcIdx + 3] = clampByte(sa * invT + da * t);
      }
    }

    newTiles.set(key, { pixels: newPixels, version: tile.version + 1 });
  }

  return { ...node, tiles: newTiles };
}

function clampByte(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}
```

- [ ] **Step 2: Create SmudgeTool.ts**

Create `packages/editor/src/tools/SmudgeTool.ts`. It extends BaseTool similarly to PaintTool but uses `compositeSmudgeDabOnNode` instead of `compositeDabOnNode`. The tool:
- On pointer down: capture smudge source position
- On pointer move: smudge pixels from source toward current position
- Supports brush size/strength/hardness/spacing settings
- Shares BrushSection for settings UI (as 'smudge' tool type)
- Supports pressure sensitivity for strength
- Cursor shows brush ring

```typescript
import type { BrushDab, BrushPreset, RasterLayerNode } from '@varve/scene';
import {
  compositeSmudgeDabOnNode,
  defaultBrushPreset,
  generateDabs,
  seedJitter,
  smoothStrokePoints,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class SmudgeTool extends BaseTool {
  id = 'smudge' as const;

  private preset: BrushPreset;
  private strokePoints: import('@varve/scene').StrokePoint[] = [];
  private rasterNodeId: string | null = null;
  private strokeGeneration = 0;
  private transactionOpen = false;

  onSettingsChange?: (settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
  }) => void;

  constructor() {
    super();
    this.preset = defaultBrushPreset('smudge-brush', 'Smudge Brush');
    this.preset.smudgeStrength = 0.5;
    this.preset.blendMode = 'normal';
  }

  cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  updatePresetFromSettings(settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
  }): void {
    this.preset.id = settings.presetId;
    this.preset.radius = settings.radius;
    this.preset.opacity = settings.opacity;
    this.preset.flow = settings.flow;
    this.preset.hardness = settings.hardness;
    this.preset.smoothing = settings.smoothing;
    this.preset.spacing = settings.spacing;
    this.preset.smudgeStrength = settings.smudgeStrength;
  }

  getSettings(): {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
  } {
    return {
      presetId: this.preset.id,
      radius: this.preset.radius,
      opacity: this.preset.opacity,
      flow: this.preset.flow,
      hardness: this.preset.hardness,
      smoothing: this.preset.smoothing,
      spacing: this.preset.spacing,
      smudgeStrength: this.preset.smudgeStrength,
    };
  }

  override onActivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.transactionOpen) {
      this.abortStroke(ctx);
    }
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    ctx.beginTransaction();
    this.transactionOpen = true;

    const rasterNodeId = this.findOrCreateRasterLayer(ctx);
    if (!rasterNodeId) {
      ctx.abortTransaction();
      this.transactionOpen = false;
      return { consumed: false };
    }
    this.rasterNodeId = rasterNodeId;
    this.strokeGeneration++;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const avgTilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    const sp = strokePoint(world.x, world.y, { pressure, tilt: avgTilt });
    this.strokePoints = [sp];

    this.updatePreview(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);

    const events =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];

    for (const ev of events) {
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX ?? 0) + Math.abs(ev.tiltY ?? 0)) / 2;
      this.sampleStrokePoint(world, pressure, undefined, tilt);
    }

    this.flushDabs(ctx);
    this.updatePreview(ctx);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const tilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    this.sampleStrokePoint(world, pressure, undefined, tilt);

    this.flushDabs(ctx);
    ctx.commitTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);

    super.onPointerUp(e, ctx);
    this.resetState();
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.abortStroke(_ctx);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.drag.kind === 'dragging') {
      this.abortStroke(ctx);
      ctx.setDraft(null);
      return true;
    }
    if (e.key === '[') {
      this.preset.radius = Math.max(1, this.preset.radius - 2);
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      if (this.drag.kind === 'dragging') this.updatePreview(ctx);
      return true;
    }
    if (e.key === ']') {
      this.preset.radius += 2;
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      if (this.drag.kind === 'dragging') this.updatePreview(ctx);
      return true;
    }
    return false;
  }

  private sampleStrokePoint(
    world: { x: number; y: number },
    pressure: number,
    time?: number,
    tilt?: number,
  ): void {
    const pts = this.strokePoints;
    if (pts.length === 0) return;
    const last = pts[pts.length - 1]!;
    const t = time ?? performance.now();

    const dx = world.x - last.x;
    const dy = world.y - last.y;
    if (dx * dx + dy * dy < 1) return;

    const speed = t - last.time > 0 ? (Math.sqrt(dx * dx + dy * dy) / (t - last.time)) * 1000 : 0;
    const direction = Math.atan2(dy, dx);
    const sp = strokePoint(world.x, world.y, {
      pressure,
      tilt: tilt ?? last.tilt,
      direction,
      speed,
      time: t,
    });
    pts.push(sp);
  }

  private flushDabs(ctx: ToolContext): void {
    const rasterNodeId = this.rasterNodeId;
    if (!rasterNodeId) return;

    const pts = this.strokePoints;
    if (pts.length < 2) return;

    const smoothed = smoothStrokePoints(pts, this.preset.smoothing);
    const dabs = generateDabs(smoothed, this.preset);
    if (dabs.length === 0) return;

    // Compute smudge direction from stroke
    const first = smoothed[0]!;
    const last = smoothed[smoothed.length - 1]!;
    const direction = Math.atan2(last.y - first.y, last.x - first.x);

    ctx.updateNode(rasterNodeId, (node) => {
      const raster = node as RasterLayerNode;
      let updated = raster;
      for (const dab of dabs) {
        updated = compositeSmudgeDabOnNode(
          updated,
          dab,
          direction,
          this.preset.smudgeStrength,
        );
      }
      return updated;
    });

    this.strokePoints = [pts[pts.length - 1]!];
  }

  private updatePreview(ctx: ToolContext): void {
    const radius = this.preset.radius;
    ctx.setDraft({
      kind: 'ellipse',
      x: this.drag.currentWorld.x - radius,
      y: this.drag.currentWorld.y - radius,
      w: radius * 2,
      h: radius * 2,
      label: `${Math.round(radius)}px`,
    });
  }

  private findOrCreateRasterLayer(ctx: ToolContext): string | null {
    // Reuse existing raster layers, or create a new one
    const candidates = this.findExistingRasterLayer(ctx);
    if (candidates) return candidates;
    const nodeId = ctx.createRasterLayer(4096, 4096);
    return nodeId;
  }

  private findExistingRasterLayer(ctx: ToolContext): string | null {
    const doc = ctx.document;
    const pageId = doc.activePageId;
    const contentRootId = pageId
      ? (doc.pages ?? []).find((p) => p.id === pageId)?.contentRoot
      : null;

    const candidates: string[] = contentRootId
      ? ((doc.nodes[contentRootId] as { children?: string[] })?.children ?? doc.rootChildren)
      : doc.rootChildren;

    for (const nodeId of candidates) {
      const node = doc.nodes[nodeId];
      if (node?.kind === 'rasterLayer') {
        return nodeId;
      }
    }
    return null;
  }

  private abortStroke(ctx: ToolContext): void {
    if (!this.transactionOpen) return;
    ctx.abortTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.resetState();
  }

  private resetState(): void {
    this.strokePoints = [];
    this.rasterNodeId = null;
  }
}
```

- [ ] **Step 3: Register 'smudge' in getToolManager()**

Read `packages/editor/src/CanvasArea.tsx`. Add to `getToolManager()`:

```typescript
toolManager.register('smudge', () => new SmudgeTool());
```

Import: `import { SmudgeTool } from './tools/SmudgeTool';`

- [ ] **Step 4: Add smudge to FloatingToolbar**

Read `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx`.

Add to `INDIVIDUAL_TOOLS`:
```typescript
{ id: 'smudge', groupStart: true },
```

Add to `TOOL_LABELS`:
```typescript
smudge: 'Smudge',
```

Add to `TOOL_SHORTCUTS`:
```typescript
smudge: 'U',
```

- [ ] **Step 5: Add smudge shortcut**

Read `packages/editor/src/shortcuts/ShortcutManager.ts`. Add to `SHORTCUT_DEFS`:
```typescript
toolSmudge: { binding: { key: 'u' }, label: 'Smudge tool', category: 'Tools' },
```

Add to `useShortcuts.ts` handler switch:
```typescript
case 'toolSmudge': return () => { setToolRef.current?.('smudge'); };
```

- [ ] **Step 6: Add smudge to BrushSection**

Read `packages/editor/src/components/Inspector/sections/BrushSection.tsx`. The BrushSection already accepts `'paint' | 'eraser' | 'pencil'`. Extend to accept `'smudge'`.

Add smudge-specific controls (strength) when `tool === 'smudge'`.

- [ ] **Step 7: Add smudge to Menubar**

Read `packages/editor/src/Menubar.tsx`. Add smudge to the Tools menu.

- [ ] **Step 8: Extend EditorState brushSettings and setBrushSetting**

The `setBrushSetting` function in context needs to handle the new smudge fields. Read `packages/editor/src/context/useBackgroundRemoval.ts` or wherever `setBrushSetting` is wired.

Add the new brush setting fields to the state and setter.

- [ ] **Step 9: Write SmudgeTool tests**

Create `packages/editor/src/tools/__tests__/SmudgeTool.test.ts`. Test:
- Tool registration and activation
- Pointer down creates transaction
- Pointer move with coalesced events smudges tiles
- Pointer up commits transaction
- Brush size adjustment via [ / ] keys
- Default smudge strength
- Cancel via Escape
- Locked/invisible layer handling

---

### Task 2: Image-Based Grain Texture Integration

**Files:**
- Create: `packages/engine/src/grainSampler.test.ts`
- Modify: `packages/engine/src/index.ts` — export grainSampler
- Modify: `packages/scene/src/rasterLayer.ts` — grain-aware dab compositing
- Modify: `packages/editor/src/components/Inspector/sections/BrushSection.tsx` — grain controls
- Modify: `packages/editor/src/context/types.ts` — grain settings in brushSettings

- [ ] **Step 1: Write grain sampler tests**

Create `packages/engine/src/grainSampler.test.ts`:
- Test procedural grain is deterministic (same seed + position → same value)
- Test procedural grain returns 0-1 range
- Test image grain sampling with a known pattern
- Test grain contrast adjustment
- Test grain inversion

- [ ] **Step 2: Export grainSampler from engine**

Read `packages/engine/src/index.ts`. Add:
```typescript
export * from './grainSampler';
```

- [ ] **Step 3: Add grain-aware compositing**

Modify `compositeDabOnNode` or `compositeBrushDabOnPixels` in `rasterLayer.ts` to optionally apply grain.

The approach: add a `grainValue` parameter to `compositeBrushDabOnPixels`. When > 0, modulate the dab opacity by the grain value.

```typescript
function applyGrainToAlpha(
  alpha: number,
  grainValue: number,
  contrast: number,
  invert: boolean,
): number {
  let g = invert ? 1 - grainValue : grainValue;
  g = Math.pow(g, 1 / Math.max(0.01, contrast));
  return alpha * g;
}
```

- [ ] **Step 4: Add grain controls to BrushSection**

Add a collapsible "Grain" section with:
- Texture selector (dropdown, or file input for importing)
- Scale slider
- Rotation slider
- Contrast slider
- Invert toggle

- [ ] **Step 5: Add grain settings to editor state**

The `setBrushSetting` function already dispatches to state updates. Ensure the grain fields are included in the state update.

---

### Task 3: Predicted Event Preview Rendering

**Files:**
- Modify: `packages/editor/src/tools/inputNormalizer.ts` — no changes needed (already supports predicted)
- Modify: `packages/editor/src/CanvasArea.tsx` — enable predicted events in buildToolCtx
- Modify: `packages/editor/src/tools/PaintTool.ts` — use predicted events for preview
- Modify: `packages/editor/src/tools/SmudgeTool.ts` — use predicted events for preview

- [ ] **Step 1: Enable predicted events in buildToolCtx**

Read `packages/editor/src/CanvasArea.tsx`, find `buildToolCtx(ev)`. Change:
```typescript
const sourceEvents = collectSourceEvents(ev, true); // was false
```

- [ ] **Step 2: Add predicted preview to PaintTool**

In PaintTool's `onPointerMove`:
1. Separate coalesced (confirmed) events from predicted events
2. Process confirmed events normally → `flushDabs`
3. For predicted events: generate dabs, compose to transient preview canvas
4. On next `onPointerMove` with confirmed events: clear preview first

```typescript
// In onPointerMove, after processing coalesced events:
if (predictedEvents.length > 0) {
  this.renderPredictedPreview(ctx, predictedEvents);
}
```

And a new method:
```typescript
private renderPredictedPreview(
  ctx: ToolContext,
  predictedEvents: PointerEvent[],
): void {
  const rasterNodeId = this.rasterNodeId;
  if (!rasterNodeId) return;

  // Clear previous preview
  this.previewCanvas.clear();

  // Convert predicted events to StrokePoints
  const predictedPoints: import('@varve/scene').StrokePoint[] = [];
  for (const ev of predictedEvents) {
    const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
    const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
    const tilt = (Math.abs(ev.tiltX ?? 0) + Math.abs(ev.tiltY ?? 0)) / 2;
    predictedPoints.push(strokePoint(world.x, world.y, { pressure, tilt }));
  }

  if (predictedPoints.length < 2) return;

  // Predict direction from last confirmed + first predicted point
  const smoothed = smoothStrokePoints(predictedPoints, this.preset.smoothing);
  const dabs = generateDabs(smoothed, this.preset);
  if (dabs.length === 0) return;

  // Render to preview canvas with reduced opacity
  const canvas = ctx.canvasElement;
  if (!canvas) return;
  this.previewCanvas.ensureSize(canvas.width, canvas.height);

  // Draw dabs as semi-transparent overlay via setDraft
  // Use a simplified draft shape to show predicted stroke
  ctx.setDraft({
    kind: 'line',
    x1: dabs[0]?.x ?? 0,
    y1: dabs[0]?.y ?? 0,
    x2: dabs[dabs.length - 1]?.x ?? 0,
    y2: dabs[dabs.length - 1]?.y ?? 0,
  });
}
```

Also add to `onPointerUp`:
```typescript
// Clear predicted preview
ctx.setDraft(null);
this.previewCanvas.clear();
```

- [ ] **Step 3: Add same to SmudgeTool**

Same pattern as PaintTool for predicted event preview.

---

### Task 4: Persistent Wet-Paint State

**Files:**
- Modify: `packages/scene/src/types.ts` — add wetProperties to RasterLayerNode
- Modify: `packages/scene/src/rasterLayer.ts` — wet-paint writing and preview during compositing
- Create: `packages/scene/src/__tests__/wetPaint.test.ts`
- Modify: `packages/editor/src/tools/PaintTool.ts` — wet-paint interaction
- Modify: `packages/editor/src/components/Inspector/sections/BrushSection.tsx` — wet controls
- Modify: `packages/editor/src/context/types.ts` — wet settings in brushSettings

- [ ] **Step 1: Write wet-paint tests**

Create `packages/scene/src/__tests__/wetPaint.test.ts`:
- Test WetBuffer.get/set
- Test WetBuffer.addPaint mixes with existing wet paint
- Test WetBuffer.dry reduces wetness over time
- Test WetBuffer.clear resets all
- Test wetEdgeDarkening computation

- [ ] **Step 2: Extend PaintTool for wet-paint**

During dab compositing, check if `this.preset.wetEnabled`. If so:
1. Add paint to WetBuffer
2. Modify dab opacity based on wet edge
3. Apply wet mixing to existing wet paint

The WetBuffer is owned by the PaintTool instance per raster layer. Use a Map<string, WetBuffer> keyed by rasterNodeId.

- [ ] **Step 3: Add wet controls to BrushSection**

Add a collapsible "Wet Paint" section with:
- Enable toggle
- Wet edge toggle + size
- Mix strength slider
- Drying rate slider
- "Dry Layer" button

- [ ] **Step 4: Extend RasterLayerNode with wet properties**

In `packages/scene/src/types.ts`, add optional field:
```typescript
wetProperties?: {
  enabled: boolean;
  wetEdge: boolean;
  wetEdgeSize: number;
  mixStrength: number;
  dryingRate: number;
};
```

---

### Task 5: Tests, Fixtures, E2E

**Files:**
- Create: `packages/editor/src/tools/__tests__/SmudgeTool.test.ts`
- Create: `packages/engine/src/grainSampler.test.ts`
- Create: `packages/scene/src/__tests__/wetPaint.test.ts`
- Modify: `packages/editor/src/tools/__tests__/PaintTool.test.ts` — add predicted event tests
- Create: `tests/e2e/canvas/brush-smudge.spec.ts`

- [ ] **Step 1: Run all existing tests to establish baseline**
- [ ] **Step 2: Write and run all new unit tests**
- [ ] **Step 3: Run typecheck across all packages**
- [ ] **Step 4: Run lint**
- [ ] **Step 5: Run emoji and token audits**
- [ ] **Step 6: Final verification**

---

## Completion Criteria

- SmudgeTool is discoverable, shortcut-enabled ('U'), has toolbar button, cursor ring
- Smudge compositing smears existing pixels without introducing new color
- Grain textures load from ImageCache, sample deterministically, fall back to procedural
- Predicted events produce transient preview that clears reliably
- Wet paint mixes across strokes, dries over time, has explicit "dry" action
- All existing tests pass; new tests cover smudge, grain, wet, predicted events
- Bridge-typecheck + lint + emoji + token audits pass
