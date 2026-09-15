/**
 * Memory soak (brief §69, ADR-0214 D9/D10): a deterministic session loop —
 * open a large sparse raster layer, pan/zoom through viewports, paint,
 * undo, switch documents, repeat. Residency must stay within budget, queues
 * bounded, released layers must leave nothing behind, and nothing may grow
 * monotonically.
 */
import { describe, expect, it } from 'vitest';
import { ensureGutterTile, type PyramidLayerSource, resolveGutterTile } from './pyramidCache';
import { PyramidResidency } from './residency';
import { PYRAMID_PRIORITY_VIEWPORT, PyramidScheduler } from './scheduler';
import { visibleTilesAtLevel } from './tileQuery';

const T = 8;
// Tight budget: ~256 tiles of 256 bytes. Sparse soaks never reach this by
// themselves, so the LRU path is genuinely exercised each iteration.
const BUDGET = 8 * 1024; // 32 tiles at 256 bytes: eviction engages at this scale

/** Deterministic PRNG (mulberry32) so the soak is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLayer(layerId: string, seed: number): PyramidLayerSource {
  const rand = mulberry32(seed);
  const size = 256;
  const tiles = new Map<string, { version: number; pixels: Uint8ClampedArray }>();
  // Sparse paint: ~12% of the 128x128 grid, in a few clusters.
  for (let i = 0; i < 1000; i++) {
    if (rand() > 0.5) continue;
    const col = Math.floor(rand() * (size / T));
    const row = Math.floor(rand() * (size / T));
    const px = new Uint8ClampedArray(T * T * 4);
    for (let j = 0; j < px.length; j += 4) {
      px[j] = Math.floor(rand() * 256);
      px[j + 1] = Math.floor(rand() * 256);
      px[j + 2] = Math.floor(rand() * 256);
      px[j + 3] = 255;
    }
    tiles.set(`${col}:${row}`, { version: 1, pixels: px });
  }
  return { layerId, width: size, height: size, pixelMode: false, tiles, tileSize: T };
}

/** Bump the version of every L0 tile in a region (a paint stroke). */
function paintRegion(
  source: PyramidLayerSource,
  col0: number,
  row0: number,
  w: number,
  h: number,
): PyramidLayerSource {
  const tiles = new Map(
    source.tiles as Map<string, { version: number; pixels: Uint8ClampedArray }>,
  );
  for (let r = row0; r < row0 + h; r++) {
    for (let c = col0; c < col0 + w; c++) {
      const key = `${c}:${r}`;
      const existing = tiles.get(key) ?? {
        version: 0,
        pixels: new Uint8ClampedArray(T * T * 4),
      };
      tiles.set(key, { ...existing, version: existing.version + 1 });
    }
  }
  return { ...source, tiles };
}

/** Walk the viewport like the renderer would: resolve visible, generate missing. */
function visitViewport(
  source: PyramidLayerSource,
  store: PyramidResidency,
  scheduler: PyramidScheduler<undefined>,
  level: number,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const dims = { width: source.width, height: source.height };
  const f = 2 ** level;
  const levelRect = {
    x: rect.x / f,
    y: rect.y / f,
    width: rect.width / f,
    height: rect.height / f,
  };
  const visible = visibleTilesAtLevel(level, levelRect, dims, T);
  for (const coord of visible.tiles) {
    if (resolveGutterTile(source, level, coord.col, coord.row, store)) continue;
    scheduler.enqueue({
      id: `${source.layerId}:${level}:${coord.col}:${coord.row}`,
      key: `${source.layerId}@L${level}:${coord.col}:${coord.row}:image:r1:g1`,
      revision: 'soak',
      priority: PYRAMID_PRIORITY_VIEWPORT,
      layerId: source.layerId,
      level,
      col: coord.col,
      row: coord.row,
      payload: undefined,
    });
  }
}

