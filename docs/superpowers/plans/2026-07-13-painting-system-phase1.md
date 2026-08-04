# Painting System Phase 1: RasterLayerNode + Tile Storage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RasterLayerNode type to the scene document model with tile-based pixel storage, serialization, and basic CRUD operations.

**Architecture:** A new `kind: 'rasterLayer'` SceneNode variant that stores pixel data as 128×128 RGBA tiles. Tiles are lazily allocated — only tiles with painted content exist. Serialized as base64 in document JSON.

**Tech Stack:** TypeScript, @varve/scene package

---

### Task 1: Add RasterLayerNode type to scene model

**Files:**
- Modify: `packages/scene/src/types.ts`
- Create: `packages/scene/src/rasterLayer.ts`
- Test: `packages/scene/src/__tests__/rasterLayer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/scene/src/__tests__/rasterLayer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeRasterLayerNode } from '../rasterLayer';
import { type RasterLayerNode, type SceneNode } from '../types';

describe('RasterLayerNode', () => {
  it('creates a raster layer node with correct kind', () => {
    const node = makeRasterLayerNode('test-1', { width: 1920, height: 1080 });
    expect(node.kind).toBe('rasterLayer');
    expect(node.width).toBe(1920);
    expect(node.height).toBe(1080);
    expect(node.tiles.size).toBe(0); // no painted tiles yet
  });

  it('uses default name and opts', () => {
    const node = makeRasterLayerNode('test-2', { width: 100, height: 200 });
    expect(node.name).toBe('Raster Layer');
    expect(node.visible).toBe(true);
    expect(node.locked).toBe(false);
    expect(node.opacity).toBe(1);
    expect(node.blendMode).toBe('normal');
  });

  it('accepts optional overrides', () => {
    const node = makeRasterLayerNode('test-3', { width: 400, height: 300 }, {
      name: 'Sketch Layer',
      opacity: 0.5,
      visible: false,
      locked: true,
      blendMode: 'multiply',
    });
    expect(node.name).toBe('Sketch Layer');
    expect(node.opacity).toBe(0.5);
    expect(node.visible).toBe(false);
    expect(node.locked).toBe(true);
    expect(node.blendMode).toBe('multiply');
  });

  it('produces a valid SceneNode', () => {
    const node = makeRasterLayerNode('test-4', { width: 64, height: 64 }) as SceneNode;
    expect(node.kind).toBe('rasterLayer');
  });
});
```

Run: `npx vitest run packages/scene/src/__tests__/rasterLayer.test.ts --reporter=verbose`
Expected: FAIL — `makeRasterLayerNode` not defined

- [ ] **Step 2: Implement RasterLayerNode type and factory**

First, add the `RasterLayerNode` interface to `packages/scene/src/types.ts`:

After the `PathNode` interface (line ~711), add:

```typescript
// ── Raster Layer Node ─────────────────────────────────────────────────────────

export interface RasterTile {
  /** RGBA pixel data (128 * 128 * 4 bytes per tile). */
  pixels: Uint8ClampedArray;
  /** Monotonic version for cache invalidation. */
  version: number;
}

export interface RasterLayerNode extends NodeBase {
  kind: 'rasterLayer';
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Whether to constrain drawing to pixel grid. */
  pixelMode: boolean;
  /** Tile storage: key = "{col}:{row}" in 128×128 grid. */
  tiles: Map<string, RasterTile>;
}
```

Update the `SceneNode` union (line ~713) to include `RasterLayerNode`:

```typescript
export type SceneNode = ShapeNode | TextNode | GroupNode | FrameNode | AdjustmentNode | PathNode | RasterLayerNode;
```

Create `packages/scene/src/rasterLayer.ts`:

