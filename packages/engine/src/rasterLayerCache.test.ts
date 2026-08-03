/**
 * Correctness corpus for dirty-tile raster replay.
 *
 * The optimization changes *when* tile pixels are written into the layer's
 * intermediate surface, never what is written or how the surface is composited.
 * These tests pin that contract: every scenario asserts the resident pixel
 * state is identical to what a full rebuild would produce.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_SURFACE_BUDGET_BYTES,
  getRasterLayerCache,
  planTileUploads,
  RasterLayerCache,
  type RasterLayerSurface,
  resetRasterLayerCache,
} from './rasterLayerCache';

const TILE = 4; // Small tiles keep the fixtures readable.

function tile(version: number, fill = 0): { pixels: number[]; version: number } {
  return { pixels: new Array(TILE * TILE * 4).fill(fill), version };
}

/**
 * Minimal 2D context recording every pixel write, so a partial upload can be
 * compared against a full rebuild without a real canvas.
 */
function installFakeCanvas(): {
  writes: Array<{ x: number; y: number; fill: number }>;
  clears: Array<{ x: number; y: number }>;
} {
  const writes: Array<{ x: number; y: number; fill: number }> = [];
  const clears: Array<{ x: number; y: number }> = [];
  class FakeOffscreen {
    width = 0;
    height = 0;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (data: { data: Uint8ClampedArray }, x: number, y: number) => {
          writes.push({ x, y, fill: data.data[0] ?? 0 });
        },
        clearRect: (x: number, y: number) => {
          clears.push({ x, y });
        },
      };
    }
  }
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreen;
  return { writes, clears };
}

describe('planTileUploads', () => {
  const surface = (versions: Record<string, number>, w = 8, h = 8): RasterLayerSurface =>
    ({
      width: w,
      height: h,
      tileVersions: new Map(Object.entries(versions)),
    }) as RasterLayerSurface;

  it('requests every tile when there is no surface yet', () => {
    const plan = planTileUploads(null, 8, 8, { '0:0': tile(1), '1:0': tile(1) });
    expect(plan.fullRebuild).toBe(true);
    expect(plan.changed.sort()).toEqual(['0:0', '1:0']);
  });

  it('requests nothing when every tile version is already resident', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1 }), 8, 8, {
      '0:0': tile(1),
      '1:0': tile(1),
    });
    expect(plan.fullRebuild).toBe(false);
    expect(plan.changed).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it('requests only the tile whose version advanced — the brush-dab case', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1, '2:0': 1 }), 8, 8, {
      '0:0': tile(1),
      '1:0': tile(2),
      '2:0': tile(1),
    });
    expect(plan.changed).toEqual(['1:0']);
  });

  it('treats a newly added tile as changed', () => {
    const plan = planTileUploads(surface({ '0:0': 1 }), 8, 8, { '0:0': tile(1), '9:9': tile(1) });
    expect(plan.changed).toEqual(['9:9']);
  });

  it('reports removed tiles so their stale pixels can be cleared', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1 }), 8, 8, { '0:0': tile(1) });
    expect(plan.removed).toEqual(['1:0']);
  });

  it('forces a full rebuild when the layer is resized', () => {
    const plan = planTileUploads(surface({ '0:0': 1 }, 8, 8), 16, 8, { '0:0': tile(1) });
    expect(plan.fullRebuild).toBe(true);
  });
});

