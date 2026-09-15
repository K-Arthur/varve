/**
 * Renderer integration: crossover decision, viewport rect math, gutter
 * padding, canvas cache, and the visible-tile draw path.
 */
import { describe, expect, it } from 'vitest';
import {
  ensureGutterTile,
  ensurePyramidTile,
  type PyramidLayerSource,
  resolveGutterTile,
} from './pyramidCache';
import {
  decideRasterStrategy,
  effectiveScaleFromTransform,
  GutterCanvasCache,
  layerVisibleRect,
  levelLocalRect,
  padTilePixels,
} from './renderTiles';
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

describe('decideRasterStrategy (crossover)', () => {
  const base = {
    width: 4096,
    height: 4096,
    scale: 0.25,
    viewportWidth: 1920,
    viewportHeight: 1080,
    enabled: true,
  };

  it('stays disabled when not enabled', () => {
    expect(decideRasterStrategy({ ...base, enabled: false }).kind).toBe('disabled');
  });

  it('keeps the retained surface for small layers', () => {
    const d = decideRasterStrategy({ ...base, width: 512, height: 512 });
    expect(d).toEqual({ kind: 'retained', reason: 'small-layer' });
  });

  it('keeps the retained surface when zoomed in', () => {
    const d = decideRasterStrategy({ ...base, scale: 1.5 });
    expect(d).toEqual({ kind: 'retained', reason: 'zoomed-in' });
  });

  it('keeps the retained surface when the viewport covers most of the layer', () => {
    const d = decideRasterStrategy({ ...base, viewportWidth: 100000, viewportHeight: 100000 });
    expect(d).toEqual({ kind: 'retained', reason: 'coverage' });
  });

  it('selects spatial tiles with the LOD level for large layers at low zoom', () => {
    // Viewport must cover less than half the layer: 800x600 at 25% zoom
    // shows 0.46 of a 4096^2 layer.
    const d = decideRasterStrategy({ ...base, viewportWidth: 800, viewportHeight: 600 });
    expect(d.kind).toBe('pyramid');
    if (d.kind === 'pyramid') {
      expect(d.level).toBe(2); // round(-log2(0.25))
    }
  });

  it('respects explicit thresholds', () => {
    const d = decideRasterStrategy({ ...base, maxScale: 0.2 });
    expect(d).toEqual({ kind: 'retained', reason: 'zoomed-in' });
  });
});

describe('effectiveScaleFromTransform', () => {
  it('handles zoom, DPR, rotation, skew, and non-uniform scale', () => {
    expect(effectiveScaleFromTransform({ a: 2, b: 0, c: 0, d: 2 })).toBe(2);
    // 45-degree rotation preserves distance: worst-case scale is 1.
    const r = Math.SQRT1_2;
    expect(effectiveScaleFromTransform({ a: r, b: r, c: -r, d: r })).toBeCloseTo(1);
    // Skew: the largest singular value bounds the worst-case axis scale.
    expect(effectiveScaleFromTransform({ a: 1, b: 0, c: 5, d: 0.5 })).toBeCloseTo(5.121);
    // Negative (flipped) scale keeps magnitude.
    expect(effectiveScaleFromTransform({ a: -3, b: 0, c: 0, d: 1 })).toBe(3);
  });
});