```typescript
import type { RasterLayerNode, RasterTile } from './types';
import { nextNodeId } from './node-id';

export const TILE_SIZE = 128;

export interface TileKey {
  col: number;
  row: number;
}

export function makeTileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function parseTileKey(key: string): TileKey {
  const [col, row] = key.split(':').map(Number);
  return { col: col!, row: row! };
}

export function tileForPixel(x: number, y: number): TileKey {
  return {
    col: Math.floor(x / TILE_SIZE),
    row: Math.floor(y / TILE_SIZE),
  };
}

export function createEmptyTile(): RasterTile {
  return {
    pixels: new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4),
    version: 1,
  };
}

export function makeRasterLayerNode(
  id: string,
  options: { width: number; height: number },
  opts: Partial<
    Pick<
      RasterLayerNode,
      'name' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'rotation' | 'order'
    >
  > = {},
): RasterLayerNode {
  return {
    id,
    kind: 'rasterLayer',
    name: opts.name ?? 'Raster Layer',
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    width: Math.max(1, options.width),
    height: Math.max(1, options.height),
    pixelMode: false,
    tiles: new Map(),
  };
}

export function getTileAt(node: RasterLayerNode, x: number, y: number): { tile: RasterTile; key: string } | null {
  if (x < 0 || y < 0 || x >= node.width || y >= node.height) return null;
  const { col, row } = tileForPixel(x, y);
  const key = makeTileKey(col, row);
  const tile = node.tiles.get(key);
  if (!tile) return null;
  return { tile, key };
}

export function getOrCreateTile(node: RasterLayerNode, x: number, y: number): { tile: RasterTile; key: string } {
  if (x < 0 || y < 0 || x >= node.width || y >= node.height) {
    throw new Error(`Pixel (${x}, ${y}) is outside raster layer bounds (${node.width}x${node.height})`);
  }
  const { col, row } = tileForPixel(x, y);
  const key = makeTileKey(col, row);
  let tile = node.tiles.get(key);
  if (!tile) {
    tile = createEmptyTile();
  }
  return { tile, key };
}

export function pixelOffsetInTile(x: number, y: number): { ox: number; oy: number } {
  return {
    ox: x % TILE_SIZE,
    oy: y % TILE_SIZE,
  };
}

export function tileBounds(col: number, row: number): { x: number; y: number; w: number; h: number } {
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

export function tilesForBounds(
  x: number, y: number, w: number, h: number,
): TileKey[] {
  const start = tileForPixel(x, y);
  const end = tileForPixel(x + w - 1, y + h - 1);
  const keys: TileKey[] = [];
  for (let row = start.row; row <= end.row; row++) {
    for (let col = start.col; col <= end.col; col++) {
      keys.push({ col, row });
    }
  }
  return keys;
}
```

- [ ] **Step 3: Export from index**

Add `export * from './rasterLayer';` to `packages/scene/src/index.ts` (after `./paint` line ~26).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/scene/src/__tests__/rasterLayer.test.ts --reporter=verbose`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/types.ts packages/scene/src/rasterLayer.ts packages/scene/src/index.ts packages/scene/src/__tests__/rasterLayer.test.ts
git commit -m "feat(scene): add RasterLayerNode type with tile storage"
```

---

### Task 2: Tile serialization (base64 in JSON)

**Files:**
- Modify: `packages/scene/src/rasterLayer.ts`
- Modify: `packages/scene/src/__tests__/rasterLayer.test.ts`

- [ ] **Step 1: Write failing serialization test**

Add to `packages/scene/src/__tests__/rasterLayer.test.ts`:

