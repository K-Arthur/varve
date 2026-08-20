import { describe, expect, it } from 'vitest';
import {
  WET_MAX_GAP_SECONDS,
  WET_TILE_SIZE,
  WetPaintManager,
} from '../wetPaintManager';

const RED = [255, 0, 0, 255] as const;
const BLUE = [0, 0, 255, 255] as const;

describe('wet paint lifecycle', () => {
  it('is inactive until paint is added', () => {
    const m = new WetPaintManager();
    expect(m.isActive).toBe(false);
    expect(m.wetPixelCount).toBe(0);
    expect(m.allocatedBytes).toBe(0);
  });

  it('allocates only the tiles that actually got wet', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 10, 10, RED, 1, 0.5);
    m.addPaint('layer', 4000, 4000, RED, 1, 0.5);
    // A 4096-wide layer is 64x64 wet tiles; only two were touched.
    expect(m.tileCount('layer')).toBe(2);
  });

  it('mixes new paint into the wet film already there', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    const mixed = m.addPaint('layer', 5, 5, BLUE, 0.5, 0.5);
    // Blue landing in wet red produces neither pure blue nor pure red.
    expect(mixed[0]).toBeGreaterThan(0);
    expect(mixed[2]).toBeGreaterThan(0);
  });

  it('does not mix once the paint has dried', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    m.tick(0, 1);
    m.tick(10_000, 1); // long gap: everything dries
    const fresh = m.addPaint('layer', 5, 5, BLUE, 0.5, 0.5);
    expect(fresh).toEqual([0, 0, 255, 255]);
  });

  it('establishes the clock on the first tick rather than simulating a gap', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    const first = m.tick(1_000_000, 1);
    expect(first.simulated).toBe(false);
    expect(m.wetnessAt('layer', 5, 5)).toBe(1);
  });

  it('clamps a single step so one dropped frame cannot lurch the simulation', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    m.tick(0, 1);
    m.tick(2_000, 1); // 2s elapsed, clamped to the per-step ceiling
    expect(m.wetnessAt('layer', 5, 5)).toBeGreaterThan(0.5);
  });

  it('dries everything outright after a long absence', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.01);
    m.tick(0, 0.01);
    const result = m.tick((WET_MAX_GAP_SECONDS + 1) * 1000, 0.01);
    expect(result.remainingWetPixels).toBe(0);
    expect(m.isActive).toBe(false);
  });

  it('measures from resume after suspend instead of simulating the gap', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    m.tick(0, 0.5);
    m.suspend();
    const afterResume = m.tick(3_600_000, 0.5);
    expect(afterResume.simulated).toBe(false);
    expect(m.isActive).toBe(true);
  });

  it('goes fully inactive once everything has dried', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    let t = 0;
    m.tick(t, 4);
    for (let i = 0; i < 40 && m.isActive; i++) {
      t += 100;
      m.tick(t, 4);
    }
    expect(m.isActive).toBe(false);
    expect(m.wetPixelCount).toBe(0);
  });

  it('reclaims tile memory as regions dry', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    expect(m.allocatedBytes).toBeGreaterThan(0);
    let t = 0;
    m.tick(t, 4);
    while (m.isActive) {
      t += 100;
      m.tick(t, 4);
    }
    expect(m.allocatedBytes).toBe(0);
    expect(m.tileCount('layer')).toBe(0);
  });

  it('reports dirty regions covering only the wet tiles', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    m.tick(0, 1);
    const result = m.tick(100, 1);
    expect(result.dirty).toHaveLength(1);
    expect(result.dirty[0]).toEqual({ x: 0, y: 0, w: WET_TILE_SIZE, h: WET_TILE_SIZE });
  });

  it('releases a deleted layer without leaving an orphan buffer', () => {
    const m = new WetPaintManager();
    m.addPaint('a', 5, 5, RED, 1, 0.5);
    m.addPaint('b', 5, 5, RED, 1, 0.5);
    m.releaseLayer('a');
    expect(m.layerCount).toBe(1);
    expect(m.wetnessAt('a', 5, 5)).toBe(0);
    expect(m.wetnessAt('b', 5, 5)).toBe(1);
  });

  it('releases everything on document close', () => {
    const m = new WetPaintManager();
    m.addPaint('a', 5, 5, RED, 1, 0.5);
    m.releaseAll();
    expect(m.isActive).toBe(false);
    expect(m.allocatedBytes).toBe(0);
  });

  it('does no work when the drying rate is zero', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    m.tick(0, 0);
    const result = m.tick(500, 0);
    expect(result.simulated).toBe(false);
    expect(m.wetnessAt('layer', 5, 5)).toBe(1);
  });

  it('reports the wet film colour only while it is wet', () => {
    const m = new WetPaintManager();
    m.addPaint('layer', 5, 5, RED, 1, 0.5);
    expect(m.colorAt('layer', 5, 5)).toEqual([255, 0, 0, 255]);
    m.tick(0, 1);
    m.tick(10_000, 1);
    expect(m.colorAt('layer', 5, 5)).toBeNull();
  });
});