describe('RasterLayerCache', () => {
  let recorder: ReturnType<typeof installFakeCanvas>;

  beforeEach(() => {
    recorder = installFakeCanvas();
    resetRasterLayerCache();
  });

  it('uploads every tile on first acquire, then none when nothing changed', () => {
    const cache = new RasterLayerCache();
    const tiles = { '0:0': tile(1, 10), '1:0': tile(1, 20) };
    cache.acquire('layer', 8, 4, tiles, TILE);
    expect(recorder.writes).toHaveLength(2);

    recorder.writes.length = 0;
    cache.acquire('layer', 8, 4, tiles, TILE);
    // The whole point: an unchanged layer costs zero tile uploads.
    expect(recorder.writes).toHaveLength(0);
    expect(cache.diagnostics.hits).toBe(1);
  });

  it('uploads only the changed tile after an edit', () => {
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;

    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(2, 99) }, TILE);
    expect(recorder.writes).toEqual([{ x: TILE, y: 0, fill: 99 }]);
  });

  it('produces the same resident pixels as a full rebuild', () => {
    // Parity: incremental uploads must leave the surface in the state a
    // from-scratch rebuild would produce.
    const cacheIncremental = new RasterLayerCache();
    cacheIncremental.acquire('a', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    cacheIncremental.acquire('a', 8, 4, { '0:0': tile(2, 30), '1:0': tile(1, 20) }, TILE);
    const incremental = [...recorder.writes];

    recorder.writes.length = 0;
    const cacheFresh = new RasterLayerCache();
    cacheFresh.acquire('b', 8, 4, { '0:0': tile(2, 30), '1:0': tile(1, 20) }, TILE);
    const fresh = [...recorder.writes];

    // Final pixel state per position must match, regardless of write order.
    const finalState = (writes: typeof fresh) => {
      const map = new Map<string, number>();
      for (const w of writes) map.set(`${w.x}:${w.y}`, w.fill);
      return [...map.entries()].sort();
    };
    expect(finalState(incremental)).toEqual(finalState(fresh));
  });

  it('clears a removed tile so stale pixels cannot persist in the retained surface', () => {
    // The one hazard a persistent surface adds that a per-frame rebuild
    // cannot have.
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.clears.length = 0;

    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(recorder.clears).toEqual([{ x: TILE, y: 0 }]);
  });

  it('rebuilds from scratch when the layer is resized', () => {
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;
    cache.acquire('layer', 16, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    expect(recorder.writes).toHaveLength(2);
    expect(cache.diagnostics.misses).toBe(2);
  });

  it('keeps separate surfaces per layer', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;
    // Neither layer may be invalidated by the other's presence.
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    expect(recorder.writes).toHaveLength(0);
  });

  it('evicts least-recently-used surfaces to stay inside its byte budget', () => {
    // Budget for exactly one 8x4 surface (128 bytes).
    const cache = new RasterLayerCache(8 * 4 * 4);
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    expect(cache.diagnostics.surfaces).toBe(1);
    expect(cache.residentBytes).toBeLessThanOrEqual(8 * 4 * 4);
  });

  it('never evicts the surface it is currently serving', () => {
    const cache = new RasterLayerCache(8 * 4 * 4);
    const result = cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(result).not.toBeNull();
    expect(cache.diagnostics.surfaces).toBe(1);
  });

  it('drops everything on clear — document close or context loss', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.clear();
    expect(cache.diagnostics.surfaces).toBe(0);
    expect(cache.residentBytes).toBe(0);
  });

  it('releases a single layer without disturbing the others', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    cache.release('a');
    expect(cache.diagnostics.surfaces).toBe(1);
  });

  it('holds no surfaces at all when the budget is zero', () => {
    const cache = new RasterLayerCache(0);
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(cache.diagnostics.surfaces).toBe(0);
  });

  it('exposes a shared instance that resets cleanly', () => {
    const cache = getRasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(getRasterLayerCache().diagnostics.surfaces).toBe(1);
    resetRasterLayerCache();
    expect(getRasterLayerCache().diagnostics.surfaces).toBe(0);
  });

  it('defaults to a budget below the worker bitmap budget', () => {
    expect(DEFAULT_LAYER_SURFACE_BUDGET_BYTES).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  it('counts skipped tiles, which is the work the optimization removes', () => {
    const cache = new RasterLayerCache();
    const tiles = { '0:0': tile(1, 1), '1:0': tile(1, 2), '2:0': tile(1, 3), '3:0': tile(1, 4) };
    cache.acquire('layer', 16, 4, tiles, TILE);
    cache.acquire('layer', 16, 4, { ...tiles, '0:0': tile(2, 9) }, TILE);
    // Second pass: 1 of 4 tiles uploaded, 3 skipped.
    expect(cache.diagnostics.tilesUploaded).toBe(5);
    expect(cache.diagnostics.tilesSkipped).toBe(3);
  });
});