```typescript
import { serializeTiles, deserializeTiles, type SerializableTiles } from '../rasterLayer';

describe('Tile serialization', () => {
  it('serializes and deserializes a tile', () => {
    const tile: RasterTile = {
      pixels: new Uint8ClampedArray(128 * 128 * 4),
      version: 1,
    };
    // Fill with a known pattern
    tile.pixels[0] = 255; tile.pixels[1] = 128; tile.pixels[2] = 64; tile.pixels[3] = 255;
    tile.pixels[4] = 10; tile.pixels[5] = 20; tile.pixels[6] = 30; tile.pixels[7] = 40;

    const tiles = new Map<string, RasterTile>();
    tiles.set('0:0', tile);

    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);

    expect(deserialized.size).toBe(1);
    const restored = deserialized.get('0:0')!;
    expect(restored.version).toBe(1);
    expect(restored.pixels[0]).toBe(255);
    expect(restored.pixels[1]).toBe(128);
    expect(restored.pixels[2]).toBe(64);
    expect(restored.pixels[3]).toBe(255);
    expect(restored.pixels[4]).toBe(10);
    expect(restored.pixels[5]).toBe(20);
    expect(restored.pixels[6]).toBe(30);
    expect(restored.pixels[7]).toBe(40);
  });

  it('serializes empty tile map', () => {
    const tiles = new Map<string, RasterTile>();
    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);
    expect(deserialized.size).toBe(0);
  });

  it('handles multiple tiles', () => {
    const tiles = new Map<string, RasterTile>();
    tiles.set('0:0', createEmptyTile());
    tiles.set('1:0', createEmptyTile());
    tiles.set('0:1', createEmptyTile());
    tiles.get('0:0')!.pixels[0] = 42;

    const serialized = serializeTiles(tiles);
    const deserialized = deserializeTiles(serialized);
    expect(deserialized.size).toBe(3);
    expect(deserialized.get('0:0')!.pixels[0]).toBe(42);
    expect(deserialized.get('1:0')!.pixels[0]).toBe(0);
  });
});
```

- [ ] **Step 2: Implement serialization**

Add to `packages/scene/src/rasterLayer.ts`:

```typescript
export interface SerializableTileData {
  pixels: string; // base64-encoded Uint8ClampedArray
  version: number;
}

export type SerializableTiles = Record<string, SerializableTileData>;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function serializeTiles(tiles: Map<string, RasterTile>): SerializableTiles {
  const result: SerializableTiles = {};
  for (const [key, tile] of tiles) {
    result[key] = {
      pixels: arrayBufferToBase64(tile.pixels.buffer),
      version: tile.version,
    };
  }
  return result;
}

export function deserializeTiles(data: SerializableTiles): Map<string, RasterTile> {
  const tiles = new Map<string, RasterTile>();
  for (const [key, serialized] of Object.entries(data)) {
    tiles.set(key, {
      pixels: new Uint8ClampedArray(base64ToArrayBuffer(serialized.pixels)),
      version: serialized.version,
    });
  }
  return tiles;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/scene/src/__tests__/rasterLayer.test.ts --reporter=verbose`