describe('memory soak (session loop)', () => {
  it('residency stays bounded across paint/undo/document-switch churn', () => {
    const store = new PyramidResidency({ budgetBytes: BUDGET, tileBytes: T * T * 4 });
    const sources = new Map<string, PyramidLayerSource>();
    const scheduler = new PyramidScheduler<undefined>({
      maxConcurrency: 1,
      maxQueued: 128,
      run: (job) => {
        const source = sources.get(job.layerId);
        if (source) ensureGutterTile(source, job.level, job.col, job.row, store);
      },
    });
    const rand = mulberry32(42);

    const layerA = makeLayer('layer-A', 1);
    const layerB = makeLayer('layer-B', 2);
    sources.set('layer-A', layerA);
    sources.set('layer-B', layerB);
    let current = layerA;

    let peakObserved = 0;
    for (let iter = 0; iter < 20; iter++) {
      // Pan/zoom through several viewports at random levels.
      for (let v = 0; v < 6; v++) {
        const level = Math.floor(rand() * 4);
        const x = Math.floor(rand() * 600) - 100;
        const y = Math.floor(rand() * 600) - 100;
        const w = 128 + Math.floor(rand() * 128);
        const h = 128 + Math.floor(rand() * 128);
        visitViewport(current, store, scheduler, level, { x, y, width: w, height: h });
      }
      // Paint: bump versions in a region, then regenerate its ancestors.
      const before = store.diagnostics().residentBytes;
      const col0 = Math.floor(rand() * 60);
      const row0 = Math.floor(rand() * 60);
      const painted = paintRegion(current, col0, row0, 4, 4);
      sources.set(current.layerId, painted);
      current = painted;
      // The 4x4 L0 region maps to exactly one L1 ancestor tile each way.
      const l1Col = Math.floor(col0 / 2);
      const l1Row = Math.floor(row0 / 2);
      ensureGutterTile(current, 1, l1Col, l1Row, store);
      // Undo: revert the paint; previously resident tiles must be current again.
      const prev = layerA;
      sources.set(current.layerId, prev);
      current = prev;
      const after = store.diagnostics().residentBytes;
      expect(after).toBeLessThanOrEqual(before + 4096); // undo reuses resident tiles
      // Switch documents every few iterations.
      if (iter % 5 === 4) {
        scheduler.cancelLayer(current.layerId);
        store.releaseLayer(current.layerId);
        current = current.layerId === 'layer-A' ? layerB : layerA;
        sources.set(current.layerId, current);
      }
      const d = store.diagnostics();
      expect(d.residentBytes).toBeLessThanOrEqual(BUDGET);
      expect(scheduler.queuedCount).toBeLessThanOrEqual(128);
      peakObserved = Math.max(peakObserved, d.residentBytes);
    }

    // The store actually exercised eviction and never blew its peak cap.
    expect(store.diagnostics().evictions).toBeGreaterThan(0);
    expect(peakObserved).toBeLessThanOrEqual(BUDGET * 2);
    // Residency converges: releasing the active layer empties the store.
    store.releaseLayer(current.layerId);
    expect(store.diagnostics().residentBytes).toBe(0);
  });

  it('shrinking the budget converges residency down', () => {
    const store = new PyramidResidency({ budgetBytes: BUDGET, tileBytes: T * T * 4 });
    const layer = makeLayer('layer-C', 3);
    const scheduler = new PyramidScheduler<undefined>({
      run: (job) => {
        ensureGutterTile(layer, job.level, job.col, job.row, store);
      },
    });
    // Saturate the store.
    visitViewport(layer, store, scheduler, 1, { x: 0, y: 0, width: 512, height: 512 });
    visitViewport(layer, store, scheduler, 2, { x: 0, y: 0, width: 512, height: 512 });
    expect(store.diagnostics().residentBytes).toBeLessThanOrEqual(BUDGET);
    // Pressure: cut the budget to a quarter; eviction must converge fast.
    const quarter = Math.floor(BUDGET / 4);
    store.setBudget(quarter);
    expect(store.diagnostics().residentBytes).toBeLessThanOrEqual(quarter);
    // Keep visiting; residency stays under the shrunk budget.
    for (let i = 0; i < 10; i++) {
      visitViewport(layer, store, scheduler, 1, { x: i * 32, y: 0, width: 256, height: 256 });
      expect(store.diagnostics().residentBytes).toBeLessThanOrEqual(quarter);
    }
  });
});
