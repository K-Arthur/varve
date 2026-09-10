/**
 * Pyramid residency: byte budget, LRU eviction, protected (in-use) tiles,
 * layer release, and diagnostics counters.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID_BUDGET_BYTES, PyramidResidency } from './residency';

const TILE_BYTES = 8 * 8 * 4; // 256, small tiles for fast fixtures

function entry(key: string, layerId = 'layer-1', level = 1, col = 0, row = 0) {
  return {
    key,
    layerId,
    level,
    col,
    row,
    snapshot: `s-${key}`,
    pixels: new Uint8ClampedArray(TILE_BYTES),
    bytes: TILE_BYTES,
  };
}

describe('budget and eviction', () => {
  it('evicts LRU tiles past the budget', () => {
    const r = new PyramidResidency({ budgetBytes: TILE_BYTES * 2, tileBytes: TILE_BYTES });
    r.put(entry('a'));
    r.put(entry('b'));
    r.put(entry('c'));
    expect(r.has('a')).toBe(false); // oldest evicted
    expect(r.has('b')).toBe(true);
    expect(r.has('c')).toBe(true);
    expect(r.diagnostics().evictions).toBe(1);
    expect(r.diagnostics().residentBytes).toBe(TILE_BYTES * 2);
  });

  it('never evicts the tile being presented', () => {
    const r = new PyramidResidency({ budgetBytes: TILE_BYTES, tileBytes: TILE_BYTES });
    r.put({ ...entry('presented'), protected: true });
    r.put(entry('other'));
    r.put(entry('another'));
    expect(r.has('presented')).toBe(true);
    // Non-protected tiles were evicted down to budget; the protected one survives.
    expect(r.has('other')).toBe(false);
    expect(r.diagnostics().residentTiles).toBe(1);
  });

  it('holds over budget only while every tile is protected', () => {
    const r = new PyramidResidency({ budgetBytes: TILE_BYTES, tileBytes: TILE_BYTES });
    r.put({ ...entry('a'), protected: true });
    r.put({ ...entry('b'), protected: true });
    r.put({ ...entry('c'), protected: true });
    expect(r.diagnostics().residentBytes).toBe(TILE_BYTES * 3);
    r.protectLayer('layer-1', false);
    r.evictToBudget();
    expect(r.diagnostics().residentTiles).toBe(1);
  });

  it('clears protection on release and evicts then', () => {
    const r = new PyramidResidency({ budgetBytes: TILE_BYTES, tileBytes: TILE_BYTES });
    r.put({ ...entry('presented'), protected: true });
    r.protect('presented', false);
    r.put(entry('other'));
    expect(r.has('presented')).toBe(false);
  });

  it('tracks peak bytes', () => {
    const r = new PyramidResidency({ budgetBytes: 1024 * 1024, tileBytes: TILE_BYTES });
    r.put(entry('a'));
    r.put(entry('b'));
    const peak = r.diagnostics().peakBytes;
    expect(peak).toBe(TILE_BYTES * 2);
    r.clear();
    expect(r.diagnostics().residentBytes).toBe(0);
    expect(r.diagnostics().peakBytes).toBe(peak);
  });

  it('tracks hit and miss counters', () => {
    const r = new PyramidResidency({ budgetBytes: 1024 * 1024, tileBytes: TILE_BYTES });
    r.put(entry('a'));
    r.get('a');
    r.get('a');
    r.get('missing');
    const d = r.diagnostics();
    expect(d.hits).toBe(2);
    expect(d.misses).toBe(1);
  });
});

describe('layer scoping', () => {
  it('releaseLayer drops only tiles of that layer', () => {
    const r = new PyramidResidency({ budgetBytes: 1024 * 1024, tileBytes: TILE_BYTES });
    r.put(entry('a', 'layer-1'));
    r.put(entry('b', 'layer-2'));
    expect(r.releaseLayer('layer-1')).toBe(1);
    expect(r.has('a')).toBe(false);
    expect(r.has('b')).toBe(true);
  });

  it('budget changes apply immediately', () => {
    const r = new PyramidResidency({ budgetBytes: TILE_BYTES * 4, tileBytes: TILE_BYTES });
    r.put(entry('a'));
    r.put(entry('b'));
    r.put(entry('c'));
    r.setBudget(TILE_BYTES * 2);
    expect(r.diagnostics().residentTiles).toBe(2);
  });
});

describe('defaults', () => {
  it('default budget holds 512 full-size tiles', () => {
    const r = new PyramidResidency();
    expect(r.budget).toBe(DEFAULT_PYRAMID_BUDGET_BYTES);
    expect(r.budget / (128 * 128 * 4)).toBe(512);
  });

  it('default tile bytes are the 128x128x4 surface size', () => {
    const r = new PyramidResidency();
    r.put({
      key: 'bare',
      layerId: 'layer-1',
      level: 1,
      col: 0,
      row: 0,
      snapshot: 's',
      pixels: new Uint8ClampedArray(4),
      bytes: 128 * 128 * 4,
    });
    expect(r.diagnostics().residentBytes).toBe(128 * 128 * 4);
  });
});