Expected: PASS (7 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/scene/src/rasterLayer.ts packages/scene/src/__tests__/rasterLayer.test.ts
git commit -m "feat(scene): add tile serialization (base64 round-trip)"
```

---

### Task 3: Tile compositing and pixel manipulation

**Files:**
- Modify: `packages/scene/src/rasterLayer.ts`
- Test: `packages/scene/src/__tests__/rasterLayer.test.ts`

- [ ] **Step 1: Write failing composite tests**

Add to `packages/scene/src/__tests__/rasterLayer.test.ts`:

```typescript
import { compositeDabOnNode, compositeDabOnTiles } from '../rasterLayer';
import { defaultBrushPreset, generateDabs, strokePoint } from '../brush';

describe('Tile compositing', () => {
  it('composites a dab onto a node tile', () => {
    const node = makeRasterLayerNode('test-comp-1', { width: 256, height: 256 });
    const dab = { x: 64, y: 64, radius: 10, opacity: 1, flow: 1, hardness: 0.8, angle: 0, roundness: 1, strokeT: 0 };
    const color: [number, number, number, number] = [255, 0, 0, 255];

    const result = compositeDabOnNode(node, dab, color);
    expect(result.tiles.get('0:0')).toBeDefined();
    // Pixel at dab center should be red
    const tile = result.tiles.get('0:0')!;
    const offset = (64 % 128) + (64 % 128) * 128 * 4;
    expect(tile.pixels[offset]).toBe(255);     // R
    expect(tile.pixels[offset + 1]).toBe(0);   // G
    expect(tile.pixels[offset + 2]).toBe(0);   // B
    expect(tile.pixels[offset + 3]).toBe(255); // A
  });

  it('spans multiple tiles for large brushes', () => {
    const node = makeRasterLayerNode('test-comp-2', { width: 256, height: 256 });
    // Dab near the corner of tile 0:0, spanning into tile 1:0 and 0:1
    const dab = { x: 120, y: 120, radius: 30, opacity: 1, flow: 1, hardness: 0.8, angle: 0, roundness: 1, strokeT: 0 };
    const color: [number, number, number, number] = [0, 255, 0, 255];

    const result = compositeDabOnNode(node, dab, color);
    // Should touch tiles 0:0, 1:0, 0:1, 1:1
    expect(result.tiles.get('0:0')).toBeDefined();
    expect(result.tiles.get('1:0')).toBeDefined();
    expect(result.tiles.get('0:1')).toBeDefined();
    expect(result.tiles.get('1:1')).toBeDefined();
  });

  it('creates new tiles only where dabs land', () => {
    const node = makeRasterLayerNode('test-comp-3', { width: 512, height: 512 });
    expect(node.tiles.size).toBe(0);

    const dab = { x: 10, y: 10, radius: 5, opacity: 1, flow: 1, hardness: 1, angle: 0, roundness: 1, strokeT: 0 };
    const result = compositeDabOnNode(node, dab, [255, 255, 255, 255]);
    // Only one tile should be created
    expect(result.tiles.size).toBe(1);
    expect(result.tiles.has('0:0')).toBe(true);
  });
});
```

- [ ] **Step 2: Implement tile compositing**

Add to `packages/scene/src/rasterLayer.ts`:

```typescript
import type { BrushDab } from './brush';

function createBrushMask(radius: number, hardness: number): Float64Array {
  const size = Math.ceil(radius * 2);
  const mask = new Float64Array(size * size);
  const cx = radius;
  const cy = radius;
  const innerRadius = radius * (1 - hardness);
  const falloff = radius - innerRadius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radius) {
        mask[y * size + x] = 0;
      } else if (dist <= innerRadius || falloff === 0) {
        mask[y * size + x] = 1;
      } else {
        mask[y * size + x] = 1 - (dist - innerRadius) / falloff;
      }
    }
  }
  return mask;
}

function compositeBrushDabOnPixels(
  pixels: Uint8ClampedArray,
  tileW: number,
  dabX: number, dabY: number,
  dabRadius: number,
  dabOpacity: number,
  dabFlow: number,
  brushMask: Float64Array,
  color: readonly [number, number, number, number],
  alphaLock: boolean,
): void {
  const size = Math.ceil(dabRadius * 2);
  const offsetX = Math.round(dabX - dabRadius);
  const offsetY = Math.round(dabY - dabRadius);

  for (let my = 0; my < size; my++) {
    const py = offsetY + my;
    if (py < 0 || py >= tileW) continue;
    for (let mx = 0; mx < size; mx++) {
      const px = offsetX + mx;
      if (px < 0 || px >= tileW) continue;
      const maskValue = brushMask[my * size + mx];
      if (maskValue <= 0) continue;

      const srcAlpha = color[3]! / 255;
      const effectiveAlpha = maskValue * dabOpacity * dabFlow * srcAlpha;
      if (effectiveAlpha <= 0) continue;

      const idx = (py * tileW + px) * 4;
      const destAlpha = pixels[idx + 3]! / 255;
      const outAlpha = destAlpha + effectiveAlpha * (1 - destAlpha);
      if (outAlpha <= 0) continue;

      if (alphaLock && destAlpha === 0) continue;

      pixels[idx] = (color[0]! / 255 * effectiveAlpha * (1 - destAlpha) + pixels[idx]! / 255 * destAlpha) / outAlpha * 255;
      pixels[idx + 1] = (color[1]! / 255 * effectiveAlpha * (1 - destAlpha) + pixels[idx + 1]! / 255 * destAlpha) / outAlpha * 255;
      pixels[idx + 2] = (color[2]! / 255 * effectiveAlpha * (1 - destAlpha) + pixels[idx + 2]! / 255 * destAlpha) / outAlpha * 255;
      pixels[idx + 3] = outAlpha * 255;
    }
  }
}