describe('layerVisibleRect', () => {
  it('identity transform maps the viewport directly', () => {
    const rect = layerVisibleRect({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 1920, 1080);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(1920);
    expect(rect.height).toBe(1080);
  });

  it('inverts translation', () => {
    const rect = layerVisibleRect({ a: 1, b: 0, c: 0, d: 1, e: 200, f: -50 }, 1920, 1080);
    expect(rect.x).toBe(-200);
    expect(rect.y).toBe(50);
  });

  it('is over-inclusive under rotation (AABB)', () => {
    const r = Math.SQRT1_2;
    const rect = layerVisibleRect({ a: r, b: r, c: -r, d: r, e: 0, f: 0 }, 100, 100);
    // A 100x100 viewport rotated 45deg covers an AABB of ~141px.
    expect(rect.width).toBeGreaterThan(100);
    expect(rect.width).toBeLessThanOrEqual(142);
  });
});

describe('levelLocalRect', () => {
  it('divides by the level factor', () => {
    expect(levelLocalRect({ x: 256, y: 128, width: 512, height: 64 }, 3)).toEqual({
      x: 32,
      y: 16,
      width: 64,
      height: 8,
    });
  });
});

describe('padTilePixels (gutter)', () => {
  it('replicates edges into a one-texel ring', () => {
    const px = new Uint8ClampedArray(2 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 2 + x) * 4;
        px[i] = x * 100 + y * 10; // 0,100,10,110
        px[i + 3] = 255;
      }
    }
    const padded = padTilePixels(px, 2, 1);
    expect(padded.length).toBe(4 * 4 * 4);
    const pxAt = (x: number, y: number) => padded[(y * 4 + x) * 4];
    // Interior equals source.
    expect(pxAt(1, 1)).toBe(0);
    expect(pxAt(2, 1)).toBe(100);
    expect(pxAt(1, 2)).toBe(10);
    expect(pxAt(2, 2)).toBe(110);
    // Top-left corner replicates the top-left texel.
    expect(pxAt(0, 0)).toBe(0);
    // Right ring replicates the right column.
    expect(pxAt(3, 1)).toBe(100);
    expect(pxAt(3, 3)).toBe(110);
  });
});

describe('GutterCanvasCache', () => {
  it('caches by key and evicts LRU', () => {
    const px = new Uint8ClampedArray(T * T * 4);
    const cache = new GutterCanvasCache(1024);
    const a = cache.get('a', px, T, 1);
    const a2 = cache.get('a', px, T, 1);
    expect(a).not.toBeNull();
    expect(a2).toBe(a); // reused, not rebuilt
    const b = cache.get('b', px, T, 1);
    expect(b).not.toBeNull();
    expect(cache.residentBytes).toBe(2 * 10 * 10 * 4);
  });
});

describe('gutter tile generation (integration)', () => {
  it('gutter tiles contain real neighbour data at the boundary', () => {
    // The right gutter ring of L1 (0,0) samples the first texel of the next
    // L1 tile's span: L0 px [16,18) = L0 tile (2,0), painted differently.
    const s = source(512, 512, [
      [0, 0, 1],
      [2, 0, 1],
    ]);
    const r = new PyramidResidency({ budgetBytes: 64 * 1024, tileBytes: (T + 2) * (T + 2) * 4 });
    const gutter = ensureGutterTile(s, 1, 0, 0, r);
    expect(gutter).not.toBeNull();
    const plain = ensurePyramidTile(s, 1, 0, 0, r);
    expect(plain).not.toBeNull();
    // Interior matches the plain tile.
    const g = gutter!.pixels;
    const p = plain!.pixels;
    for (let y = 1; y <= T; y++) {
      for (let x = 1; x <= T; x++) {
        const gi = (y * (T + 2) + x) * 4;
        const pi = ((y - 1) * T + (x - 1)) * 4;
        expect(g[gi]).toBe(p[pi]);
        expect(g[gi + 3]).toBe(p[pi + 3]);
      }
    }
    // Right ring: at the seam, the neighbour's colour (2*40+10, 10) appears.
    const ring = (y: number) => {
      const i = (y * (T + 2) + (T + 1)) * 4;
      return [g[i], g[i + 1]];
    };
    expect(ring(2)).toEqual([90, 10]);
    // Top-left corner ring still replicates own edge (no neighbour there).
    const tl = (0 * (T + 2) + 0) * 4;
    expect([g[tl], g[tl + 1]]).toEqual([10, 10]);
  });

  it('gutter tiles invalidate with their 3x3 source block', () => {
    const s0 = source(512, 512, [
      [0, 0, 1],
      [2, 0, 1],
    ]);
    const r = new PyramidResidency({ budgetBytes: 64 * 1024, tileBytes: (T + 2) * (T + 2) * 4 });
    const before = ensureGutterTile(s0, 1, 0, 0, r);
    expect(before).not.toBeNull();
    // Edit the NEIGHBOUR tile (2,0): the gutter must go stale.
    const s1: PyramidLayerSource = {
      ...s0,
      tiles: new Map(
        [...(s0.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>)].map(
          ([k, v]) => (k === '2:0' ? [k, { ...v, version: 2 }] : [k, v]),
        ),
      ),
    };
    expect(r.has(before!.key)).toBe(true);
    expect(resolveGutterTile(s1, 1, 0, 0, r)).toBeNull();
  });
});
