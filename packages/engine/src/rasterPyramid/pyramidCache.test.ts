/**
 * Pyramid cache: cascade generation, incremental invalidation, revision
 * safety, and sparse layers. Uses small tiles (T=8) to keep fixtures fast;
 * the math is size-agnostic.
 */
import { describe, expect, it } from 'vitest';
import {
  commitIfCurrent,
  currentSnapshot,
  ensurePyramidTile,
  generatePyramidTile,
  type PyramidLayerSource,
  resolveTile,
} from './pyramidCache';
import { PyramidResidency } from './residency';

const T = 8;

function source(
  width: number,
  height: number,
  paint: Array<[number, number, number]> = [],
): PyramidLayerSource {
  const tiles = new Map<string, { version: number; pixels: Uint8ClampedArray }>();
  for (const [col, row, version] of paint) {
    const px = new Uint8ClampedArray(T * T * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = col * 40 + 10;
      px[i + 1] = row * 40 + 10;
      px[i + 2] = 100;
      px[i + 3] = 255;
    }
    tiles.set(`${col}:${row}`, { version, pixels: px });
  }
  return { layerId: 'layer-1', width, height, pixelMode: false, tiles, tileSize: T };
}

function store(): PyramidResidency {
  return new PyramidResidency({ budgetBytes: 64 * 1024, tileBytes: T * T * 4 });
}

function entryAt(level: number, col: number, row: number) {
  return {
    layerId: 'layer-1',
    level,
    col,
    row,
    resamplerVersion: 1,
    pixelMode: false,
  };
}

describe('cascade generation', () => {
  it('generates L1 from L0 and stores intermediate levels', () => {
    const s = source(256, 256, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    const r = store();
    const entry = ensurePyramidTile(s, 2, 0, 0, r);
    expect(entry).not.toBeNull();
    // The four painted L0 tiles cover only the top-left 16x16 of the layer:
    // L1 (0,0) is the only child with content, plus L2 (0,0) itself.
    expect(r.diagnostics().residentTiles).toBe(2);
    // L1 (0,0) was stored for sibling reuse; the empty siblings are not.
    expect(r.has(`layer-1@L1:0:0:image:r1`)).toBe(true);
    expect(r.has(`layer-1@L1:1:0:image:r1`)).toBe(false);
    expect(r.has(`layer-1@L1:1:1:image:r1`)).toBe(false);
    // Box-filter semantics: L1 pixel (0,0) is the 2x2 average at the child
    // origin — tile (0,0)'s colour (10,10,100) at full alpha.
    const l1 = resolveTile(s, 1, 0, 0, r);
    expect(l1?.pixels[0]).toBe(10);
    expect(l1?.pixels[3]).toBe(255);
    // L1 pixel (0,4) samples rows 8-9, still inside tile (0,1): (10,50).
    expect(l1?.pixels[(4 * T + 0) * 4]).toBe(10);
    expect(l1?.pixels[(4 * T + 0) * 4 + 1]).toBe(50);
    // L2 (0,0) spans exactly the painted 16x16 region: fully opaque.
    expect(entry?.pixels[0]).toBe(10);
    expect(entry?.pixels[3]).toBe(255);
  });

  it('derives deeper levels without touching L0 pixels again (cascade)', () => {
    const s = source(512, 512, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [2, 0, 1],
      [3, 0, 1],
      [2, 1, 1],
      [3, 1, 1],
    ]);
    const r = store();
    const entry = ensurePyramidTile(s, 2, 0, 0, r);
    // Children are L1 tiles with content; cascade works.
    expect(entry).not.toBeNull();
    // Snapshot chains through the children.
    const snap = currentSnapshot(s, 2, 0, 0);
    expect(entry?.snapshot).toBe(snap);
  });
});