export function compositeDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  color: readonly [number, number, number, number],
  alphaLock = false,
): RasterLayerNode {
  const brushMask = createBrushMask(dab.radius, dab.hardness);
  const dabDiameter = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    dabDiameter,
    dabDiameter,
  );

  const newTiles = new Map(node.tiles);

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    let tile = newTiles.get(key);
    if (!tile) {
      tile = createEmptyTile();
    }
    // Make a copy for immutability
    const newPixels = new Uint8ClampedArray(tile.pixels);
    const newTile = { pixels: newPixels, version: tile.version + 1 };

    // Dab position relative to tile origin
    const tileOriginX = col * TILE_SIZE;
    const tileOriginY = row * TILE_SIZE;
    const localDabX = dab.x - tileOriginX;
    const localDabY = dab.y - tileOriginY;

    compositeBrushDabOnPixels(
      newTile.pixels, TILE_SIZE,
      localDabX, localDabY,
      dab.radius, dab.opacity, dab.flow,
      brushMask, color, alphaLock,
    );

    newTiles.set(key, newTile);
  }

  return { ...node, tiles: newTiles };
}

export function compositeDabOnTiles(
  tiles: Map<string, RasterTile>,
  dab: BrushDab,
  color: readonly [number, number, number, number],
  alphaLock = false,
): Map<string, RasterTile> {
  const node: RasterLayerNode = {
    id: '',
    kind: 'rasterLayer',
    name: '',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
    pixelMode: false,
    tiles,
  };
  return compositeDabOnNode(node, dab, color, alphaLock).tiles;
}
```

- [ ] **Step 3: Export from rasterLayer.ts**

Make sure `compositeDabOnNode`, `compositeDabOnTiles`, `BrushDab` are exported from `rasterLayer.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/scene/src/__tests__/rasterLayer.test.ts --reporter=verbose`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/rasterLayer.ts packages/scene/src/__tests__/rasterLayer.test.ts
git commit -m "feat(scene): add tile compositing for brush dabs"
```

---

### Task 4: Integrate with document CRUD (addNode, removeNode, walkNodes)

**Files:**
- Modify: `packages/scene/src/types.ts` — update `isContainer`
- Modify: `packages/scene/src/document.ts` — add RasterLayerNode handling
- Modify: `packages/scene/src/visitor.ts` — add `raster` kind
- Test: `packages/scene/src/__tests__/rasterLayer.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add to `packages/scene/src/__tests__/rasterLayer.test.ts`:

```typescript
import { createDocument, addNode, removeNode, walkNodes } from '../document';

describe('RasterLayerNode document integration', () => {
  it('can be added to a document', () => {
    let doc = createDocument('test-doc');
    const layer = makeRasterLayerNode('rl-1', { width: 800, height: 600 });
    doc = addNode(doc, layer, { parentId: doc.rootChildren[0]! });
    expect(doc.nodes['rl-1']).toBeDefined();
    expect(doc.nodes['rl-1']!.kind).toBe('rasterLayer');
  });

  it('appears in walkNodes', () => {
    let doc = createDocument('test-doc');
    const layer = makeRasterLayerNode('rl-2', { width: 400, height: 300 });
    doc = addNode(doc, layer, { parentId: doc.rootChildren[0]! });
    const kinds = walkNodes(doc, (n) => n.kind);
    expect(kinds).toContain('rasterLayer');
  });

  it('can be removed from document', () => {
    let doc = createDocument('test-doc');
    const layer = makeRasterLayerNode('rl-3', { width: 100, height: 100 });
    doc = addNode(doc, layer, { parentId: doc.rootChildren[0]! });
    expect(doc.nodes['rl-3']).toBeDefined();
    doc = removeNode(doc, 'rl-3');
    expect(doc.nodes['rl-3']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Update types.ts — isContainer doesn't change (rasterLayer is NOT a container)**

The `isContainer` function only matches 'frame' and 'group' — rasterLayer is a leaf node, so no change needed for `isContainer`. But we need to update the visitor.

Update `packages/scene/src/visitor.ts` — add rasterLayer handler to the visitor:

```typescript
import type {
  AdjustmentNode,
  FrameNode,
  GroupNode,
  PathNode,
  RasterLayerNode,
  SceneNode,
  ShapeNode,
  TextNode,
} from './types';

export type NodeVisitor<T> = {
  shape: (node: ShapeNode) => T;
  text: (node: TextNode) => T;
  group: (node: GroupNode) => T;
  frame: (node: FrameNode) => T;
  adjustment: (node: AdjustmentNode) => T;
  path: (node: PathNode) => T;
  rasterLayer: (node: RasterLayerNode) => T;
};

export function visitNode<T>(node: SceneNode, visitor: NodeVisitor<T>): T {
  switch (node.kind) {
    case 'shape':
      return visitor.shape(node as ShapeNode);
    case 'text':
      return visitor.text(node as TextNode);
    case 'group':
      return visitor.group(node as GroupNode);
    case 'frame':
      return visitor.frame(node as FrameNode);
    case 'adjustment':
      return visitor.adjustment(node as AdjustmentNode);
    case 'path':
      return visitor.path(node as PathNode);
    case 'rasterLayer':
      return visitor.rasterLayer(node as RasterLayerNode);
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unhandled node kind: ${(_exhaustive as SceneNode).kind}`);
    }
  }
}
```

Update `visitNodePartial` as well to include the 'rasterLayer' case.

- [ ] **Step 3: Run test**

Run: `npx vitest run packages/scene/src/__tests__/rasterLayer.test.ts --reporter=verbose`
Expected: PASS (13 tests)

- [ ] **Step 4: Run full scene test suite to check for regressions**

Run: `npx vitest run packages/scene --reporter=verbose`
Check for any regressions in existing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/types.ts packages/scene/src/visitor.ts packages/scene/src/__tests__/rasterLayer.test.ts
git commit -m "feat(scene): integrate RasterLayerNode with document CRUD and visitor"
```

---

### Task 5: Update document.ts switch cases for new node kind

- [ ] **Step 1: Search for exhaustive switch statements on node kinds in document.ts**

Run: `grep -n "case 'adjustment'" packages/scene/src/document.ts` to find all existing kind switches.

- [ ] **Step 2: Add 'rasterLayer' cases where needed**

In document.ts, the following functions need updating:
- `createDocument` internal helpers
- `deepCloneSubtree` in clone.ts (check if it handles rasterLayer tiles)
- Any function that iterates node kinds

Since RasterLayerNode is a leaf node with no children, most existing operations (reparent, group/ungroup, move) work without modification. The key update is ensuring clone.ts preserves tile data.

Check and update `packages/scene/src/clone.ts` to handle rasterLayer tiles:

```typescript
// In the switch/case for cloning, add:
case 'rasterLayer': {
  const rl = node as import('./types').RasterLayerNode;
  return {
    ...rl,
    id: newId,
    tiles: new Map(rl.tiles), // Shallow clone of tiles map
  } as SceneNode;
}
```

- [ ] **Step 3: Run full scene test suite**

Run: `npx vitest run packages/scene --reporter=verbose`
Expected: All existing tests pass + new rasterLayer tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/scene/src/clone.ts packages/scene/src/document.ts
git commit -m "feat(scene): handle RasterLayerNode in clone and document ops"
```