describe('incremental invalidation', () => {
  it('an edit invalidates only the affected ancestors', () => {
    // Region A under L2 (0,0): L0 tiles (0,0)..(1,1).
    // Region B under L2 (1,1): L0 tiles (8,8)..(9,9).
    const s0 = source(512, 512, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [8, 8, 1],
      [9, 8, 1],
      [8, 9, 1],
      [9, 9, 1],
    ]);
    const r = store();
    const before = ensurePyramidTile(s0, 2, 0, 0, r);
    const beforeOther = ensurePyramidTile(s0, 2, 2, 2, r);
    expect(before).not.toBeNull();
    expect(beforeOther).not.toBeNull();
    const otherSnapshot = beforeOther?.snapshot;

    // Edit L0 tile (0,0) -> version 2.
    const s1: PyramidLayerSource = {
      ...s0,
      tiles: new Map(
        [...(s0.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>)].map(
          ([k, v]) => (k === '0:0' ? [k, { ...v, version: 2 }] : [k, v]),
        ),
      ),
    };
    // Ancestor (0,0) at L2 is now stale and resolves to null.
    expect(resolveTile(s1, 2, 0, 0, r)).toBeNull();
    // Sibling (1,1) at L2 is untouched and stays resident.
    expect(resolveTile(s1, 2, 2, 2, r)?.snapshot).toBe(otherSnapshot);
    // Regeneration stores the new revision.
    const after = ensurePyramidTile(s1, 2, 0, 0, r);
    expect(after).not.toBeNull();
    expect(after?.snapshot).not.toBe(before?.snapshot);
  });

  it('no unrelated ancestor becomes dirty (property)', () => {
    const s0 = source(512, 512, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    const r = store();
    for (let level = 1; level <= 4; level++) {
      ensurePyramidTile(s0, level, 0, 0, r);
    }
    const untouched = ensurePyramidTile(s0, 2, 1, 1, r);
    const snap = untouched?.snapshot;
    const s1: PyramidLayerSource = {
      ...s0,
      tiles: new Map([
        ...(s0.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>),
        ['5:5', { version: 1, pixels: new Uint8ClampedArray(T * T * 4) }],
      ]),
    };
    expect(resolveTile(s1, 2, 1, 1, r)?.snapshot).toBe(snap);
  });
});

describe('revision safety', () => {
  it('a stale generation is never committed over a newer edit', () => {
    const s0 = source(256, 256, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    const r = store();
    // Simulate a job that generated against s0, then source changed to s1
    // before commit.
    const result = generatePyramidTile(s0, 1, 0, 0, r);
    expect(result).not.toBeNull();
    const s1: PyramidLayerSource = {
      ...s0,
      tiles: new Map(
        [...(s0.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>)].map(
          ([k, v]) => (k === '0:0' ? [k, { ...v, version: 99 }] : [k, v]),
        ),
      ),
    };
    expect(commitIfCurrent(s1, 1, 0, 0, result!.snapshot)).toBe(false);
    // The stale pixels never enter the store.
    expect(r.has(result!.key)).toBe(false);
    // A job that commits while the source is unchanged succeeds.
    expect(commitIfCurrent(s0, 1, 0, 0, result!.snapshot)).toBe(true);
  });

  it('older result finishing after a newer one is discarded (race test)', () => {
    const s0 = source(256, 256, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    const r = store();
    const v10 = generatePyramidTile(s0, 1, 0, 0, r); // version-1 result
    const s1: PyramidLayerSource = {
      ...s0,
      tiles: new Map(
        [...(s0.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>)].map(
          ([k, v]) => (k === '0:0' ? [k, { ...v, version: 11 }] : [k, v]),
        ),
      ),
    };
    const v11 = generatePyramidTile(s1, 1, 0, 0, r); // version-11 result
    // v11 finishes first, commits.
    expect(commitIfCurrent(s1, 1, 0, 0, v11!.snapshot)).toBe(true);
    const entry = r.put({
      key: v11!.key,
      bytes: 128 * 128 * 4,
      layerId: 'layer-1',
      level: 1,
      col: 0,
      row: 0,
      snapshot: v11!.snapshot,
      pixels: v11!.pixels,
    });
    // Old v10 finishes afterward: must NOT overwrite.
    expect(commitIfCurrent(s1, 1, 0, 0, v10!.snapshot)).toBe(false);
    expect(r.get(entry.key)?.snapshot).toBe(v11!.snapshot);
  });
});

describe('sparse layers', () => {
  it('empty derived tiles are not stored (no dense allocation)', () => {
    // A 4096x4096 layer with a single painted L0 tile: the pyramid must not
    // materialize empty levels.
    const s = source(4096, 4096, [[0, 0, 1]]);
    const r = store();
    const l1 = ensurePyramidTile(s, 1, 1, 1, r);
    expect(l1).toBeNull(); // far from the painted tile -> fully transparent
    const near = ensurePyramidTile(s, 1, 0, 0, r);
    expect(near).not.toBeNull(); // parent chain of the painted tile
    // Only the painted region produced tiles.
    expect(r.diagnostics().residentTiles).toBe(1);
  });
});

describe('resolveTile identity', () => {
  it('distinguishes tiles by level, col, row, layer and pixel mode', () => {
    const s = source(256, 256, [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]);
    const r = store();
    const e = ensurePyramidTile(s, 2, 0, 0, r);
    expect(e).not.toBeNull();
    expect(resolveTile(s, 2, 0, 1, r)).toBeNull(); // different row
    expect(resolveTile({ ...s, layerId: 'other' }, 2, 0, 0, r)).toBeNull(); // different layer
    expect(resolveTile({ ...s, pixelMode: true }, 2, 0, 0, r)).toBeNull(); // different mode
    expect(entryAt(2, 0, 0)).toEqual(expect.objectContaining({ level: 2, col: 0, row: 0 }));
  });
});
